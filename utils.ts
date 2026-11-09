export const hapticFeedback = (pattern: number | number[] = 50) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(pattern);
    }
};

/**
 * Re-encodes an image through a canvas. This always strips EXIF/GPS metadata
 * (privacy) and bounds the longest side to `maxDim` pixels.
 * Non-image blobs are returned unchanged.
 */
export const reencodeImage = async (
    blob: Blob,
    maxDim = 2048,
    type: 'image/jpeg' | 'image/webp' = 'image/jpeg',
    quality = 0.88
): Promise<Blob> => {
    if (!blob.type.startsWith('image/') || blob.type === 'image/gif') return blob;
    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = url;
        });
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) return blob;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return blob;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
        return out || blob;
    } catch {
        return blob;
    } finally {
        URL.revokeObjectURL(url);
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
