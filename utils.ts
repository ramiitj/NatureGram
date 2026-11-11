export const hapticFeedback = (pattern: number | number[] = 50) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(pattern);
    }
};

/** Shown when a picture can't be re-drawn, so its hidden location data can't be removed. */
export const UNCLEANABLE_IMAGE_MESSAGE = "This photo's format can't be cleaned of its location. Save it as JPEG and try again.";

/** Thrown instead of ever handing back a picture that still carries its metadata. */
export class ImageCleanError extends Error {
    constructor(message = UNCLEANABLE_IMAGE_MESSAGE) {
        super(message);
        this.name = 'ImageCleanError';
    }
}

type Drawable = { source: CanvasImageSource; width: number; height: number; release: () => void };

/** Decode a picture by every road the browser offers: an <img> first, then createImageBitmap. */
const decodeImage = async (blob: Blob): Promise<Drawable | null> => {
    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = url;
        });
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (width && height) return { source: img, width, height, release: () => URL.revokeObjectURL(url) };
    } catch { /* try the next decoder */ }
    URL.revokeObjectURL(url);
    if (typeof createImageBitmap === 'function') {
        try {
            const bmp = await createImageBitmap(blob);
            if (bmp.width && bmp.height) return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close?.() };
            bmp.close?.();
        } catch { /* not decodable here */ }
    }
    return null;
};

/** True when this browser can re-draw the picture (and so strip its EXIF/GPS) before upload. */
export const canCleanImage = async (blob: Blob): Promise<boolean> => {
    if (blob.type === 'image/gif') return true;
    const d = await decodeImage(blob);
    d?.release();
    return !!d;
};

/**
 * Re-encodes an image through a canvas. This always strips EXIF/GPS metadata
 * (privacy) and bounds the longest side to `maxDim` pixels.
 * Blobs that say they are not images (sound, video) and GIFs are returned unchanged.
 * A picture that can't be decoded or drawn is never returned as it came: this throws
 * ImageCleanError instead, so an original with GPS can't reach the public bucket.
 */
export const reencodeImage = async (
    blob: Blob,
    maxDim = 2048,
    type: 'image/jpeg' | 'image/webp' = 'image/jpeg',
    quality = 0.88
): Promise<Blob> => {
    if ((blob.type && !blob.type.startsWith('image/')) || blob.type === 'image/gif') return blob;
    const decoded = await decodeImage(blob);
    if (!decoded) throw new ImageCleanError();
    try {
        // A very large picture can exhaust canvas memory: try once more at half the size
        for (const dim of [maxDim, Math.round(maxDim / 2)]) {
            const scale = Math.min(1, dim / Math.max(decoded.width, decoded.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(decoded.width * scale));
            canvas.height = Math.max(1, Math.round(decoded.height * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
            const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
            if (out) return out;
        }
        throw new ImageCleanError();
    } finally {
        decoded.release();
    }
};

/** Feed thumbnail: metadata-free WebP, longest side <= maxWidth. */
export const generateThumbnail = (blob: Blob, maxWidth = 800): Promise<Blob> =>
    reencodeImage(blob, maxWidth, 'image/webp', 0.8);

/** Round coordinates to ~1 km so approximate location never reveals a home or nest. */
export const coarsenCoordinate = (v: number, decimals = 2) => Math.round(v * 10 ** decimals) / 10 ** decimals;

/** Canonical public origin used for share links (never a preview or localhost URL). */
export const PUBLIC_ORIGIN = 'https://thenaturegram.com';
export const getShareUrl = (postId: string) => `${PUBLIC_ORIGIN}/s/${encodeURIComponent(postId)}`;

/** Only open http(s) URLs, and always without giving the new page access to this one. */
export const openExternal = (url?: string | null) => {
    if (!url) return;
    try {
        const u = new URL(url, window.location.href);
        if (u.protocol !== 'https:' && u.protocol !== 'http:' && u.protocol !== 'blob:') return;
        window.open(u.toString(), '_blank', 'noopener,noreferrer');
    } catch { /* ignore malformed */ }
};

/** Compact relative time ("now", "5m", "3h", "2d", "Mar 4") for feeds and notifications. */
export const timeAgo = (ts: any): string => {
    let ms = 0;
    if (!ts) return '';
    if (typeof ts?.toMillis === 'function') ms = ts.toMillis();
    else if (typeof ts?.seconds === 'number') ms = ts.seconds * 1000;
    else if (ts instanceof Date) ms = ts.getTime();
    else ms = new Date(ts).getTime();
    if (!ms || Number.isNaN(ms)) return '';
    const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(Date.now() - ms > 300 * 86400000 ? { year: 'numeric' } : {}) });
};

/** Total likes across scalable like documents (likeCount) and legacy array likes. */
export const likeTotal = (p: { likeCount?: number; likes?: string[] } | null | undefined) =>
    Math.max(0, (p?.likeCount || 0) + (p?.likes?.length || 0));


const PROMO_WORDS = new Set(['youtube', 'facebook', 'instagram', 'telegram', 'whatsapp', 'tiktok', 'snapchat', 'twitter', 'guna', 'rummy', 'casino', 'betting', 'jackpot', 'lottery', 'loan', 'crypto', 'forex', 'followers', 'subscribe']);

/**
 * Field-note spam: links, or short notes made mostly of platform and promotion words
 * ("YouTube Facebook Instagram", "500 Guna game"). Deliberately narrow so real notes pass.
 */
export const looksLikeSpam = (text: string): boolean => {
  const t = (text || '').toLowerCase();
  if (/https?:\/\/|www\.|\.(com|net|xyz|io)\b/.test(t)) return true;
  const words = t.match(/[a-z]+/g) || [];
  if (!words.length) return false;
  const hits = words.filter(w => PROMO_WORDS.has(w)).length;
  return words.length <= 8 && hits >= 1 && hits * 2 >= words.length;
};

/** True when the explorer has asked to save data, or the connection is very slow. */
export const isDataSaver = (): boolean => {
  try {
    const c: any = (navigator as any).connection;
    return !!c && (c.saveData === true || /(^|-)2g$/.test(String(c.effectiveType || '')));
  } catch { return false; }
};
