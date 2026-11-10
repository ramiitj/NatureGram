/**
 * Full-text search keys for a sighting. Same function as server/searchTokens.js (keep identical):
 * lowercased word prefixes of species names, tags, area, title and caption, at most MAX_TOKENS.
 */
export const MAX_TOKENS = 100;
export const MIN_PREFIX = 2;
export const MAX_PREFIX = 15;

export function wordsOf(text: unknown): string[] {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length >= MIN_PREFIX);
}

export function searchTokensFor(post: any = {}): string[] {
  const sensitive = post?.aiFlags?.sensitiveSpecies === true;
  const area = !sensitive && post?.showLocation !== false ? post?.locationArea : '';
  const groups = [
    ...(Array.isArray(post.labels) ? post.labels : []),
    ...(Array.isArray(post.tags) ? post.tags : []),
    area,
    post.title,
    post.caption,
  ];
  const out = new Set<string>();
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

/** The words of a search box, as tokens (each truncated to the stored prefix length). */
export const queryTokens = (q: string): string[] =>
  Array.from(new Set(wordsOf(q.replace(/^#/, '')).map(w => w.slice(0, MAX_PREFIX))));

export const sameTokens = (a: unknown, b: unknown) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(x => s.has(x));
};
