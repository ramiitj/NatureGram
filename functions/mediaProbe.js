/**
 * Pure helpers for the poster and preview work in index.js (no Firebase, no ffmpeg), so they can be
 * unit-tested from server/test. Keep LQIP_RE and the limits in step with server/media.js.
 */

export const LQIP_RE = /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const LQIP_MAX = 1000;
export const MAX_DIM = 20000;

export const cleanLqip = (v) => (typeof v === 'string' && v.length <= LQIP_MAX && LQIP_RE.test(v) ? v : null);
export const cleanTint = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
export const cleanDim = (v) => (Number.isInteger(v) && v > 0 && v <= MAX_DIM ? v : null);
export const aspectOf = (w, h) => (cleanDim(w) && cleanDim(h) ? Math.round((w / h) * 10000) / 10000 : null);

/** The storage path behind a Firebase download URL ("videos/uid/x.webm"), or null. */
export function storagePathOf(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return null;
    if (u.hostname === 'firebasestorage.googleapis.com') {
      const m = /^\/v0\/b\/[^/]+\/o\/(.+)$/.exec(u.pathname);
      return m ? decodeURIComponent(m[1]) : null;
    }
    if (u.hostname === 'storage.googleapis.com') {
      const m = /^\/[^/]+\/(.+)$/.exec(u.pathname);
      return m ? decodeURIComponent(m[1]) : null;
    }
  } catch { /* not a URL */ }
  return null;
}

/** Storage paths of a post's clips and recordings (post and items), the key the poster job finds posts by. */
export function mediaPathsOf(post) {
  const p = post && typeof post === 'object' ? post : {};
  const all = [p, ...(Array.isArray(p.items) ? p.items : [])];
  const out = new Set();
  for (const i of all) {
    for (const u of [i?.videoUrl, i?.audioUrl]) {
      const path = u ? storagePathOf(u) : null;
      if (path && !path.includes('..') && /^(videos|audio|drafts)\/[^/]+\/[^/]+$/.test(path)) out.add(path);
    }
  }
  return [...out].slice(0, 24);
}

/**
 * Reads `ffmpeg -i file` stderr (ffmpeg-static ships no ffprobe). Cover art in sound files
 * ("attached pic") is not a picture stream. Phone clips carry a rotation, so width and height swap.
 */
export function parseProbe(stderr) {
  let hasVideo = false, hasAudio = false, w = 0, h = 0, rotate = 0, duration = 0;
  for (const line of String(stderr || '').split('\n')) {
    if (/Stream #\d+:\d+.*?: Video:/.test(line) && !/\(attached pic\)/.test(line)) {
      if (!hasVideo) {
        const m = /,\s*(\d{2,5})x(\d{2,5})(?=[\s,[]|$)/.exec(line);
        if (m) { w = Number(m[1]); h = Number(m[2]); }
      }
      hasVideo = true;
    } else if (/Stream #\d+:\d+.*?: Audio:/.test(line)) {
      hasAudio = true;
    }
    const r = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(line) || /^\s*rotate\s*:\s*(-?\d+)/.exec(line);
    if (r && !rotate) rotate = Math.round(Number(r[1]));
    const d = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line);
    if (d) duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  }
  if (Math.abs(rotate) % 180 === 90) [w, h] = [h, w];
  return { hasVideo, hasAudio, w, h, duration };
}

const empty = (v) => v === undefined || v === null || v === '';

/**
 * The fields to add to one record (post, item or feed entry), never touching one that is already set.
 * media: { posterUrl, posterSmallUrl, w, h, lqip, tint, soundOnly }
 */
export function fillEmpty(target, media, { thumbs = true } = {}) {
  const t = target && typeof target === 'object' ? target : {};
  const out = {};
  if (media.soundOnly === true) {
    if (t.soundOnly !== true) out.soundOnly = true;
    return out;
  }
  if (thumbs && media.posterUrl) {
    if (empty(t.thumbnailUrl)) out.thumbnailUrl = media.posterUrl;
    if (empty(t.thumbSmallUrl)) out.thumbSmallUrl = media.posterSmallUrl || media.posterUrl;
  }
  if (media.posterUrl && empty(t.posterUrl)) out.posterUrl = media.posterUrl;
  // The quick-start streaming copy (720p-class H.264, moov first) that the app plays instead of the original
  if (typeof media.streamUrl === 'string' && /^https:\/\//.test(media.streamUrl) && empty(t.streamUrl)) out.streamUrl = media.streamUrl;
  const w = cleanDim(media.w), h = cleanDim(media.h);
  if (w && h && empty(t.w) && empty(t.h)) {
    out.w = w; out.h = h;
    if (empty(t.aspect)) out.aspect = aspectOf(w, h);
  }
  const lqip = cleanLqip(media.lqip);
  if (lqip && empty(t.lqip)) out.lqip = lqip;
  const tint = cleanTint(media.tint);
  if (tint && empty(t.tint)) out.tint = tint;
  return out;
}

/**
 * Which parts of a post one clip's poster belongs to. Returns { post, top } where `post` is the
 * update for the post document (items rewritten whole, as Firestore needs) and `top` the fields
 * that also go on its feed entry. Null when there is nothing to add.
 */
export function planPostFill(post, path, media) {
  const p = post && typeof post === 'object' ? post : {};
  const update = {};
  const items = Array.isArray(p.items) ? p.items : null;
  let itemsChanged = false;
  const nextItems = items ? items.map((it) => {
    if (!it || storagePathOf(it.videoUrl) !== path) return it;
    const add = fillEmpty(it, media);
    if (!Object.keys(add).length) return it;
    itemsChanged = true;
    return { ...it, ...add };
  }) : null;
  if (itemsChanged) update.items = nextItems;

  const topPath = storagePathOf(p.videoUrl) || (!p.videoUrl && items ? storagePathOf(items[0]?.videoUrl) : null);
  let top = null;
  if (topPath === path) {
    top = fillEmpty(p, media);
    Object.assign(update, top);
  }
  if (!Array.isArray(p.mediaPaths)) {
    const paths = mediaPathsOf(p);
    if (paths.length) update.mediaPaths = paths;
  }
  return Object.keys(update).length ? { post: update, top: top && Object.keys(top).length ? top : null } : null;
}

/** Whether a post still needs the poster job: a clip with no still, preview or size (and not known to be sound only). */
export function needsPoster(p) {
  if (!p || typeof p !== 'object') return false;
  const isVideo = p.mediaType === 'video' || !!p.videoUrl;
  if (isVideo) {
    if (p.soundOnly === true) return !Array.isArray(p.mediaPaths) && mediaPathsOf(p).length > 0;
    return !(p.thumbnailUrl || p.posterUrl) || !p.lqip || !p.w || !p.h || !p.streamUrl || !Array.isArray(p.mediaPaths);
  }
  const hasPicture = !!(p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl);
  if (hasPicture && (!p.lqip || !p.w || !p.h)) return true;
  return !Array.isArray(p.mediaPaths) && mediaPathsOf(p).length > 0;
}
