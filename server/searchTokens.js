/**
 * Full-text search keys for a sighting: lowercased word prefixes of its species names, tags,
 * area and caption, stored as `searchTokens` (at most MAX_TOKENS). The app searches with
 * array-contains on one token and filters the rest itself.
 *
 * services/searchTokens.ts is the same function for the app (post edits and queries).
 * Keep the two identical.
 */
export const MAX_TOKENS = 100;
export const MIN_PREFIX = 2;
export const MAX_PREFIX = 15;

/** Words of a text: lowercase, accents removed, letters and digits only, 2+ characters. */
export function wordsOf(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length >= MIN_PREFIX);
}

/**
 * post: { labels, tags, locationArea, showLocation, caption, title, aiFlags }
 * Species names come first so they always fit; the caption fills whatever room is left.
 */
export function searchTokensFor(post = {}) {
  const sensitive = post?.aiFlags?.sensitiveSpecies === true;
  const area = !sensitive && post?.showLocation !== false ? post?.locationArea : '';
  const groups = [
    ...(Array.isArray(post.labels) ? post.labels : []),
    ...(Array.isArray(post.tags) ? post.tags : []),
    area,
    post.title,
    post.caption,
  ];
  const out = new Set();
  for (const g of groups) {
    for (const w of wordsOf(g)) {
      const word = w.slice(0, MAX_PREFIX);
      for (let n = MIN_PREFIX; n <= word.length; n++) {
        out.add(word.slice(0, n));
        if (out.size >= MAX_TOKENS) return [...out];
      }
    }
  }
  return [...out];
}

export const sameTokens = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(x => s.has(x));
};
