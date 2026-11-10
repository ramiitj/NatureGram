/**
 * Feed media on the server: the blur-up preview fields a sighting carries (lqip, tint, w, h, aspect,
 * soundOnly, posterUrl), the shape of /api/feed/first, and the first tiles inlined into the page.
 *
 * The validators match functions/mediaProbe.js (the Cloud Function writes the same fields; keep the
 * two in step) and services/mediaPreview.ts (the app makes them at upload).
 */

export const LQIP_RE = /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const LQIP_MAX = 1000;
export const MAX_DIM = 20000;

export const cleanLqip = (v) => (typeof v === 'string' && v.length <= LQIP_MAX && LQIP_RE.test(v) ? v : null);
export const cleanTint = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
export const cleanDim = (v) => (Number.isInteger(v) && v > 0 && v <= MAX_DIM ? v : null);
export const aspectOf = (w, h) => (cleanDim(w) && cleanDim(h) ? Math.round((w / h) * 10000) / 10000 : null);

/** The preview fields an upload may carry, checked; only the ones present come back. */
export function previewFields(i, mediaType) {
  const src = i && typeof i === 'object' ? i : {};
  const out = {};
  const lqip = cleanLqip(src.lqip);
  if (lqip) out.lqip = lqip;
  const tint = cleanTint(src.tint);
  if (tint) out.tint = tint;
  const w = cleanDim(src.w), h = cleanDim(src.h);
  if (w && h) { out.w = w; out.h = h; out.aspect = aspectOf(w, h); }
  // Only a clip can be sound only (the app saw no picture track in it)
  if (mediaType === 'video' && src.soundOnly === true) out.soundOnly = true;
  return out;
}

/** One post as /api/feed/first sends it (a feed_thumbnails document, trimmed). */
export function feedFirstPost(id, x) {
  const d = x && typeof x === 'object' ? x : {};
  const ms = d.timestamp?.toMillis?.() || (typeof d.timestamp?._seconds === 'number' ? d.timestamp._seconds * 1000 : 0);
  return {
    id, mediaType: d.mediaType || 'image', thumbnailUrl: d.thumbnailUrl || '', thumbSmallUrl: d.thumbSmallUrl || null,
    videoUrl: d.videoUrl || null, posterUrl: d.posterUrl || null,
    lqip: cleanLqip(d.lqip), tint: cleanTint(d.tint), w: cleanDim(d.w), h: cleanDim(d.h), soundOnly: d.soundOnly === true,
    title: d.title || null, caption: d.caption || null, userId: d.userId, userName: d.userName || null, userAvatar: d.userAvatar || null,
    likes: d.likes || [], likeCount: d.likeCount || 0, commentCount: d.commentCount || 0, isPublic: true, tags: d.tags || [], labels: d.labels || [],
    behavior: d.behavior || '', aiInsight: d.aiInsight || null, locationArea: d.locationArea || '', isHybrid: !!d.isHybrid, curatorNote: null,
    ts: ms,
  };
}

export const FIRST_TILES = 6;
export const FIRST_TILES_BUDGET = 6144;

/** Escapes JSON for an inline <script> (no "</script>", no line separators). */
export const inlineJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * The first tiles' minimal data for the page itself, so the feed paints before any request.
 * Tiles are added while they fit the budget; a tile that doesn't fit is slimmed (one picture link,
 * no preview) before giving up. Returns the escaped JSON, or null when there is nothing to show.
 */
export function firstTilesJson(posts, { max = FIRST_TILES, budget = FIRST_TILES_BUDGET } = {}) {
  const tiles = [];
  let size = 48; // {"v":1,"at":…,"posts":[]}
  for (const p of (Array.isArray(posts) ? posts : [])) {
    if (tiles.length >= max) break;
    if (!p || !p.id) continue;
    const likes = (p.likeCount || 0) + (Array.isArray(p.likes) ? p.likes.length : 0);
    const full = {
      id: p.id, mediaType: p.mediaType || 'image',
      ...(p.thumbSmallUrl ? { thumbSmallUrl: p.thumbSmallUrl } : {}),
      ...(p.thumbnailUrl ? { thumbnailUrl: p.thumbnailUrl } : {}),
      ...(p.posterUrl && !p.thumbnailUrl ? { posterUrl: p.posterUrl } : {}),
      ...(p.lqip ? { lqip: p.lqip } : {}), ...(p.tint ? { tint: p.tint } : {}),
      ...(p.w && p.h ? { w: p.w, h: p.h } : {}), ...(p.soundOnly ? { soundOnly: true } : {}),
      ...(p.videoUrl ? { videoUrl: p.videoUrl } : {}),
      labels: (p.labels || []).slice(0, 2).map(l => String(l).slice(0, 80)),
      ...(p.title && !(p.labels || []).length ? { title: String(p.title).slice(0, 80) } : {}),
      userId: p.userId || '', userName: p.userName ? String(p.userName).slice(0, 40) : null,
      locationArea: p.locationArea ? String(p.locationArea).slice(0, 60) : '',
      likeCount: likes, ts: p.ts || 0,
    };
    const slim = { ...full };
    if (slim.thumbSmallUrl) delete slim.thumbnailUrl;
    delete slim.videoUrl;
    delete slim.lqip;
    let chosen = null;
    for (const t of [full, slim]) {
      const n = inlineJson(t).length + 1;
      if (size + n <= budget) { chosen = t; size += n; break; }
    }
    if (!chosen) break;
    tiles.push(chosen);
  }
  return tiles.length ? inlineJson({ v: 1, at: Date.now(), posts: tiles }) : null;
}

/**
 * Puts the first tiles into the page (read synchronously by the app at boot). No image preloads:
 * measured on 4G with a 4x slower CPU, preloading the first pictures delayed the app's script by
 * ~110 ms and the first painted tile by ~100 ms, while the first picture arrived only ~40 ms sooner.
 */
export function injectFirstTiles(html, json) {
  if (!json) return html;
  const out = String(html);
  const tag = `<script type="application/json" id="ng-first">${json}</script>`;
  return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `  ${tag}\n  </body>`) : out + tag;
}

// ------------------------------------------------------------------ optional server-side preview
// The app makes the preview at upload (it has a canvas). When an older app sends none, the server
// makes one with sharp if it is installed; otherwise the poster backfill (functions) fills it later.
let sharpLoad = null;
const loadSharp = () => (sharpLoad ??= import('sharp').then(m => m.default || m).catch(() => null));

export async function serverPreview(imageBuffer) {
  const sharp = await loadSharp();
  if (!sharp || !imageBuffer) return null;
  try {
    const img = sharp(imageBuffer, { failOn: 'none' }).rotate();
    const meta = await img.metadata();
    const tiny = await img.clone().resize(16).webp({ quality: 30 }).toBuffer();
    const { dominant } = await img.clone().resize(32).stats();
    const hex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    const swap = (meta.orientation || 1) >= 5;
    const w = swap ? meta.height : meta.width, h = swap ? meta.width : meta.height;
    return previewFields({ lqip: `data:image/webp;base64,${tiny.toString('base64')}`, tint: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`, w, h }, 'image');
  } catch { return null; }
}
export const hasSharp = async () => !!(await loadSharp());
