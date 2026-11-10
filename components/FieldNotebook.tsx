import React, { useMemo, useState } from 'react';
import Glyph from './Glyph';
import { PressingLoader } from './SkeletonPost';
import { observedBehaviour } from './Wonder';
import { seasonOf, groupOf, GROUP_GLYPH } from '../services/lifeList';
import type { CommunityPost, ExpeditionDraft } from '../types';

/**
 * The explorer's journal as a field notebook: their own sightings gathered by day and by outing
 * (captures within about three hours of each other on the same day), each page dated the way a
 * naturalist would write it, with the place, the time span, the captures mounted like small photos,
 * the explorer's own words and the guide's line. Private entries are written "in pencil".
 */

// ---------------------------------------------------------------------------- shared helpers

/** Milliseconds from a Firestore timestamp, a Date, a number or an ISO string. Never throws. */
export const anyMs = (t: any): number => {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function') { const d = t.toDate(); return d instanceof Date ? d.getTime() : 0; }
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  const p = Date.parse(String(t));
  return Number.isNaN(p) ? 0 : p;
};

const postMs = (p: any) => anyMs(p?.createdAt) || anyMs(p?.timestamp);

const parts = (ms: number, opts: Intl.DateTimeFormatOptions) => {
  const out: Record<string, string> = {};
  try { new Intl.DateTimeFormat(undefined, opts).formatToParts(new Date(ms)).forEach(x => { out[x.type] = x.value; }); } catch { /* old engines */ }
  return out;
};

/** "Tuesday 14 March 2026", always in that order, with names in the explorer's language. */
export const notebookDate = (ms: number) => {
  const p = parts(ms, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return p.weekday ? `${p.weekday} ${p.day} ${p.month} ${p.year}` : new Date(ms).toDateString();
};

const monthTitle = (ms: number) => {
  const p = parts(ms, { month: 'long', year: 'numeric' });
  return p.month ? `${p.month} ${p.year}` : new Date(ms).toDateString();
};

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** "7:10–8:05" (or a single time for one capture). */
export const timeSpan = (a: number, b: number) => {
  if (!a) return '';
  if (!b || Math.abs(b - a) < 60_000) return clock(a);
  try {
    const f: any = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    if (typeof f.formatRange === 'function') return f.formatRange(new Date(a), new Date(b)).replace(/\s?[–-]\s?/, '–');
  } catch { /* fall through */ }
  return `${clock(a)}–${clock(b)}`;
};

const IGNORE_LABEL = /^(unknown|nature|unidentified|observation|captured|uploaded|sighting|manual|audio|video)/i;
const speciesOf = (labels?: string[]) => (labels || []).find(l => l && !IGNORE_LABEL.test(l.trim())) || '';

const firstSentence = (s?: string | null, max = 200) => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  const one = m ? m[1] : t;
  return one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one;
};

// ---------------------------------------------------------------------------- drafts ("unfinished pages")

export interface UnfinishedPage {
  id: string;
  title: string;
  more: number;
  count: number;
  ms: number;
  place?: string;
  thumbs: string[];
  /** Older than three days: the details are starting to fade */
  fading: boolean;
}

/** One draft read as an unfinished notebook page. Used by both the journal and the drafts tray. */
export const unfinishedPage = (draft: ExpeditionDraft, now = Date.now()): UnfinishedPage => {
  const snaps = draft.snapshots || [];
  const thumbs = snaps.map(s => s.url || s.thumbnailUrl || s.associatedImages?.[0]?.url)
    .filter((u): u is string => !!u && !u.startsWith('blob:')).slice(0, 3);
  const title = speciesOf(snaps.find(s => speciesOf(s.labels))?.labels) || 'An outing';
  const ms = anyMs(draft.timestamp) || anyMs(snaps[0]?.timestamp);
  const place = snaps.map(s => (s.showLocation === false ? '' : (s.locationArea || '').trim())).find(Boolean) || undefined;
  return {
    id: draft.id, title, more: Math.max(0, snaps.length - 1), count: snaps.length, ms, place, thumbs,
    fading: !!ms && now - ms > 3 * 86_400_000,
  };
};

// ---------------------------------------------------------------------------- grouping

interface Capture { thumb?: string; mediaType: string; label?: string }
interface Entry {
  post: CommunityPost;
  ms: number;
  species: string;
  words: string;
  guide: string;
  place?: string;
  isPrivate: boolean;
  captures: Capture[];
}
interface Outing { key: string; start: number; end: number; place?: string; entries: Entry[] }
interface Day { key: string; ms: number; season: string; outings: Outing[] }
interface Month { key: string; ms: number; title: string; season: string; days: Day[] }

const OUTING_GAP = 3 * 3600_000;
const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const monthKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}`; };
const latOf = (p: any) => p?.rawLocation?.lat ?? p?.items?.[0]?.rawLocation?.lat;

const toEntry = (p: CommunityPost): Entry => {
  const items = p.items && p.items.length ? p.items : null;
  const captures: Capture[] = items
    ? items.map(it => ({ thumb: it.thumbnailUrl || it.imageUrl || it.associatedImageUrls?.[0], mediaType: it.mediaType, label: speciesOf(it.labels) }))
    : [{ thumb: p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl, mediaType: p.mediaType, label: speciesOf(p.labels) }];
  const behaviour = observedBehaviour(p.behavior);
  return {
    post: p,
    ms: postMs(p),
    species: speciesOf(p.labels) || p.title || '',
    words: (p.caption || '').trim() || (items && items.length > 1 ? (p.description || '').trim() : '') || behaviour || '',
    guide: firstSentence(p.aiInsight || items?.[0]?.aiInsight),
    place: p.showLocation === false ? undefined : ((p.locationArea || items?.[0]?.locationArea || '').trim() || undefined),
    isPrivate: p.isPublic !== true,
    captures,
  };
};

const mostCommon = (xs: (string | undefined)[]) => {
  const m = new Map<string, number>();
  xs.forEach(x => { if (x) m.set(x, (m.get(x) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

const buildMonths = (posts: CommunityPost[]): Month[] => {
  const entries = posts.map(toEntry).filter(e => e.ms).sort((a, b) => b.ms - a.ms);
  const months: Month[] = [];
  const byMonth = new Map<string, Month>();
  const byDay = new Map<string, Day>();
  for (const e of entries) {
    const mk = monthKey(e.ms);
    let m = byMonth.get(mk);
    if (!m) {
      const mid = new Date(new Date(e.ms).getFullYear(), new Date(e.ms).getMonth(), 15).getTime();
      m = { key: mk, ms: e.ms, title: monthTitle(e.ms), season: seasonOf(mid, latOf(e.post)).replace(/^early /, ''), days: [] };
      byMonth.set(mk, m); months.push(m);
    }
    const dk = dayKey(e.ms);
    let d = byDay.get(dk);
    if (!d) { d = { key: dk, ms: e.ms, season: seasonOf(e.ms, latOf(e.post)), outings: [] }; byDay.set(dk, d); m.days.push(d); }
    // Entries arrive newest first; the day is read morning to evening, so build outings afterwards
    (d as any)._e = [...((d as any)._e || []), e];
  }
  for (const m of months) for (const d of m.days) {
    const es: Entry[] = ((d as any)._e as Entry[]).sort((a, b) => a.ms - b.ms);
    delete (d as any)._e;
    let cur: Outing | null = null;
    for (const e of es) {
      if (!cur || e.ms - cur.end > OUTING_GAP) {
        cur = { key: `${d.key}-${e.ms}`, start: e.ms, end: e.ms, entries: [] };
        d.outings.push(cur);
      }
      cur.entries.push(e); cur.end = e.ms;
    }
    d.outings.forEach(o => { o.place = mostCommon(o.entries.map(x => x.place)); });
  }
  return months;
};

const matches = (p: CommunityPost, q: string) => {
  const hay = [p.title, p.caption, p.description, p.behavior, p.aiInsight, p.locationArea, ...(p.labels || []), ...(p.tags || []),
    ...(p.items || []).flatMap(i => [...(i.labels || []), i.locationArea])].filter(Boolean).join(' ').toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w.replace(/^#/, '')));
};

// ---------------------------------------------------------------------------- pieces

const MountedPhoto: React.FC<{ c: Capture; tilt: number; pencil: boolean; onClick: () => void; label: string }> = ({ c, tilt, pencil, onClick, label }) => {
  const group = c.label ? GROUP_GLYPH[groupOf({ labels: [c.label] })] : 'leaf';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open ${label}`}
      style={{ transform: `rotate(${tilt}deg)` }}
      className="relative shrink-0 bg-[#fffdf8] p-1 pb-1.5 shadow-[0_1px_2px_rgba(60,40,20,0.15),0_4px_10px_-6px_rgba(60,40,20,0.3)] border border-[#e8dfcd] hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--theme-accent-rgb))]"
    >
      {/* photo corners */}
      <span aria-hidden="true" className="absolute -top-px -left-px w-2.5 h-2.5 border-t-[5px] border-l-[5px] border-[#d8ccb6]/80" />
      <span aria-hidden="true" className="absolute -bottom-px -right-px w-2.5 h-2.5 border-b-[5px] border-r-[5px] border-[#d8ccb6]/80" />
      <span className="block w-[84px] h-[84px] sm:w-[96px] sm:h-[96px] bg-[#efe7d6] overflow-hidden flex items-center justify-center text-[#b9a98a]">
        {c.thumb
          ? <img src={c.thumb} alt="" loading="lazy" decoding="async" className={`w-full h-full object-cover ${pencil ? 'grayscale-[.35] opacity-90' : 'sepia-[.06]'}`} />
          : <Glyph name={c.mediaType === 'audio' ? 'sound' : group} size={30} />}
      </span>
      {c.mediaType === 'video' && <span className="absolute bottom-2.5 right-2.5 w-5 h-5 rounded-full bg-black/40 text-white flex items-center justify-center"><span className="material-symbols-outlined text-[13px]" aria-hidden="true">play_arrow</span></span>}
      {c.mediaType === 'audio' && c.thumb && <span className="absolute bottom-2.5 right-2.5 w-5 h-5 rounded-full bg-black/40 text-white flex items-center justify-center"><Glyph name="sound" size={12} /></span>}
    </button>
  );
};

const EntryView: React.FC<{ e: Entry; onOpen: (p: CommunityPost) => void; index: number }> = ({ e, onOpen, index }) => {
  const label = e.species || 'this sighting';
  return (
    <li className={`flex gap-4 py-4 ${e.isPrivate ? 'pl-3 border-l border-dashed border-stone-300' : ''}`}>
      <div className="flex flex-wrap gap-2 items-start content-start self-start max-w-[45%] sm:max-w-[220px]">
        {e.captures.slice(0, 4).map((c, i) => (
          <MountedPhoto key={i} c={c} tilt={((index + i) % 3 - 1) * 1.2} pencil={e.isPrivate} onClick={() => onOpen(e.post)} label={c.label || label} />
        ))}
        {e.captures.length > 4 && <button type="button" onClick={() => onOpen(e.post)} className="self-center text-xs text-stone-500 underline">+{e.captures.length - 4} more</button>}
      </div>
      <div className="flex-1 min-w-0">
        <button type="button" onClick={() => onOpen(e.post)} className="text-left">
          <span className={`block font-display italic text-[19px] leading-snug ${e.isPrivate ? 'text-stone-600' : 'text-theme-primary'} hover:underline decoration-[rgb(var(--theme-accent-rgb))]/40 underline-offset-4`}>
            {e.species || (e.captures.length > 1 ? `${e.captures.length} captures` : 'Untitled sighting')}
          </span>
        </button>
        <p className="text-xs text-stone-500 mt-0.5">
          {[clock(e.ms), e.captures.length > 1 ? `${e.captures.length} captures` : ''].filter(Boolean).join(' · ')}
        </p>
        {e.words && (
          <p className={`mt-2 text-[15px] leading-relaxed whitespace-pre-line line-clamp-5 ${e.isPrivate ? 'text-stone-600 font-display italic' : 'text-stone-800'}`}>{e.words}</p>
        )}
        {e.guide && (
          <p className="mt-2 text-[13px] leading-snug text-stone-600 flex gap-1.5">
            <Glyph name="guide" size={14} className="text-[rgb(var(--theme-accent-rgb))] mt-0.5" />
            <span><span className="text-stone-500">The guide: </span>{e.guide}</span>
          </p>
        )}
        {e.isPrivate && (
          <p className="mt-2 text-xs text-stone-500 font-display italic flex items-center gap-1">
            <Glyph name="feather" size={13} />In pencil, only for you
          </p>
        )}
      </div>
    </li>
  );
};

// ---------------------------------------------------------------------------- the notebook

interface Props {
  posts: CommunityPost[];
  loading: boolean;
  drafts: ExpeditionDraft[];
  onOpenPost: (post: CommunityPost) => void;
  onOpenDrafts?: () => void;
  onShowGrid: () => void;
  onTitleClick?: () => void;
}

const FieldNotebook: React.FC<Props> = ({ posts, loading, drafts, onOpenPost, onOpenDrafts, onShowGrid, onTitleClick }) => {
  const [query, setQuery] = useState('');
  const [shownMonths, setShownMonths] = useState(3);
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => (q ? posts.filter(p => matches(p, q)) : posts), [posts, q]);
  const months = useMemo(() => buildMonths(filtered), [filtered]);
  const visible = q ? months : months.slice(0, shownMonths);
  const pages = useMemo(() => drafts.map(d => unfinishedPage(d)), [drafts]);

  // "On this day": the same date in earlier years, else the same week a year or more ago
  const onThisDay = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const older = posts.map(p => ({ p, ms: postMs(p) })).filter(x => x.ms && new Date(x.ms).getFullYear() < y);
    const same = older.filter(x => { const d = new Date(x.ms); return d.getMonth() === now.getMonth() && d.getDate() === now.getDate(); });
    if (same.length) return { title: `On this day in ${new Date(same[0].ms).getFullYear()}`, items: same.sort((a, b) => b.ms - a.ms) };
    const week = older.filter(x => {
      const d = new Date(x.ms); const then = new Date(y, d.getMonth(), d.getDate()).getTime();
      return Math.abs(then - new Date(y, now.getMonth(), now.getDate()).getTime()) <= 3 * 86_400_000;
    });
    if (week.length) return { title: `This week in ${new Date(week[0].ms).getFullYear()}`, items: week.sort((a, b) => b.ms - a.ms) };
    return null;
  }, [posts]);

  const firstMs = useMemo(() => posts.reduce((m, p) => { const t = postMs(p); return t && (!m || t < m) ? t : m; }, 0), [posts]);

  const jump = (key: string, idx: number) => {
    if (idx >= shownMonths) setShownMonths(idx + 1);
    window.setTimeout(() => document.getElementById(`nb-${key}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }), 30);
  };

  return (
    <div className="w-full min-h-full bg-day-bg">
      {/* Header */}
      <header className="px-4 md:px-12 pt-10 pb-5 border-b border-theme-primary/10">
        <div className="flex items-start justify-between gap-3">
          <button type="button" onClick={onTitleClick} className="text-left min-w-0 rounded-lg" aria-label="Scroll to top of journal">
            <h2 className="text-2xl md:text-3xl font-display font-semibold text-theme-primary flex items-center gap-2">
              <Glyph name="rings" size={26} className="text-theme-accent" />
              My journal
            </h2>
            {posts.length > 0 && (
              <p className="text-sm text-stone-500 mt-1">
                {posts.length} {posts.length === 1 ? 'entry' : 'entries'}{firstMs ? ` since ${monthTitle(firstMs)}` : ''}
              </p>
            )}
          </button>
          <div className="flex items-center gap-1 shrink-0" role="group" aria-label="Journal view">
            <span className="h-9 px-3 rounded-full bg-theme-primary text-white text-sm font-medium flex items-center gap-1.5" aria-current="true"><Glyph name="notebook" size={16} />Notebook</span>
            <button type="button" onClick={onShowGrid} className="h-9 px-3 rounded-full border border-theme-primary/15 text-theme-primary/80 hover:bg-theme-primary/5 text-sm font-medium flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[17px]" aria-hidden="true">grid_view</span>Grid
            </button>
          </div>
        </div>
        <label className="relative block mt-4 max-w-md">
          <span className="sr-only">Search your journal</span>
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-lg" aria-hidden="true">search</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find a species, place or word"
            className="w-full pl-10 pr-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-stone-800 placeholder-stone-400 focus:border-[rgb(var(--theme-accent-rgb))] outline-none"
          />
        </label>
      </header>

      <div className="px-4 md:px-12 py-6 pb-40 lg:flex lg:gap-10">
        {/* Season spine (wide screens) */}
        {months.length > 1 && (
          <nav aria-label="Months in your journal" className="hidden lg:block w-44 shrink-0">
            <ol className="sticky top-6 border-l border-[#d8ccb6] pl-4 space-y-2 max-h-[80vh] overflow-y-auto no-scrollbar">
              {months.map((m, i) => (
                <li key={m.key}>
                  <button type="button" onClick={() => jump(m.key, i)} className="text-left group">
                    <span className="block text-sm font-display text-theme-primary group-hover:underline">{m.title}</span>
                    <span className="block text-[11px] text-stone-500">{(() => { const n = m.days.reduce((t, d) => t + d.outings.reduce((k, o) => k + o.entries.length, 0), 0); return `${m.season} · ${n} ${n === 1 ? 'entry' : 'entries'}`; })()}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="flex-1 min-w-0 max-w-3xl">
          {loading ? (
            <PressingLoader label="Opening your notebook" className="py-24" />
          ) : (
            <>
              {/* Unfinished pages */}
              {!q && pages.length > 0 && (
                <section aria-labelledby="nb-unfinished" className="mb-8 rounded-[3px] border border-dashed border-[#cdbfa5] bg-[#fbf7ef] p-4">
                  <h3 id="nb-unfinished" className="font-display text-lg text-theme-primary flex items-center gap-2">
                    <Glyph name="satchel" size={18} className="text-[rgb(var(--theme-accent-rgb))]" />Unfinished pages
                  </h3>
                  <ul className="mt-2 divide-y divide-[#e8dfcd]" role="list">
                    {pages.slice(0, 3).map(pg => (
                      <li key={pg.id}>
                        <button type="button" onClick={onOpenDrafts} className="w-full flex items-center gap-3 py-2.5 text-left">
                          <span className="w-12 h-12 shrink-0 bg-[#efe7d6] border border-[#e8dfcd] overflow-hidden flex items-center justify-center text-[#b9a98a]">
                            {pg.thumbs[0] ? <img src={pg.thumbs[0]} alt="" className="w-full h-full object-cover" /> : <Glyph name="satchel" size={20} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-display italic text-stone-800 truncate">{pg.title}{pg.more ? ` and ${pg.more} more` : ''}</span>
                            <span className="block text-xs text-stone-500 truncate">{[pg.ms ? notebookDate(pg.ms) : '', pg.place].filter(Boolean).join(' · ')}</span>
                            {pg.fading && <span className="block text-xs text-[rgb(var(--theme-accent-rgb))] mt-0.5">Finish it before the details fade</span>}
                          </span>
                          <span className="material-symbols-outlined text-stone-400" aria-hidden="true">chevron_right</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {pages.length > 3 && <button type="button" onClick={onOpenDrafts} className="mt-1 text-sm text-theme-accent font-medium">All {pages.length} unfinished pages</button>}
                </section>
              )}

              {/* On this day */}
              {!q && onThisDay && (
                <section aria-labelledby="nb-otd" className="mb-8 rounded-[3px] bg-[#fbf7ef] p-4 shadow-[0_1px_2px_rgba(60,40,20,0.1)] border border-[#e8dfcd]">
                  <h3 id="nb-otd" className="font-display text-lg text-theme-primary flex items-center gap-2">
                    <Glyph name="sun" size={18} className="text-[rgb(var(--theme-accent-rgb))]" />{onThisDay.title}
                  </h3>
                  <p className="text-xs text-stone-500 mt-0.5">{notebookDate(onThisDay.items[0].ms)}{onThisDay.items.length > 1 ? ` and ${onThisDay.items.length - 1} more` : ''}</p>
                  <ul className="flex gap-3 overflow-x-auto no-scrollbar mt-3 pb-1" role="list">
                    {onThisDay.items.slice(0, 8).map(({ p }, i) => {
                      const e = toEntry(p);
                      return (
                        <li key={p.id} className="shrink-0 w-[100px]">
                          <MountedPhoto c={e.captures[0]} tilt={(i % 3 - 1) * 1.2} pencil={e.isPrivate} onClick={() => onOpenPost(p)} label={e.species || 'sighting'} />
                          <p className="mt-1.5 text-xs font-display italic text-stone-700 truncate">{e.species || 'Sighting'}</p>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {months.length === 0 ? (
                q ? (
                  <div className="py-20 text-center">
                    <p className="font-display text-xl text-stone-800">No pages mention "{query.trim()}"</p>
                    <button type="button" onClick={() => setQuery('')} className="mt-3 text-sm text-theme-accent font-medium">Clear the search</button>
                  </div>
                ) : (
                  <div className="py-24 flex flex-col items-center text-center">
                    <Glyph name="rings" size={48} strokeWidth={1.1} className="text-theme-primary/25 mb-5" />
                    <h3 className="text-xl font-display text-stone-800 mb-2 font-semibold">Your journal starts outside</h3>
                    <p className="text-base text-stone-600 max-w-xs">Each outing becomes a page here, dated, placed and in your own words.</p>
                  </div>
                )
              ) : (
                visible.map(m => (
                  <section key={m.key} id={`nb-${m.key}`} aria-labelledby={`nbh-${m.key}`} className="mb-6 scroll-mt-4">
                    <h3 id={`nbh-${m.key}`} className="sticky top-0 z-10 -mx-4 px-4 md:-mx-2 md:px-2 py-2 bg-day-bg/95 backdrop-blur-sm border-b border-[#e8dfcd] flex items-baseline gap-2">
                      <span className="font-display text-xl text-theme-primary">{m.title}</span>
                      <span className="text-sm text-stone-500">{m.season}</span>
                    </h3>
                    {m.days.map(d => (
                      <article key={d.key} className="mt-5" aria-label={notebookDate(d.ms)}>
                        <h4 className="font-display text-[17px] text-stone-800">
                          {notebookDate(d.ms)} <span className="text-stone-500">· {d.season}</span>
                        </h4>
                        {d.outings.map(o => (
                          <div key={o.key} className="mt-2 rounded-[3px] bg-white/70 border border-[#ece4d4] px-4 pt-3 pb-1 bg-[linear-gradient(transparent_27px,rgba(140,120,90,0.07)_28px)] bg-[length:100%_28px]">
                            <p className="text-sm text-stone-600 flex items-center gap-1.5 flex-wrap">
                              <Glyph name="tracks" size={15} className="text-[rgb(var(--theme-accent-rgb))]" />
                              <span className="tabular">{timeSpan(o.start, o.end)}</span>
                              {o.place && <><span aria-hidden="true">·</span><span>{o.place}</span></>}
                              {o.entries.length > 1 && <><span aria-hidden="true">·</span><span>{o.entries.length} entries</span></>}
                            </p>
                            <ul className="divide-y divide-[#efe7d6]" role="list">
                              {o.entries.map((e, i) => <EntryView key={e.post.id} e={e} index={i} onOpen={onOpenPost} />)}
                            </ul>
                          </div>
                        ))}
                      </article>
                    ))}
                  </section>
                ))
              )}

              {!q && months.length > shownMonths && (
                <div className="flex justify-center pt-4">
                  <button type="button" onClick={() => setShownMonths(n => n + 3)} className="px-5 py-2.5 rounded-full border border-theme-primary/15 text-sm font-medium text-theme-primary hover:bg-theme-primary/5">
                    Turn back to earlier pages
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default FieldNotebook;
