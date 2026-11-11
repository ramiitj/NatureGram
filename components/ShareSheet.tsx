import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import { CommunityPost } from '../types';
import { getShareUrl } from '../utils';
import { track } from '../services/analytics';
import { getCorsProxyUrl } from '../services/firebaseService';
import { renderPlate, sharePlateBlob } from '../services/plateImage';
import { groupOf, seasonOf, toMs, namesOf } from '../services/lifeList';
import { useBackToClose } from '../services/overlayStack';
import { PlateData } from './SpecimenPlate';
import Glyph from './Glyph';

/**
 * One share sheet for every sighting: it shows the specimen plate that will be sent, so the
 * explorer sees exactly what a friend will receive, then offers three plain choices. The share
 * text always leads with the species' common name ("Indian Roller, seen near Jaipur on NatureGram").
 */

const IGNORE = /^(unknown|nature|unidentified|observation|captured|uploaded|sighting)$/i;

/** The theme accent as an rgb() string, for the line of text on the rendered plate. */
export const themeAccent = (): string | undefined => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--theme-accent-rgb').trim();
    return v ? `rgb(${v.split(/[\s,]+/).join(',')})` : undefined;
  } catch { return undefined; }
};

/** The first label for a sighting, never a placeholder (kept for callers that compare with labels[0]). */
export const speciesOf = (post: Partial<CommunityPost> | null | undefined): string => {
  const l = (post?.labels?.[0] || '').trim();
  if (l && !IGNORE.test(l)) return l;
  return (post?.title || '').trim() || 'A wild sighting';
};

/** The name to lead with: the common name first (namesOf), never a placeholder. */
export const leadNameOf = (post: any): string => {
  const n = (namesOf(post).common || '').trim();
  if (n && !IGNORE.test(n)) return n;
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
  return `${leadNameOf(post)}, seen${area ? ` near ${area}` : ''} on NatureGram`;
};

const isSound = (item: any, post: any) => item?.mediaType === 'audio' || post?.soundOnly === true || item?.soundOnly === true;

/** A plate built from a post (or one item of a multi-item post). */
export const plateFromPost = (post: CommunityPost, activeItemIndex = 0): PlateData => {
  const item: any = post.items && post.items.length > 0 ? (post.items[activeItemIndex] || post.items[0]) : post;
  const ms = toMs(post.timestamp);
  const labels: string[] = item.labels || post.labels || [];
  const names = namesOf({ ...post, ...item, labels, aiIdentifications: item.aiIdentifications || (post as any).aiIdentifications });
  const raw = item.thumbnailUrl || item.imageUrl || post.thumbnailUrl || post.imageUrl;
  return {
    name: leadNameOf({ ...post, ...item, labels, aiIdentifications: item.aiIdentifications || (post as any).aiIdentifications }),
    scientific: names.latin || (item.aiIdentifications?.[0]?.scientificName && item.aiIdentifications[0].scientificName !== names.common ? item.aiIdentifications[0].scientificName : undefined),
    thumb: raw ? getCorsProxyUrl(raw) : undefined,
    firstMs: ms || undefined,
    place: publicArea({ ...post, ...item, showLocation: item.showLocation ?? post.showLocation }) || undefined,
    season: ms ? seasonOf(ms, item.rawLocation?.lat ?? post.rawLocation?.lat) : undefined,
    group: groupOf({ ...post, labels }),
    sound: isSound(item, post),
  };
};

/** The file extension for a downloaded original, from its real type (or its URL when the type is vague). */
export const extensionFor = (mime: string, url: string, mediaType?: string): string => {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  const byMime: Record<string, string> = {
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'video/3gpp': '3gp',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm',
    'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/flac': 'flac',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif', 'image/gif': 'gif',
  };
  if (byMime[m]) return byMime[m];
  try {
    const path = decodeURIComponent(new URL(url, 'https://x.invalid').pathname);
    const ext = /\.([a-z0-9]{2,5})$/i.exec(path)?.[1]?.toLowerCase();
    if (ext) return ext === 'jpeg' ? 'jpg' : ext;
  } catch { /* fall through */ }
  return mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'm4a' : 'jpg';
};

export interface ShareSheetProps {
  post: CommunityPost;
  activeItemIndex?: number;
  onClose: () => void;
  /** Shown only when the caller can open a letter with this sighting attached. */
  onSendLetter?: (post: CommunityPost) => void;
  /** Lets the author save the original photograph or recording as well as the plate. */
  allowMediaDownload?: boolean;
  /** Where the sheet was opened, for the share event ('post', 'moments') */
  surface?: string;
}

const ShareSheet: React.FC<ShareSheetProps> = ({ post, activeItemIndex = 0, onClose, onSendLetter, allowMediaDownload, surface = 'post' }) => {
  const { close } = useBackToClose(true, onClose);
  const plate = useMemo(() => plateFromPost(post, activeItemIndex), [post, activeItemIndex]);
  const url = post.sourceUrl || getShareUrl(post.id);
  const text = shareLine({ ...post, ...(post.items?.[activeItemIndex] || {}), showLocation: post.showLocation, aiFlags: post.aiFlags });
  const [preview, setPreview] = useState<string | null>(null);
  // The plate is drawn once, as soon as the sheet opens; sharing sends this very image, so the
  // tap goes straight to the share sheet (iOS refuses navigator.share after a slow await).
  const blobRef = useRef<Blob | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true; let made: string | null = null;
    blobRef.current = null;
    renderPlate({ ...plate, line: text, accent: themeAccent() }).then(b => {
      if (!alive) return;
      if (b) { blobRef.current = b; made = URL.createObjectURL(b); setPreview(made); } else setPreviewFailed(true);
    }).catch(() => alive && setPreviewFailed(true));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [plate, text]);

  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(''), 2400); };

  const doShare = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    setBusy(true);
    track('share', { surface, method: 'plate', native: !!(navigator as any).canShare });
    const r = await sharePlateBlob(blob, plate.name, { text, url });
    setBusy(false);
    if (r === 'shared') close();
    // glossary-ok: the plate image made from the sighting
    else if (r === 'downloaded') flash('Plate saved. Attach it wherever you like.');
    // glossary-ok: the plate image
    else if (r === 'failed') flash("The plate couldn't be shared. Try copying the link instead.");
  };

  const copyLink = async () => {
    track('share', { surface, method: 'link' });
    try { await navigator.clipboard.writeText(`${text}\n${url}`); flash('Link copied'); }
    catch { flash(url); }
  };

  const downloadMedia = async () => {
    const item: any = post.items && post.items.length > 0 ? post.items[activeItemIndex] : post;
    const src = item.mediaType === 'video' ? item.videoUrl : item.mediaType === 'audio' ? item.audioUrl : (item.originalImageUrl || item.imageUrl || item.thumbnailUrl);
    if (!src) return;
    try {
      const r = await fetch(getCorsProxyUrl(src), { mode: 'cors' });
      if (!r.ok) throw new Error('fetch');
      const blob = await r.blob();
      const ext = extensionFor(blob.type || r.headers.get('content-type') || '', src, item.mediaType);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = href; a.download = `${plate.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 3000);
    } catch { window.open(src, '_blank', 'noopener'); }
  };

  return (
    <MotionConfig reducedMotion="user">
    <div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 ng-scrim" onClick={close} aria-hidden="true" />
      <motion.div
        initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
        className="relative w-full sm:max-w-sm ng-sheet max-h-[92dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="min-w-0">
            <h2 id="share-title" className="ng-subtitle">Share this sighting</h2>
            <p className="ng-small text-stone-500 mt-1 truncate">{text}</p>
          </div>
          <button onClick={close} aria-label="Close" className="ng-icon-button -mr-2 -mt-1">
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
          <button onClick={doShare} disabled={busy || previewFailed || !preview} className="ng-button-primary w-full">
            <Glyph name="share" size={20} className="ng-arrow" />{/* glossary-ok: the plate image */}
            {busy ? 'Preparing…' : 'Share as a plate'}
          </button>
          <button onClick={copyLink} className="mt-4 w-full min-h-[52px] border-b border-stone-200/80 text-stone-800 hover:text-stone-900 text-[15px] font-medium flex items-center gap-4 transition-colors">
            <Glyph name="link" size={20} className="text-stone-500" />Copy link
          </button>
          {onSendLetter && (
            <button onClick={() => { track('share', { surface, method: 'letter' }); onSendLetter(post); close(); }} className="w-full min-h-[52px] border-b border-stone-200/80 text-stone-800 hover:text-stone-900 text-[15px] font-medium flex items-center gap-4 transition-colors">
              <Glyph name="sealed" size={20} className="text-stone-500" />Send in a letter
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
    </MotionConfig>
  );
};

export default ShareSheet;
