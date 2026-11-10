/**
 * Previews made on the device at upload, so a sighting's tile can paint before its picture loads:
 *  - lqip: a ~16 px wide WebP (or JPEG) data URL, a few hundred bytes, shown blurred under the picture
 *  - tint: the picture's average colour, painted behind everything
 *  - w / h: its size, so the tile takes its exact shape at once
 * and, for clips, a still frame (the poster) and whether the clip has any picture at all.
 *
 * Everything here is best effort: any failure returns null and the upload carries on without it.
 * The server checks the same limits (server/media.js: data:image/(jpeg|webp);base64, at most 1000 chars).
 */

export interface MediaPreview { lqip?: string; tint?: string; w?: number; h?: number }
export interface ClipStill { poster: Blob | null; preview: MediaPreview | null; soundOnly: boolean; w?: number; h?: number }

export const LQIP_RE = /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const LQIP_MAX = 1000;
export const isLqip = (v: unknown): v is string => typeof v === 'string' && v.length <= LQIP_MAX && LQIP_RE.test(v);
export const isTint = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

const LQIP_WIDTH = 16;

/** The tiny preview and main colour of anything drawable, at its natural size w x h. */
export function previewFrom(source: CanvasImageSource, w: number, h: number): MediaPreview | null {
  if (!w || !h) return null;
  try {
    const out: MediaPreview = { w: Math.round(w), h: Math.round(h) };
    for (const width of [LQIP_WIDTH, 12]) {
      const height = Math.max(1, Math.round((width * h) / w));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = Math.min(height, 64);
      const ctx = canvas.getContext('2d');
      if (!ctx) return out;
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      if (!out.tint) {
        const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 16) continue; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
        if (n) out.tint = '#' + [r, g, b].map(c => Math.round(c / n).toString(16).padStart(2, '0')).join('');
      }
      // Safari can't encode WebP and hands back a PNG instead: use JPEG there
      let url = canvas.toDataURL('image/webp', 0.3);
      if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.5);
      if (isLqip(url)) { out.lqip = url; break; }
    }
    return out;
  } catch {
    return null; // tainted canvas or no 2D context
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>(r => window.setTimeout(() => r(null), ms))]);

/** Preview of a still image (photo, habitat picture or poster). */
export async function imagePreview(blob: Blob | null | undefined, timeoutMs = 4000): Promise<MediaPreview | null> {
  if (!blob || typeof document === 'undefined' || !blob.type.startsWith('image/')) return null;
  const url = URL.createObjectURL(blob);
  try {
    return await withTimeout(new Promise<MediaPreview | null>((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(previewFrom(img, img.naturalWidth, img.naturalHeight));
      img.onerror = () => resolve(null);
      img.src = url;
    }), timeoutMs);
  } catch { return null; } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

const once = (el: HTMLMediaElement, ok: string[], ms: number): Promise<boolean> => new Promise((resolve) => {
  const done = (v: boolean) => { clearTimeout(t); ok.forEach(e => el.removeEventListener(e, yes)); el.removeEventListener('error', no); resolve(v); };
  const yes = () => done(true);
  const no = () => done(false);
  const t = window.setTimeout(() => done(false), ms);
  ok.forEach(e => el.addEventListener(e, yes, { once: true }));
  el.addEventListener('error', no, { once: true });
});

/**
 * A still from a clip at about 0.5 s (an offscreen video and a canvas), its preview, its size, and
 * whether it has a picture at all (a recording with no video track is sound only). Never throws;
 * gives up after `timeoutMs` and returns what it has.
 */
export async function clipStill(blob: Blob | null | undefined, { at = 0.5, timeoutMs = 6000, maxDim = 1080 } = {}): Promise<ClipStill | null> {
  if (!blob || typeof document === 'undefined') return null;
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(0, deadline - Date.now());
  try {
    v.src = url;
    if (!(await once(v, ['loadedmetadata'], left()))) return null;
    // Metadata is in: no picture size means no picture track
    if (!v.videoWidth || !v.videoHeight) return { poster: null, preview: null, soundOnly: true };
    const w = v.videoWidth, h = v.videoHeight;
    if (v.readyState < 2) {
      const loaded = once(v, ['loadeddata'], Math.min(left(), 2500));
      // iOS loads no frames until playback starts; a muted inline play is always allowed
      v.play().then(() => v.pause()).catch(() => {});
      await loaded;
    }
    const target = Number.isFinite(v.duration) && v.duration > 0 ? Math.min(at, v.duration / 2) : at;
    if (target > 0 && left() > 0) {
      const seeked = once(v, ['seeked'], Math.min(left(), 2500));
      try { v.currentTime = target; } catch { /* not seekable: keep the first frame */ }
      await seeked;
    }
    if (v.readyState < 2) return { poster: null, preview: null, soundOnly: false, w, h };
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { poster: null, preview: null, soundOnly: false, w, h };
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const poster = await withTimeout(new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.85)), Math.max(500, left()));
    const preview = previewFrom(canvas, canvas.width, canvas.height);
    return { poster: poster || null, preview: preview ? { ...preview, w, h } : { w, h }, soundOnly: false, w, h };
  } catch {
    return null;
  } finally {
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* ignore */ }
    URL.revokeObjectURL(url);
  }
}

/** Storage paths of a post's clips and recordings; the poster function finds posts by them (keep in step with server/publish.js). */
export function mediaPathsOf(post: any): string[] {
  const p = post && typeof post === 'object' ? post : {};
  const out = new Set<string>();
  for (const i of [p, ...(Array.isArray(p.items) ? p.items : [])]) {
    for (const u of [i?.videoUrl, i?.audioUrl]) {
      const m = typeof u === 'string' ? /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/.exec(u) : null;
      const path = m ? decodeURIComponent(m[1]) : null;
      if (path && !path.includes('..') && /^(videos|audio)\/[^/]+\/[^/]+$/.test(path)) out.add(path);
    }
  }
  return [...out].slice(0, 24);
}
