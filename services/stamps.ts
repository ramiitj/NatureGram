/**
 * The fortnight's calendar and the challenge stamps it leaves in an explorer's notebook.
 *
 * Every ~15.21 days a new naturalist takes over (see constants/naturalistExtras.ts getThemePeriod).
 * The rotation restarts each 1 January, so a period is identified by its naturalist AND its start date.
 * The order changed on ROTATION_CUTOVER (constants/palettes.json); periods before it are read in the
 * legacy order, so a stamp earned in the past keeps the naturalist who set that challenge.
 * Everything here is computed from data already stored (post tags + timestamps): no schema change.
 */
import { NaturalistTheme, PERIOD_DAYS, rotationAt } from '../constants/naturalists';
import { getNaturalistExtra } from '../constants/naturalistExtras';
import { toMs } from './lifeList';

export interface FortnightPeriod {
  index: number;
  theme: NaturalistTheme;
  /** Local midnight on the first day of the period */
  start: Date;
  /** Local midnight on the first day of the NEXT period (exclusive end) */
  end: Date;
}

/** The naturalist period covering a moment in time (same arithmetic as getThemePeriod / getDailyTheme). */
export const periodAt = (when: Date | number = new Date()): FortnightPeriod => {
  const now = typeof when === 'number' ? new Date(when) : when;
  const y = now.getFullYear();
  const { slot, index, theme } = rotationAt(now);
  const startDay = Math.ceil(slot * PERIOD_DAYS);
  const endDay = Math.ceil((slot + 1) * PERIOD_DAYS);
  const nextYear = new Date(y + 1, 0, 1);
  const end = new Date(y, 0, endDay);
  return {
    index,
    theme,
    start: new Date(y, 0, Math.max(1, startDay)),
    end: end > nextYear ? nextYear : end,
  };
};

/** The period just before the one covering `when`. */
export const previousPeriod = (when: Date | number = new Date()): FortnightPeriod =>
  periodAt(periodAt(when).start.getTime() - 3_600_000);

/** "1–15 November" in the explorer's locale (or across months: "28 October – 12 November"). */
export const periodLabel = (p: FortnightPeriod) => {
  const last = new Date(p.end.getTime() - 86_400_000);
  try {
    const fmt: any = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' });
    if (typeof fmt.formatRange === 'function') return fmt.formatRange(p.start, last);
  } catch { /* older engines */ }
  const sameMonth = last.getMonth() === p.start.getMonth();
  const a = p.start.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' });
  const b = last.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  return `${a} – ${b}`;
};

export interface ChallengeStamp {
  naturalistId: string;
  naturalist: string;
  /** Epoch ms of the first day of the fortnight that was answered */
  periodStart: number;
  /** The challenge tag that earned it, e.g. "#PotterWoodland" */
  tag: string;
  /** The first post that answered it */
  postId?: string;
}

const norm = (t: string) => String(t || '').trim().toLowerCase().replace(/^#?/, '#');

/**
 * Which fortnights an explorer answered, from their own posts.
 *
 * A post earns a stamp when it carries the challenge tag of the naturalist whose fortnight covered
 * the post's timestamp (tags compared case-insensitively, with or without '#'). One stamp per
 * fortnight, newest first. Posts are read defensively: missing tags or timestamps are skipped.
 *
 *   import { challengeStamps } from '../services/stamps';
 *   const stamps = challengeStamps(posts); // [{ naturalistId, naturalist, periodStart, tag, postId }]
 *
 * Pass any post shape that has `tags` (string[]) and `timestamp` (Firestore Timestamp, {seconds}, or ms).
 */
export const challengeStamps = (posts: any[]): ChallengeStamp[] => {
  const out = new Map<string, ChallengeStamp>();
  const sorted = [...(posts || [])].sort((a, b) => toMs(a?.timestamp) - toMs(b?.timestamp));
  for (const p of sorted) {
    const tags: string[] = Array.isArray(p?.tags) ? p.tags : [];
    const ms = toMs(p?.timestamp);
    if (!tags.length || !ms) continue;
    const period = periodAt(ms);
    const tag = getNaturalistExtra(period.theme.id).challengeTag;
    if (!tags.some(t => norm(t) === norm(tag))) continue;
    const key = `${period.theme.id}|${period.start.getTime()}`;
    if (!out.has(key)) out.set(key, { naturalistId: period.theme.id, naturalist: period.theme.naturalist, periodStart: period.start.getTime(), tag, postId: p?.id });
  }
  return [...out.values()].sort((a, b) => b.periodStart - a.periodStart);
};

/** Tag variants for an array-contains-any query (same rule as getChallengeProgress). */
export const tagVariants = (tag: string) => {
  const t = tag.startsWith('#') ? tag : `#${tag}`;
  return Array.from(new Set([t, t.toLowerCase(), t.toUpperCase()])).slice(0, 10);
};
