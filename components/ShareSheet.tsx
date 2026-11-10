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
    else if (r === 'downloaded') flash('Plate saved. Attach it wherever you like.');
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
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-stone-900/60" onClick={onClose} aria-hidden="true" />
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', damping: 26, stiffness: 300 }}
        className="relative w-full sm:max-w-sm bg-day-bg rounded-t-[1.75rem] sm:rounded-[1.75rem] max-h-[92dvh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <header className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <h2 className="font-display text-xl text-theme-primary leading-tight">Share this plate</h2>
            <p className="text-sm text-stone-500 mt-0.5 truncate">{text}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 w-11 h-11 -mr-2 -mt-1 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>

        <div className="px-8 pt-4">
          <div className="mx-auto w-full max-w-[240px] aspect-[4/5] rounded-[3px] bg-[#fbf7ef] shadow-[0_1px_2px_rgba(60,40,20,0.12),0_10px_28px_-10px_rgba(60,40,20,0.35)] overflow-hidden flex items-center justify-center">
            {preview
              ? <img src={preview} alt={`Specimen plate of ${plate.name}`} className="w-full h-full object-contain" />
              : previewFailed
                ? <span className="flex flex-col items-center gap-2 text-[#8a7a60] px-4 text-center"><Glyph name="plate" size={36} /><span className="text-xs">The preview couldn't be drawn, but the link still works.</span></span>
                : <span className="flex flex-col items-center gap-2 text-[#b9a98a]"><Glyph name="press" size={36} className="animate-pulse" /><span className="text-xs">Pressing the plate…</span></span>}
          </div>
        </div>

        <div className="px-5 pt-5 flex flex-col gap-2">
          <button onClick={doShare} disabled={busy || previewFailed} className="w-full py-3.5 rounded-2xl bg-theme-primary text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            <span className="material-symbols-outlined text-xl" aria-hidden="true">ios_share</span>{busy ? 'Preparing…' : 'Share plate'}
          </button>
          <button onClick={copyLink} className="w-full py-3 rounded-2xl border border-theme-primary/15 text-theme-primary font-semibold flex items-center justify-center gap-2 hover:bg-theme-primary/5">
            <span className="material-symbols-outlined text-xl" aria-hidden="true">link</span>Copy link
          </button>
          {onSendLetter && (
            <button onClick={() => { track('share', { kind: 'letter' }); onSendLetter(post); onClose(); }} className="w-full py-3 rounded-2xl border border-theme-primary/15 text-theme-primary font-semibold flex items-center justify-center gap-2 hover:bg-theme-primary/5">
              <Glyph name="letter" size={20} />Send as a letter
            </button>
          )}
          {allowMediaDownload && (
            <button onClick={downloadMedia} className="mt-1 text-sm text-stone-500 hover:text-theme-primary underline underline-offset-4 decoration-stone-300 py-2">
              Save the original {post.mediaType === 'video' ? 'film' : post.mediaType === 'audio' ? 'recording' : 'photograph'}
            </button>
          )}
          <p role="status" aria-live="polite" className="min-h-[1.25rem] text-center text-sm text-stone-600">{note}</p>
        </div>
      </motion.div>
    </div>
  );
};

export default ShareSheet;
