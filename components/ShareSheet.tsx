import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { CommunityPost } from '../types';
import { getShareUrl } from '../utils';
import { track } from '../services/analytics';
import { getCorsProxyUrl } from '../services/firebaseService';
import { renderPlate, sharePlate } from '../services/plateImage';
import { groupOf, seasonOf, toMs } from '../services/lifeList';
import { PlateData } from './SpecimenPlate';
import Glyph from './Glyph';

/**
 * One share sheet for every sighting: it shows the specimen plate that will be sent, so the
 * explorer sees exactly what a friend will receive, then offers three plain choices. The share
 * text always leads with the species ("Indian Roller, seen near Jaipur on NatureGram").
 */

const IGNORE = /^(unknown|nature|unidentified|observation|captured|uploaded|sighting)$/i;

/** The theme accent as an rgb() string, for the line of text on the rendered plate. */
export const themeAccent = (): string | undefined => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--theme-accent-rgb').trim();
    return v ? `rgb(${v.split(/[\s,]+/).join(',')})` : undefined;
  } catch { return undefined; }
};

/** The species name for a sighting, never a placeholder. */
export const speciesOf = (post: Partial<CommunityPost> | null | undefined): string => {
  const l = (post?.labels?.[0] || '').trim();
  if (l && !IGNORE.test(l)) return l;
  return (post?.title || '').trim() || 'A wild sighting';
};

/** Area only when the explorer chose to show it and the species isn't flagged as sensitive. */
export const publicArea = (post: any): string => {
  if (!post || post.showLocation === false || post.aiFlags?.sensitiveSpecies) return '';
  return String(post.locationArea || '').trim();
};

/** "Indian Roller, seen near Jaipur on NatureGram" */
export const shareLine = (post: any): string => {
  const area = publicArea(post);
  return `${speciesOf(post)}, seen${area ? ` near ${area}` : ''} on NatureGram`;
};

/** A plate built from a post (or one item of a multi-item post). */
export const plateFromPost = (post: CommunityPost, activeItemIndex = 0): PlateData => {
  const item: any = post.items && post.items.length > 0 ? (post.items[activeItemIndex] || post.items[0]) : post;
  const ms = toMs(post.timestamp);
  const labels: string[] = item.labels || post.labels || [];
  const sci = (labels[1] && /^[A-Z][a-z]+ [a-z]+/.test(labels[1])) ? labels[1]
    : (item.aiIdentifications?.[0]?.scientificName || undefined);
  const raw = item.thumbnailUrl || item.imageUrl || post.thumbnailUrl || post.imageUrl;
  return {
    name: speciesOf({ ...post, labels }),
    scientific: sci,
    thumb: raw ? getCorsProxyUrl(raw) : undefined,
    firstMs: ms || undefined,
    place: publicArea({ ...post, ...item, showLocation: item.showLocation ?? post.showLocation }) || undefined,
    season: ms ? seasonOf(ms, item.rawLocation?.lat ?? post.rawLocation?.lat) : undefined,
    group: groupOf({ ...post, labels }),
  };
};

export interface ShareSheetProps {
  post: CommunityPost;
  activeItemIndex?: number;
  onClose: () => void;
  /** Shown only when the caller can open a letter with this sighting attached. */
  onSendLetter?: (post: CommunityPost) => void;
  /** Lets the author save the original photograph or recording as well as the plate. */
  allowMediaDownload?: boolean;
}

const ShareSheet: React.FC<ShareSheetProps> = ({ post, activeItemIndex = 0, onClose, onSendLetter, allowMediaDownload }) => {
  const plate = useMemo(() => plateFromPost(post, activeItemIndex), [post, activeItemIndex]);
  const url = post.sourceUrl || getShareUrl(post.id);
  const text = shareLine({ ...post, ...(post.items?.[activeItemIndex] || {}), showLocation: post.showLocation, aiFlags: post.aiFlags });
  const [preview, setPreview] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true; let made: string | null = null;
    renderPlate({ ...plate, line: text, accent: themeAccent() }).then(b => {
      if (!alive) return;
      if (b) { made = URL.createObjectURL(b); setPreview(made); } else setPreviewFailed(true);
    }).catch(() => alive && setPreviewFailed(true));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [plate, text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(''), 2400); };

  const doShare = async () => {
    setBusy(true);
    track('share', { kind: 'plate', native: !!(navigator as any).canShare });
    const r = await sharePlate({ ...plate, line: text, accent: themeAccent() }, { text, url });
    setBusy(false);
    if (r === 'shared') onClose();
    // glossary-ok: the plate image made from the sighting
    else if (r === 'downloaded') flash('Plate saved. Attach it wherever you like.');
    // glossary-ok: the plate image
    else if (r === 'failed') flash("The plate couldn't be made. Try copying the link instead.");
  };

  const copyLink = async () => {
    track('share', { kind: 'link' });
    try { await navigator.clipboard.writeText(`${text}\n${url}`); flash('Link copied'); }
    catch { flash(url); }
  };

  const downloadMedia = async () => {
    const item: any = post.items && post.items.length > 0 ? post.items[activeItemIndex] : post;
    const src = item.mediaType === 'video' ? item.videoUrl : item.mediaType === 'audio' ? item.audioUrl : (item.originalImageUrl || item.imageUrl || item.thumbnailUrl);
    if (!src) return;
    const ext = item.mediaType === 'video' ? 'mp4' : item.mediaType === 'audio' ? 'mp3' : 'jpg';
    try {
      const r = await fetch(getCorsProxyUrl(src), { mode: 'cors' });
      if (!r.ok) throw new Error('fetch');
      const href = URL.createObjectURL(await r.blob());
      const a = document.createElement('a'); a.href = href; a.download = `${plate.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 3000);
    } catch { window.open(src, '_blank', 'noopener'); }
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={`Share ${plate.name}`}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 ng-scrim" onClick={onClose} aria-hidden="true" />
      <motion.div
        initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
        className="relative w-full sm:max-w-sm ng-sheet max-h-[92dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="min-w-0">
            <h2 className="ng-subtitle">Share this sighting</h2>
            <p className="ng-small text-stone-500 mt-1 truncate">{text}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="ng-icon-button -mr-2 -mt-1">
            <Glyph name="close" size={24} />
          </button>
        </header>

        <div className="px-8 pt-6">
          <div className="mx-auto w-full max-w-[240px] aspect-[4/5] rounded-md bg-[#fbf7ef] border border-[#e8dfcd] overflow-hidden flex items-center justify-center">
            {preview
              // glossary-ok: the plate image preview
              ? <img src={preview} alt={`A plate of ${plate.name}`} className="w-full h-full object-contain" />
              : previewFailed
                ? <span className="flex flex-col items-center gap-3 text-stone-500 px-4 text-center"><Glyph name="plate" size={32} strokeWidth={1.2} /><span className="text-xs leading-[1.5]">The preview couldn't be drawn, but the link still works.</span></span>
                // glossary-ok: the plate image
                : <span className="flex flex-col items-center gap-3 text-stone-400"><Glyph name="press" size={32} strokeWidth={1.2} /><span className="text-xs font-display italic text-stone-500">Pressing the plate…</span></span>}
          </div>
        </div>

        <div className="px-6 pt-6 flex flex-col">
          <button onClick={doShare} disabled={busy || previewFailed} className="ng-button-primary w-full">
            <Glyph name="share" size={20} className="ng-arrow" />{/* glossary-ok: the plate image */}
            {busy ? 'Preparing…' : 'Share as a plate'}
          </button>
          <button onClick={copyLink} className="mt-4 w-full min-h-[52px] border-b border-stone-200/80 text-stone-800 hover:text-stone-900 text-[15px] font-medium flex items-center gap-4 transition-colors">
            <Glyph name="link" size={20} className="text-stone-500" />Copy link
          </button>
          {onSendLetter && (
            <button onClick={() => { track('share', { kind: 'letter' }); onSendLetter(post); onClose(); }} className="w-full min-h-[52px] border-b border-stone-200/80 text-stone-800 hover:text-stone-900 text-[15px] font-medium flex items-center gap-4 transition-colors">
              <Glyph name="sealed" size={20} className="text-stone-500" />Send in a letter<span className="text-xs font-normal text-stone-500">(link copied)</span>
            </button>
          )}
          {allowMediaDownload && (
            <button onClick={downloadMedia} className="mt-4 self-center ng-link-quiet min-h-[44px]">
              Save the original {post.mediaType === 'video' ? 'film' : post.mediaType === 'audio' ? 'recording' : 'photograph'}
            </button>
          )}
          <p role="status" aria-live="polite" className="min-h-[1.25rem] mt-2 text-center ng-small">{note}</p>
        </div>
      </motion.div>
    </div>
  );
};

export default ShareSheet;
