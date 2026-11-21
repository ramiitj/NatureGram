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

/**
 * Still frames from a video, for identifying clips too large to send whole (phone videos are often
 * 40 to 60 MB). Frames are spread through the clip, at most 1024 px wide, as JPEG. Resolves with
 * whatever frames could be read (possibly none); never throws.
 */
export async function videoKeyframes(video: Blob, count = 4): Promise<Blob[]> {
  if (typeof document === 'undefined') return [];
  const url = URL.createObjectURL(video);
  const el = document.createElement('video');
  el.muted = true; el.playsInline = true; el.preload = 'auto'; el.src = url;
  const once = (ev: string, ms = 8000) => new Promise<boolean>(res => {
    const t = setTimeout(() => res(false), ms);
    el.addEventListener(ev, () => { clearTimeout(t); res(true); }, { once: true });
    el.addEventListener('error', () => { clearTimeout(t); res(false); }, { once: true });
  });
  const out: Blob[] = [];
  try {
    if (!(await once('loadedmetadata'))) return out;
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    const scale = Math.min(1, 1024 / Math.max(el.videoWidth || 1, el.videoHeight || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((el.videoWidth || 640) * scale));
    canvas.height = Math.max(1, Math.round((el.videoHeight || 480) * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return out;
    const times = dur ? Array.from({ length: count }, (_, i) => dur * (0.12 + (0.76 * i) / Math.max(1, count - 1))) : [0];
    for (const t of times) {
      el.currentTime = Math.min(Math.max(0, t), Math.max(0, dur - 0.05));
      if (!(await once('seeked', 5000))) continue;
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.82));
      if (blob && blob.size > 2000) out.push(blob);
    }
  } catch { /* whatever frames were read are returned */ }
  finally { URL.revokeObjectURL(url); el.removeAttribute('src'); el.load?.(); }
  return out;
}

// ---------------------------------------------------------------- media formats
/**
 * Formats the guide (Gemini) can read, from Google's documentation (Nov 2026):
 *  images  JPEG, PNG, WebP, HEIC, HEIF
 *  video   MP4, MOV, AVI, WMV, FLV, MPEG/MPG, WebM, 3GP (not MKV)
 *  audio   WAV, MP3, AAC, M4A, AIFF, FLAC, OGG, Opus, WebM, MPEG
 * Browsers often leave file.type empty or use other names (video/quicktime, audio/x-m4a), so the
 * kind is worked out from the extension too, and the type is renamed to the one Gemini expects.
 */
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', hif: 'image/heif', gif: 'image/gif', bmp: 'image/bmp',
  tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime', avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv', flv: 'video/x-flv', mpg: 'video/mpeg', mpeg: 'video/mpeg', webm: 'video/webm',
  '3gp': 'video/3gpp', '3g2': 'video/3gpp2', mkv: 'video/x-matroska', mts: 'video/mp2t', m2ts: 'video/mp2t',
  wav: 'audio/wav', mp3: 'audio/mpeg', aac: 'audio/aac', m4a: 'audio/mp4', aif: 'audio/aiff', aiff: 'audio/aiff',
  flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', weba: 'audio/webm', caf: 'audio/x-caf', amr: 'audio/amr',
};
/** What the file picker should offer: every kind, plus extensions some systems don't map to a kind. */
export const MEDIA_ACCEPT = 'image/*,video/*,audio/*,' + Object.keys(EXT_MIME).map(e => `.${e}`).join(',');

const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name || '')?.[1] || '').toLowerCase();

/** The file's real type: what the browser says, or what its extension says when the browser says nothing. */
export const mimeOf = (file: { type?: string; name?: string }) => {
  const t = String(file.type || '').toLowerCase();
  if (t && t !== 'application/octet-stream') return t;
  return EXT_MIME[extOf(file.name || '')] || '';
};

export const kindOf = (file: { type?: string; name?: string }): 'image' | 'video' | 'audio' | null => {
  const t = mimeOf(file);
  return t.startsWith('image/') ? 'image' : t.startsWith('video/') ? 'video' : t.startsWith('audio/') ? 'audio' : null;
};

/** The name Gemini expects for a type (it reads video/mov, not video/quicktime; audio/m4a, not audio/x-m4a). */
export const geminiMime = (type: string): string => {
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg',
    'video/quicktime': 'video/mov', 'video/x-msvideo': 'video/avi', 'video/msvideo': 'video/avi', 'video/x-ms-wmv': 'video/wmv',
    'video/3gpp2': 'video/3gpp', 'video/x-m4v': 'video/mp4', 'video/mpg': 'video/mpeg',
    'audio/x-m4a': 'audio/m4a', 'audio/mp4': 'audio/m4a', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav',
    'audio/x-aiff': 'audio/aiff', 'audio/x-flac': 'audio/flac', 'audio/mp3': 'audio/mpeg', 'audio/x-mpeg': 'audio/mpeg',
  };
  return map[t] || t;
};

/** Types Gemini reads directly (after geminiMime). */
const GEMINI_READS = /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|mpeg|mov|avi|x-flv|webm|wmv|3gpp)|audio\/(wav|mp3|mpeg|aiff|aac|ogg|flac|m4a|opus|webm|l16|alaw|mulaw))$/;
export const geminiCanRead = (type: string) => GEMINI_READS.test(geminiMime(type));

/** HEIC/HEIF that this browser can't draw (everything but Safari): turn it into a JPEG on the device. */
async function heicToJpeg(file: File): Promise<File> {
  // The CSP-safe build (no WebAssembly or eval), loaded only when a HEIC photo arrives
  const { heicTo } = await import('heic-to/csp');
  const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
  return new File([jpeg], file.name.replace(/\.(heic|heif|hif)$/i, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
}

const canDraw = (blob: Blob) => new Promise<boolean>(res => {
  const url = URL.createObjectURL(blob); const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); res(img.naturalWidth > 0); };
  img.onerror = () => { URL.revokeObjectURL(url); res(false); };
  img.src = url;
});

/**
 * Make a chosen file one the guide and the app can use: a known type, HEIC turned into JPEG where
 * the browser can't show it, and other picture types (GIF, BMP, TIFF, AVIF) into JPEG. Videos and
 * sounds keep their bytes and get their proper type. Returns an error to show for files that can't be used.
 */
export async function prepareMediaFile(file: File): Promise<{ file: File; kind: 'image' | 'video' | 'audio' } | { error: string }> {
  const kind = kindOf(file);
  if (!kind) return { error: "isn't a photo, video or sound NatureGram can read." };
  const type = mimeOf(file);
  let out = type && type !== file.type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file;
  if (kind === 'image') {
    if (/heic|heif/.test(type) && !(await canDraw(out))) {
      try { out = await heicToJpeg(out); } catch { return { error: "is an iPhone photo (HEIC) this browser couldn't open. Try sharing it as JPEG ('Most compatible' in the iPhone camera settings)." }; }
    } else if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(type)) {
      if (!(await canDraw(out))) return { error: "is a picture format this browser can't open. Save it as JPEG or PNG and try again." };
      try {
        const bmp = await createImageBitmap(out);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d')!.drawImage(bmp, 0, 0);
        const jpeg = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.92));
        if (!jpeg) throw new Error('encode');
        out = new File([jpeg], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
      } catch { return { error: "couldn't be converted to JPEG here. Save it as JPEG and try again." }; }
    }
  }
  return { file: out, kind };
}

/** A file extension for a stored file of this type (so the streaming copy and players know what it is). */
export const extForMime = (type: string, kind: 'image' | 'video' | 'audio'): string => {
  const t = String(type || '').toLowerCase().split(';')[0];
  const map: Record<string, string> = {
    'video/mp4': 'mp4', 'video/x-m4v': 'm4v', 'video/quicktime': 'mov', 'video/mov': 'mov', 'video/webm': 'webm', 'video/x-msvideo': 'avi', 'video/avi': 'avi',
    'video/x-ms-wmv': 'wmv', 'video/wmv': 'wmv', 'video/x-flv': 'flv', 'video/mpeg': 'mpg', 'video/3gpp': '3gp', 'video/3gpp2': '3g2', 'video/x-matroska': 'mkv', 'video/mp2t': 'mts',
    'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac',
    'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/aiff': 'aiff', 'audio/x-aiff': 'aiff', 'audio/opus': 'opus', 'audio/webm': 'webm',
    'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg',
  };
  return map[t] || (kind === 'video' ? 'mp4' : kind === 'audio' ? 'm4a' : 'jpg');
};
