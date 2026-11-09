import type { CommunityPost, NaturalistPersona } from '../types';
import { likeTotal } from '../utils';

/**
 * "For you" ranking: transparent, explainable scoring (no black box).
 *   freshness   – exponential decay, half-life ~1.5 days
 *   engagement  – log-scaled likes + 2× comments
 *   affinity    – authors you follow, your naturalist persona's taxa/habitats
 *   ritual      – the current naturalist-of-the-fortnight challenge tag
 *   quality     – captions and community-verifiable IDs; low-certainty posts nudged down
 * Then a diversity pass keeps one author from dominating any 4 consecutive slots.
 */
export interface RankContext {
  now?: number;
  followingIds?: Set<string>;
  persona?: NaturalistPersona | null;
  challengeTag?: string;
  myUid?: string;
}

const toMs = (t: any) => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : (t ? new Date(t).getTime() : 0));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function scorePost(p: CommunityPost, ctx: RankContext): number {
  const now = ctx.now ?? Date.now();
  const ageH = Math.max(0, (now - toMs(p.timestamp)) / 3_600_000);
  const freshness = 10 * Math.exp(-ageH / 52);
  const engagement = 2.2 * Math.log2(1 + likeTotal(p) + 2 * (p.commentCount || 0));
  let affinity = 0;
  if (ctx.followingIds?.has(p.userId)) affinity += 4;
  const persona = ctx.persona;
  if (persona) {
    const hay = [...(p.labels || []), ...(p.tags || []), p.caption || '', p.behavior || ''].map(x => norm(String(x))).join(' ');
    const interests = [...(persona.taxaInterests || []), ...(persona.habitatAffinities || [])].map(norm).filter(i => i.length > 2);
    if (interests.some(i => hay.includes(i))) affinity += 3;
    if ((persona.observationStyles || []).some(st => norm(st).includes(p.mediaType))) affinity += 1;
  }
  const ritual = ctx.challengeTag && (p.tags || []).some(t => norm(t) === norm(ctx.challengeTag!)) ? 3 : 0;
  let quality = 0;
  if (p.caption) quality += 0.5;
  if (p.needsExpertReview) quality -= 0.5;
  if (ctx.myUid && p.userId === ctx.myUid) quality -= 2; // you've seen your own posts
  return freshness + engagement + affinity + ritual + quality;
}

export function rankForYou(posts: CommunityPost[], ctx: RankContext): CommunityPost[] {
  const scored = posts.map(p => ({ p, s: scorePost(p, ctx) })).sort((a, b) => b.s - a.s);
  // Diversity: avoid the same author twice within any window of 4
  const out: CommunityPost[] = [];
  const pending = [...scored];
  while (pending.length) {
    const recent = new Set(out.slice(-3).map(p => p.userId));
    const idx = pending.findIndex(x => !recent.has(x.p.userId));
    const pick = pending.splice(idx === -1 ? 0 : idx, 1)[0];
    out.push(pick.p);
  }
  return out;
}
