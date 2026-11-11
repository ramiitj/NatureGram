import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CommunityPost, UserProfileData } from '../types';
import { FirebaseService } from '../services/firebaseService';
import { auth } from '../firebaseConfig';
import AuthModal from './AuthModal';
import NaturalistPersonaModal from './NaturalistPersonaModal';
import { PUBLIC_ORIGIN } from '../utils';
import { track } from '../services/analytics';
import { enablePush, disablePush, pushEnabled, pushSupported } from '../services/push';
import { getCorsProxyUrl } from '../services/firebaseService';
import { namesOf, reconciledStats, lifeStats, buildLifeList, LifeEntry, LifeGroup, GROUP_GLYPH, MILESTONES, ordinal, toMs, seasonOf, groupOf } from '../services/lifeList';
import { renderPlate, sharePlate } from '../services/plateImage';
import { SpecimenPlate, PlateStamp, PlateData } from './SpecimenPlate';
import Glyph from './Glyph';
import { useBackToClose } from '../services/overlayStack';
import { getConsent, setConsent, getAdsConsent, setAdsConsent, isTeenMode } from '../services/analytics';
import { db } from '../firebaseConfig';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import BrandMark from './BrandMark';
import { isInstalled, openInstallCard } from '../services/install';
import { getThemePeriod } from '../constants/naturalistExtras';
import { resolvePoster } from './PlayableVideo';
import FirstHint from './FirstHint';
import { themeAccent } from './ShareSheet';
import { challengeStamps } from '../services/stamps';
import GuardianCare from './GuardianCare';
import { PressingLoader } from './SkeletonPost';

/** "Exploring since March 2026", tolerant of Firestore Timestamps, {seconds} objects, ISO strings and millis. */
const exploringSince = (t: any): string => {
  const ms = t?.toMillis?.() ?? (typeof t?.seconds === 'number' ? t.seconds * 1000 : typeof t === 'string' || typeof t === 'number' ? new Date(t).getTime() : NaN);
  return Number.isFinite(ms) ? `Exploring since ${new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` : 'Explorer';
};

interface UserProfileProps {
  userId: string;
  currentUserId?: string;
  isAnonymous?: boolean;
  onBack: () => void;
  onSignOut: () => void;
  onViewJournal: () => void;
  onAdminConsole?: () => void;
  onOpenPost?: (postId: string) => void;
  onViewProfile?: (uid: string) => void;
  onRequireAccount?: (reason: string, then?: () => void) => void;
  onMessage?: (uid: string) => void | Promise<void>;
  /** Clears the first-run tour flag and walks the explorer round the app again, from the feed */
  onRetakeTour?: () => void;
  /** The landing page: what NatureGram is, in full */
  onAbout?: () => void;
  /** Opens the log-in window (for guests who already have an account) */
  onLogIn?: () => void;
}

type Tab = 'posts' | 'lifelist' | 'saved';

const Avatar: React.FC<{ url?: string | null; name?: string; size?: number }> = ({ url, name, size = 88 }) => (
  url
    ? <img src={url} alt={`${name || 'Explorer'}'s photo`} className="rounded-full object-cover bg-stone-100" style={{ width: size, height: size }} />
    : <div className="rounded-full bg-[#f3efe7] text-stone-700 flex items-center justify-center font-display" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">{(name || '?').charAt(0).toUpperCase()}</div>
);

const Sheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  // The phone's back gesture, Escape, × and tapping outside all close it
  const { close } = useBackToClose(true, onClose);
  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center animate-fade-in" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 ng-scrim" onClick={close} aria-hidden="true" />
      <div className="relative w-full sm:max-w-md ng-sheet max-h-[85dvh] flex flex-col animate-slide-up pb-[env(safe-area-inset-bottom)]">
        <header className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="ng-subtitle">{title}</h2>
          <button onClick={close} aria-label="Close" className="ng-icon-button -mr-2">
            <Glyph name="close" size={24} />
          </button>
        </header>
        <div className="overflow-y-auto px-6 pb-6 pt-1">{children}</div>
      </div>
    </div>
  );
};

const BINOMIAL = /^[A-Z][a-z]+ [a-z]+( [a-z]+)?$/;

/** The everyday name for a life-list entry: the guide's common name when the label is the Latin one. */
const commonNameOf = (e: LifeEntry, posts: CommunityPost[]): string => {
  const latin = BINOMIAL.test(e.name) || (!!e.scientific && e.scientific.toLowerCase() === e.name.toLowerCase());
  if (!latin) return e.name;
  const p: any = posts.find(x => x.id === e.postId);
  const common = (p?.aiIdentifications?.[0]?.commonName || p?.items?.[0]?.aiIdentifications?.[0]?.commonName || '').trim();
  return common || e.name;
};

/** "23 species since March 2026. Your first was the house sparrow." in one quiet line. */
const lifeListSummary = (entries: LifeEntry[], own: boolean, firstName?: string): string => {
  const first = entries[0];
  if (!first) return '';
  const since = first.firstMs ? ` since ${new Date(first.firstMs).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` : '';
  const n = entries.length;
  const nm = firstName || first.name;
  // "the house sparrow", but a Latin name stands on its own ("Pardirallus nigricans")
  const latin = /^[A-Z][a-z]+ [a-z]+/.test(nm) && !/\s[A-Z]/.test(nm);
  return `${n} species${since}. ${own ? 'Your' : 'Their'} first was ${latin ? nm : `the ${nm}`}.`;
};

const monthKey = (ms: number) => ms ? new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Undated';
const seasonWord = (ms: number) => ms ? seasonOf(ms).replace(/^early /, '') : '';

/** The most frequent value in a list, or '' when the list is empty. */
const mode = (vals: string[]): string => {
  const m = new Map<string, number>();
  let best = '', n = 0;
  for (const v of vals) { if (!v) continue; const c = (m.get(v) || 0) + 1; m.set(v, c); if (c > n) { n = c; best = v; } }
  return best;
};

/** Place names broken into comparable parts ("Jaipur, Rajasthan" -> jaipur, rajasthan). */
const areaParts = (a?: string | null) => String(a || '').toLowerCase().split(/[,·/|-]/).map(s => s.trim()).filter(s => s.length >= 3);

const plateOf = (e: LifeEntry): PlateData => ({ name: e.name, scientific: e.scientific, thumb: e.thumb, no: e.no, firstMs: e.firstMs, place: e.place, season: e.season, group: e.group, count: e.count });
const forCanvas = (d: PlateData): PlateData => ({ ...d, thumb: d.thumb ? getCorsProxyUrl(d.thumb) : undefined });

const MilestoneRibbon: React.FC<{ entry: LifeEntry; own: boolean }> = ({ entry, own }) => {
  const naturalist = getThemePeriod(new Date(entry.firstMs || Date.now())).theme.naturalist;
  return (
    <li className="col-span-full my-1" aria-label={`Milestone: ${ordinal(entry.no)} species`}>
      <div className="relative flex items-center gap-4 py-3 border-y border-stone-200/80 text-stone-700">
        <span className="ng-rule shrink-0" aria-hidden="true" />
        <p className="text-sm leading-[1.55]">
          <span className="font-display text-base text-stone-900">{own ? 'Your' : 'Their'} {ordinal(entry.no)} species</span>, the <em className="font-display">{entry.name}</em>, found during {naturalist}'s fortnight.
        </p>
      </div>
    </li>
  );
};

/** A plate in the grid: tapping it opens the sighting; the small corner button shares the plate image. */
const PlateCell: React.FC<{ entry: LifeEntry; onOpen?: (id: string) => void; onShare: (e: LifeEntry) => void; milestone?: boolean }> = ({ entry, onOpen, onShare, milestone }) => (
  <li className="relative mb-2">
    <SpecimenPlate data={plateOf(entry)} onClick={() => onOpen?.(entry.postId)} stamp={milestone ? <PlateStamp>{ordinal(entry.no)} species</PlateStamp> : undefined} />
    <button onClick={() => onShare(entry)} aria-label={`Share the plate of ${entry.name}`} className="absolute -bottom-3 right-1 w-11 h-11 rounded-full flex items-center justify-center bg-day-bg border border-stone-200 text-stone-500 hover:text-stone-900">
      <Glyph name="share" size={20} />
    </button>
  </li>
);

interface Ghost { id: string; name: string; group: LifeGroup; by?: string; area?: string }

const LifeListView: React.FC<{
  entries: LifeEntry[];
  own: boolean;
  ghosts: Ghost[] | null;
  onOpenPost?: (id: string) => void;
  onShare: (e: LifeEntry) => void;
  firstName?: string;
  homeRange?: string;
  season?: string;
}> = ({ entries, own, ghosts, onOpenPost, onShare, firstName, homeRange, season }) => {
  const [view, setView] = useState<'kind' | 'chronicle'>(() => {
    try { return localStorage.getItem('ng_lifelist_view') === 'chronicle' ? 'chronicle' : 'kind'; } catch { return 'kind'; }
  });
  const choose = (v: 'kind' | 'chronicle') => { setView(v); try { localStorage.setItem('ng_lifelist_view', v); } catch { /* storage blocked */ } };

  const groups = useMemo(() => {
    const m = new Map<LifeGroup, LifeEntry[]>();
    entries.forEach(e => m.set(e.group, [...(m.get(e.group) || []), e]));
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [entries]);

  const grid = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6';

  return (
    <div className="ng-page pb-10">
      <div className="flex flex-wrap items-center justify-between gap-4 pt-6 pb-6">
        <div className="min-w-0">
          <p className="font-display italic text-base text-stone-700">{lifeListSummary(entries, own, firstName)}</p>
          {(homeRange || season) && (
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {homeRange && <div className="flex gap-1.5 min-w-0"><dt className="text-stone-500 shrink-0">Home range</dt><dd className="text-stone-800 font-display truncate">{homeRange}</dd></div>}
              {season && <div className="flex gap-1.5"><dt className="text-stone-500 shrink-0">Favourite season</dt><dd className="text-stone-800 font-display">{season}</dd></div>}
            </dl>
          )}
        </div>
        <div role="radiogroup" aria-label="Arrange the life list" className="flex gap-5 text-sm">
          {([['kind', 'By kind of life'], ['chronicle', 'By date']] as const).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={view === k} onClick={() => choose(k)} className={`ng-tab text-sm ${view === k ? 'ng-tab-on' : ''}`}>{label}</button>
          ))}
        </div>
      </div>

      {view === 'kind' ? (
        <div className="space-y-12">
          {groups.map(([g, list]) => (
            <section key={g} aria-labelledby={`grp-${g}`}>
              <h3 id={`grp-${g}`} className="flex items-center gap-3 mb-5 text-stone-900">
                <span className="ng-rule" aria-hidden="true" />
                <span className="ng-subtitle">{g}</span>
                <Glyph name={GROUP_GLYPH[g]} size={20} className="text-stone-400" />
                <span className="text-sm text-stone-500 tabular">{list.length}</span>
              </h3>
              <ul className={grid} role="list">
                {list.map(e => <PlateCell key={e.postId + e.no} entry={e} onOpen={onOpenPost} onShare={onShare} milestone={MILESTONES.includes(e.no)} />)}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className={grid} role="list">
          {entries.map((e, i) => {
            const prev = entries[i - 1];
            const newMonth = !prev || monthKey(prev.firstMs) !== monthKey(e.firstMs);
            return (
              <React.Fragment key={e.postId + e.no}>
                {newMonth && (
                  <li className="col-span-full flex items-baseline gap-3 pt-6 first:pt-0 border-b border-stone-200/80 pb-2">
                    <span className="ng-subtitle">{monthKey(e.firstMs)}</span>
                    {e.season && <span className="text-sm text-stone-500">{e.season}</span>}
                  </li>
                )}
                <PlateCell entry={e} onOpen={onOpenPost} onShare={onShare} />
                {MILESTONES.includes(e.no) && <MilestoneRibbon entry={e} own={own} />}
              </React.Fragment>
            );
          })}
        </ul>
      )}

      {own && ghosts && ghosts.length > 0 && (
        <section aria-labelledby="still-to-find" className="mt-16">
          <h3 id="still-to-find" className="ng-subtitle flex items-center gap-3"><span className="ng-rule" aria-hidden="true" />Still to find nearby</h3>
          <p className="ng-small mt-1 mb-5 pl-11">Other explorers have recorded these close to where you walk. The plate is waiting.</p>
          <ul className={grid} role="list">
            {ghosts.map(g => (
              <li key={g.id}>
                <SpecimenPlate ghost data={{ name: g.name, group: g.group }} onClick={() => onOpenPost?.(g.id)} />
                <p className="mt-2 px-1 ng-caption truncate">{[g.by ? `Seen by ${g.by}` : '', g.area ? `near ${g.area}` : ''].filter(Boolean).join(' ')}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

/** The picture for a drawer tile: the still, else the sound's picture, else (for video) the server's poster frame. */
const stillOf = (p: CommunityPost): string | undefined => {
  const it: any = p.items?.[0];
  return p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl || p.associatedImageUrls?.[0]
    || it?.thumbnailUrl || it?.imageUrl || it?.associatedImageUrls?.[0] || undefined;
};

const DrawerThumb: React.FC<{ post: CommunityPost }> = ({ post: p }) => {
  const still = stillOf(p);
  const [poster, setPoster] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (still || p.mediaType !== 'video' || !ref.current) return;
    let live = true;
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      io.disconnect();
      const direct = (p as any).videoUrl || (p.items?.[0] as any)?.videoUrl;
      (direct ? Promise.resolve(direct) : FirebaseService.getFullPost(p.id).then(f => f?.videoUrl || (f?.items?.[0] as any)?.videoUrl))
        .then(u => resolvePoster(u)).then(u => { if (live && u) setPoster(u); }).catch(() => {});
    }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => { live = false; io.disconnect(); };
  }, [p, still]);
  const src = still || poster;
  return (
    <span ref={ref} className="block aspect-[4/5] bg-[#f3efe7] overflow-hidden relative">
      {src
        ? <img src={src} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        : <span className="w-full h-full flex items-center justify-center text-stone-400/70">{p.mediaType === 'audio' ? <Glyph name="sound" size={24} strokeWidth={1.2} /> : <Glyph name={GROUP_GLYPH[groupOf(p)]} size={24} strokeWidth={1.2} />}</span>}
      {p.mediaType === 'audio' && src && <span className="absolute bottom-2 right-2 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]" aria-hidden="true"><Glyph name="sound" size={14} /></span>}
    </span>
  );
};

/** Sightings as specimen drawers: one drawer per month, each tile labelled along a date strip. */
/** The sightings an explorer has shared, newest first, as one grid. (The Journal keeps the months.) */
const SightingDrawers: React.FC<{ posts: CommunityPost[]; own: boolean; onOpenPost?: (id: string) => void }> = ({ posts, own, onOpenPost }) => {
  const drawers = useMemo(() => [{ key: 'all', season: '', list: posts }], [posts]);
  return (
    <div className="ng-page pb-10 pt-6">
      {drawers.map(d => (
        <section key={d.key} aria-label={`${d.list.length} sightings`}>
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6 md:gap-x-6" role="list">
            {d.list.map(p => {
              const ms = toMs(p.timestamp);
              const name = namesOf(p).common || p.title || 'Unnamed sighting';
              const multi = (p.items?.length || 0) > 1;
              return (
                <li key={p.id} className="relative">
                  <button onClick={() => onOpenPost?.(p.id)} className="group block w-full text-left" aria-label={`Open ${name}`}>
                    <span className="block relative rounded-md overflow-hidden">
                      <DrawerThumb post={p} />
                      {(p.mediaType === 'video' || multi) && (
                        <span className="absolute top-2 right-2 flex items-center gap-1 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]" aria-hidden="true">
                          {p.mediaType === 'video' && <Glyph name="play" size={14} filled />}
                          {multi && <><Glyph name="stack" size={14} /><span className="text-[11px] font-medium tabular">{p.items!.length}</span></>}
                        </span>
                      )}
                      {own && !p.isPublic && <span className="absolute top-2 left-2 text-white text-[11px] font-medium flex items-center gap-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"><Glyph name="lock" size={14} />Only me</span>}
                    </span>
                    <span className="flex items-baseline justify-between gap-2 pt-2">
                      <span className="font-display italic text-base text-stone-900 truncate">{name}</span>
                      {ms > 0 && <span className="shrink-0 text-xs text-stone-500 tabular">{new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
};

type KeptItem = { id: string; thumbnailUrl?: string; label?: string; mediaType?: string; createdAt?: any };

/** Kept sightings as pressed pages: a paper leaf, the photo under a sheet of glassine, the name written beneath. */
const KeptPages: React.FC<{ items: KeptItem[]; onOpenPost?: (id: string) => void }> = ({ items, onOpenPost }) => {
  const folios = useMemo(() => {
    const out: { key: string; list: KeptItem[] }[] = [];
    for (const s of items) {
      const key = toMs(s.createdAt) ? `Kept in ${monthKey(toMs(s.createdAt))}` : 'Kept earlier';
      const last = out[out.length - 1];
      if (last && last.key === key) last.list.push(s); else out.push({ key, list: [s] });
    }
    return out;
  }, [items]);
  return (
    <div className="ng-page pb-10 pt-6 space-y-12">
      {folios.map(f => (
        <section key={f.key} aria-label={f.key}>
          <h3 className="ng-subtitle mb-4 pb-2 border-b border-stone-200/80">{f.key}</h3>
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6 md:gap-x-6" role="list">
            {f.list.map(s => {
              const name = (s.label || '').trim() || 'A kept sighting';
              const group = groupOf({ labels: [name] });
              return (
                <li key={s.id}>
                  <button onClick={() => onOpenPost?.(s.id)} aria-label={`Open kept ${name}`} className="block w-full text-left transition-opacity hover:opacity-90">
                    <span className="relative block aspect-square overflow-hidden rounded-md bg-[#f3efe7]">
                      {s.thumbnailUrl
                        ? <img src={s.thumbnailUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                        : <span className="w-full h-full flex items-center justify-center text-stone-400/70"><Glyph name={s.mediaType === 'audio' ? 'sound' : GROUP_GLYPH[group]} size={24} strokeWidth={1.2} /></span>}
                    </span>
                    <span className="block mt-2 font-display italic text-base text-stone-900 leading-snug line-clamp-2">{name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
};

/** A contact sheet of up to twelve plates in one PNG, so the life list leaves with you as a picture. */
async function contactSheet(entries: LifeEntry[]): Promise<Blob | null> {
  const pick = entries.slice(0, 12);
  if (!pick.length) return null;
  const cols = Math.min(4, pick.length), rows = Math.ceil(pick.length / cols);
  const cw = 360, ch = 450, gap = 24;
  const c = document.createElement('canvas');
  c.width = cols * cw + (cols + 1) * gap; c.height = rows * ch + (rows + 1) * gap;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  ctx.fillStyle = '#fcfaf8'; ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < pick.length; i++) {
    const blob = await renderPlate(forCanvas(plateOf(pick[i]))).catch(() => null);
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
      ctx.drawImage(img, gap + (i % cols) * (cw + gap), gap + Math.floor(i / cols) * (ch + gap), cw, ch);
    } catch { /* skip this plate */ } finally { URL.revokeObjectURL(url); }
  }
  return await new Promise(res => c.toBlob(b => res(b), 'image/png'));
}

const saveBlob = (blob: Blob, name: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
};

const lifeListFiles = (entries: LifeEntry[]) => {
  const day = new Date().toISOString().slice(0, 10);
  const rows = entries.map(e => ({ no: e.no, name: e.name, scientific: e.scientific || '', firstSeen: e.firstMs ? new Date(e.firstMs).toISOString().slice(0, 10) : '', place: e.place || '', season: e.season || '', group: e.group, sightings: e.count, postId: e.postId }));
  const esc = (v: any) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [Object.keys(rows[0] || { no: '', name: '' }).join(','), ...rows.map(r => Object.values(r).map(esc).join(','))].join('\n');
  saveBlob(new Blob([csv], { type: 'text/csv' }), `naturegram-life-list-${day}.csv`);
  setTimeout(() => saveBlob(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }), `naturegram-life-list-${day}.json`), 400);
};

/** One plain line for a failed follow or letter, so a click never seems to do nothing. */
function socialError(e: any, fallback: string): string {
  const code = String(e?.code || '');
  if (/permission-denied/.test(code)) return 'That was refused. Reload the app and try again; if it keeps happening, the app needs its latest security rules deployed.';
  if (/unavailable|deadline-exceeded/.test(code)) return "Can't reach the server right now. Check your connection and try again.";
  if (e instanceof Error && !code && e.message && e.message.length < 120) return e.message;
  return fallback;
}

/** After sign-up: a gentle "check your inbox" note, with a resend that waits a minute between tries. */
const CheckInbox: React.FC<{ email: string; onToast: (m: string) => void }> = ({ email, onToast }) => {
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!wait) return; const t = setTimeout(() => setWait(w => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const resend = async () => {
    setBusy(true);
    try { await FirebaseService.sendVerificationEmail(); onToast('A new letter is on its way'); setWait(60); }
    catch (e: any) { onToast(String(e?.code || '').includes('too-many') ? "We've sent a few already. Give it a little while." : "That didn't go through. Try again in a moment."); setWait(30); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-6 py-4 border-y border-stone-200/80 flex items-start gap-4">
      <Glyph name="sealed" size={24} className="text-stone-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="ng-subtitle">Check your inbox</p>
        <p className="ng-small mt-1">We sent a letter to <span className="font-semibold text-stone-800 break-all">{email || 'your email'}</span>. Tap the link inside and your field page is yours to keep.</p>
        <button onClick={resend} disabled={busy || wait > 0} className="mt-2 ng-link-quiet min-h-[44px] disabled:text-stone-400 disabled:no-underline">
          {busy ? 'Sending…' : wait > 0 ? `Send another in ${wait}s` : 'Send it again'}
        </button>
      </div>
    </div>
  );
};

const UserProfile: React.FC<UserProfileProps> = ({ userId, currentUserId, isAnonymous, onBack, onSignOut, onViewJournal, onAdminConsole, onOpenPost, onViewProfile, onRequireAccount, onMessage, onRetakeTour, onAbout, onLogIn }) => {
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('posts');
  const [confirmUnfollow, setConfirmUnfollow] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [saved, setSaved] = useState<{ id: string; thumbnailUrl?: string; label?: string }[] | null>(null);
  const [sheet, setSheet] = useState<null | 'settings' | 'edit' | 'followers' | 'following' | 'delete' | 'menu' | 'words' | 'report'>(null);
  const [people, setPeople] = useState<UserProfileData[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [toast, setToast] = useState('');
  const [personaOpen, setPersonaOpen] = useState(false);

  const isOwnProfile = userId === currentUserId;

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    if (isAnonymous && isOwnProfile) { setIsLoading(false); return; }
    setIsLoading(true);
    const unsubProfile = FirebaseService.subscribeToUserProfile(userId, setProfile);
    const unsubPosts = FirebaseService.subscribeToUserJournal(userId, (p) => {
      setPosts(p);
      setIsLoading(false);
    }, { publicOnly: !isOwnProfile });
    if (!isOwnProfile) {
      FirebaseService.isFollowing(userId).then(setFollowing);
      FirebaseService.getBlockedIds().then(ids => setBlocked(ids.includes(userId)));
    } else {
      FirebaseService.getAdminStatus().then(s => { setIsAdmin(s.isAdmin); });
      setNeedsVerification(!!auth.currentUser && !auth.currentUser.isAnonymous && !auth.currentUser.emailVerified);
    }
    return () => { unsubProfile(); unsubPosts(); };
  }, [userId, isOwnProfile, isAnonymous]);

  useEffect(() => {
    if (tab === 'saved' && saved === null) FirebaseService.getSavedPosts().then(setSaved);
  }, [tab, saved]);

  useEffect(() => {
    if (sheet === 'followers' || sheet === 'following') {
      setPeople(null);
      FirebaseService.getConnections(userId, sheet).then(setPeople);
    }
  }, [sheet, userId]);

  const username = profile?.username || (isOwnProfile ? auth.currentUser?.displayName : '') || 'Explorer';
  // You is the public face: shared sightings only. Everything, private included, is in the Journal.
  const visiblePosts = useMemo(() => posts.filter(p => p.isPublic), [posts]);
  const privateCount = useMemo(() => isOwnProfile ? posts.filter(p => !p.isPublic).length : 0, [posts, isOwnProfile]);
  // The same public count shown beside this explorer's name everywhere else (server stats use the same rule)
  // One rule everywhere: the counts are the explorer's shared sightings, worked out by the server
  // (the same figure shown beside their name on a post); until it has, count what's loaded
  const headerStats = useMemo(() => reconciledStats(profile) || lifeStats(posts), [posts, profile]);

  // Life list: every distinct species, numbered in the order it was first found
  const lifeList = useMemo(() => buildLifeList(visiblePosts), [visiblePosts]);

  // Fortnights this explorer answered the naturalist's challenge
  const stamps = useMemo(() => challengeStamps(visiblePosts), [visiblePosts]);

  // Home range and favourite season, shown in the life list's header
  const masthead = useMemo(() => {
    const times = visiblePosts.map(p => toMs(p.timestamp)).filter(ms => ms > 0);
    const areas = visiblePosts
      .filter(p => isOwnProfile || p.showLocation !== false)
      .map(p => String(p.locationArea || p.items?.[0]?.locationArea || '').trim());
    return { homeRange: mode(areas), season: mode(times.map(seasonWord)) };
  }, [visiblePosts, isOwnProfile]);
  const firstName = useMemo(() => (lifeList[0] ? commonNameOf(lifeList[0], visiblePosts) : ''), [lifeList, visiblePosts]);

  // "Still to find nearby": species other explorers posted publicly near this explorer's places
  const [ghosts, setGhosts] = useState<Ghost[] | null>(null);
  const ghostsAsked = useRef(false);
  useEffect(() => { ghostsAsked.current = false; setGhosts(null); }, [userId]);
  useEffect(() => {
    if (tab !== 'lifelist' || !isOwnProfile || ghostsAsked.current || isLoading) return;
    const mine = new Set(visiblePosts.flatMap(p => areaParts(p.locationArea || p.items?.[0]?.locationArea)));
    if (!mine.size) { setGhosts([]); return; }
    ghostsAsked.current = true;
    (async () => {
      try {
        const first = await FirebaseService.getMorePosts(null, null, 60);
        let pool = first.posts;
        if (pool.length < 60 && first.lastVisible) {
          const more = await FirebaseService.getMorePosts(first.lastVisible, null, 60 - pool.length).catch(() => ({ posts: [] as CommunityPost[] }));
          pool = [...pool, ...more.posts];
        }
        const seen = new Set(lifeList.map(e => e.name.toLowerCase()));
        const out: Ghost[] = [];
        for (const p of pool) {
          if (out.length >= 6) break;
          if (p.userId === userId || !p.isPublic) continue;
          const name = (p.labels?.[0] || '').trim();
          if (!name || /^(unknown|nature|unidentified|observation|captured|uploaded|sighting)/i.test(name)) continue;
          if (seen.has(name.toLowerCase())) continue;
          if (!areaParts(p.locationArea).some(a => mine.has(a))) continue;
          seen.add(name.toLowerCase());
          out.push({ id: p.id, name, group: groupOf(p), by: p.userName || undefined, area: p.locationArea || undefined });
        }
        setGhosts(out);
      } catch { setGhosts([]); }
    })();
  }, [tab, isOwnProfile, isLoading, visiblePosts, lifeList, userId]);

  const sharePlateOf = async (e: LifeEntry) => {
    const line = `${e.name}, No. ${e.no} on ${isOwnProfile ? 'my' : `${username}'s`} life list`;
    track('share', { kind: 'life_plate' });
    const r = await sharePlate({ ...forCanvas(plateOf(e)), line, accent: themeAccent() }, { text: `${e.name}, seen${e.place ? ` near ${e.place}` : ''} on NatureGram`, url: `${PUBLIC_ORIGIN}/s/${encodeURIComponent(e.postId)}` });
    if (r === 'downloaded') showToast('Plate saved');
    else if (r === 'failed') showToast("The plate couldn't be made. Please try again.");
  };

  const toggleFollow = async () => {
    if (!currentUserId || isAnonymous) {
      onRequireAccount?.(`Create a free account to follow ${username}.`, toggleFollow);
      return;
    }
    setFollowBusy(true);
    const was = following;
    setFollowing(!was); // optimistic
    try {
      if (was) await FirebaseService.unfollowUser(userId);
      else await FirebaseService.followUser(userId);
      track(was ? 'unfollow' : 'follow');
    } catch (e: any) {
      setFollowing(was);
      console.error('follow failed', e);
      showToast(socialError(e, 'Could not update follow. Please try again.'));
    } finally {
      setFollowBusy(false);
    }
  };

  const [muted, setMuted] = useState(false);
  useEffect(() => { if (!isOwnProfile && currentUserId && !isAnonymous) FirebaseService.isMuted(userId).then(setMuted).catch(() => {}); }, [userId, isOwnProfile, currentUserId, isAnonymous]);
  const toggleMute = async () => {
    setSheet(null);
    if (!currentUserId || isAnonymous) { onRequireAccount?.('Create a free account to mute explorers.'); return; }
    try {
      if (muted) { await FirebaseService.unmuteUser(userId); setMuted(false); showToast(`${username} unmuted`); }
      else { await FirebaseService.muteUser(userId); setMuted(true); showToast(`${username} muted. Their sightings won't appear in your feed; they won't be told.`); }
    } catch (e) { showToast(socialError(e, 'Could not change that. Please try again.')); }
  };

  const toggleBlock = async () => {
    setSheet(null);
    if (!blocked && !window.confirm(`Block ${username}? You won't see their sightings or field notes, and they'll be removed from your followers.`)) return;
    try {
      if (blocked) { await FirebaseService.unblockUser(userId); setBlocked(false); showToast(`${username} unblocked`); }
      else { await FirebaseService.blockUser(userId); setBlocked(true); setFollowing(false); showToast(`${username} blocked`); }
    } catch { showToast('Something went wrong. Please try again.'); }
  };

  const shareProfile = async () => {
    const url = profile?.username ? `${PUBLIC_ORIGIN}/explorer/${encodeURIComponent(profile.username)}` : `${PUBLIC_ORIGIN}/profile?user=${encodeURIComponent(userId)}`;
    try {
      if (navigator.share) await navigator.share({ title: `${username} on NatureGram`, url });
      else { await navigator.clipboard.writeText(url); showToast('Link to the field page copied'); }
    } catch { /* cancelled */ }
  };

  const downloadData = async () => {
    showToast('Preparing your data…');
    try {
      const blob = await FirebaseService.exportMyData();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `naturegram-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      showToast('Your data has been downloaded');
    } catch { showToast('Export failed. Please try again.'); }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" role="status">
        <PressingLoader label="Opening the field page…" />
      </div>
    );
  }

  if (isAnonymous && isOwnProfile) {
    return (
      <div className="flex-1 overflow-y-auto no-scrollbar bg-day-bg pb-28 safe-pt">
        <section className="px-6 pt-10 pb-4 max-w-lg mx-auto ng-rise">
          <div className="flex items-center gap-5">
            <span className="shrink-0 w-[72px] h-[72px] rounded-full border border-dashed border-stone-300 flex items-center justify-center text-stone-400" aria-hidden="true">
              <Glyph name="rings" size={32} strokeWidth={1.1} />
            </span>
            <div>
              <h1 className="ng-title">Your field page</h1>
              <p className="ng-small text-stone-500 mt-1">Exploring as a guest</p>
            </div>
          </div>
          <dl className="mt-8 grid grid-cols-2 border-y border-stone-200 divide-x divide-stone-200">
            <div className="py-3 text-center"><dd className="text-2xl font-display text-stone-400 tabular">0</dd><dt className="text-xs text-stone-500">species</dt></div>
            <div className="py-3 text-center"><dd className="text-2xl font-display text-stone-400 tabular">0</dd><dt className="text-xs text-stone-500">sightings</dt></div>
          </dl>
          <p className="ng-body mt-8">Your life list and journal will live here.</p>
          <button onClick={() => onRequireAccount?.('Create a free account to keep your journal and life list.')} className="ng-button-primary group mt-6 w-full">Create my field page<Glyph name="forward" size={20} className="ng-arrow transition-transform group-hover:translate-x-0.5" /></button>
          <button onClick={() => onLogIn?.()} className="ng-button-quiet mt-3 w-full">I already have an account: Log in</button>
          <div className="mt-8 pt-5 border-t border-stone-200/80 flex flex-col -mx-3">
            {onAbout && <button onClick={onAbout} className="ng-menu-item min-h-[52px]"><BrandMark size={20} />About NatureGram</button>}
            <button onClick={() => setSheet('words')} className="ng-menu-item min-h-[52px]"><Glyph name="help" size={20} className="text-stone-500" />What the words mean</button>
            <a href="/privacy.html" target="_blank" rel="noopener" className="ng-menu-item min-h-[52px]"><Glyph name="shield" size={20} className="text-stone-500" />Privacy policy</a>
            <button onClick={() => onSignOut()} className="ng-menu-item min-h-[52px]"><Glyph name="signOut" size={20} className="text-stone-500" />Leave guest mode</button>
          </div>
          {sheet === 'words' && <WordsSheet onClose={() => setSheet(null)} />}
        </section>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-day-bg overflow-hidden animate-fade-in">
      <header className="px-4 md:px-10 py-2 flex items-center justify-between bg-day-bg/95 backdrop-blur shrink-0 safe-pt">
        {!isOwnProfile ? (
          <button onClick={onBack} aria-label="Back" className="ng-icon-button -ml-2">
            <Glyph name="back" size={24} />
          </button>
        ) : <span className="w-11" />}
        <h1 className="font-display italic text-lg text-stone-900 truncate">{username}</h1>
        {isOwnProfile ? (
          <button onClick={() => setSheet('settings')} data-tour="settings" className="-mr-2 inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-full text-sm font-medium text-stone-800 hover:bg-stone-900/[0.04]">
            <Glyph name="settings" size={20} />Settings
          </button>
        ) : (
          <button onClick={() => setSheet('menu')} aria-label="More options" className="ng-icon-button -mr-2">
            <Glyph name="more" size={24} />
          </button>
        )}
      </header>

      <main className="flex-1 overflow-y-auto no-scrollbar pb-24">
        {isOwnProfile && <FirstHint id="field-page-2" text="This is your public field page: what you've shared, your species and what you've kept. Settings (top right) has privacy, notifications and Log out." />}
        <section className="ng-page pt-6 pb-6 max-w-4xl">
          <div className="flex items-center gap-5">
            <button onClick={() => isOwnProfile && setSheet('edit')} disabled={!isOwnProfile} aria-label={isOwnProfile ? 'Change your photo' : undefined} className="shrink-0 rounded-full">
              <Avatar url={profile?.avatarUrl} name={username} />
            </button>
            <div className="min-w-0">
              {/* The username is the page title above; the display name only when it differs */}
              {profile?.displayName && profile.displayName !== username && <p className="ng-title truncate">{profile.displayName}</p>}
              <p className="ng-small text-stone-500 mt-1">{exploringSince(profile?.joinedAt)}</p>
            </div>
          </div>
          {profile?.bio ? <p className="ng-quote text-[18px] text-stone-700 mt-5 whitespace-pre-line ng-measure">{profile.bio}</p> : isOwnProfile && (
            <button onClick={() => setSheet('edit')} className="ng-link-quiet min-h-[44px] mt-3">Add a bio</button>
          )}
          <section aria-label="Field page" className="mt-6 py-5 border-y border-stone-200/80">
            <div className="flex items-baseline gap-8">
              <button onClick={() => setTab('lifelist')} className="text-left group">
                <span className="block text-[28px] leading-none font-display text-stone-900 tabular group-hover:underline decoration-theme-accent/50 decoration-1 underline-offset-[6px]">{headerStats.species}</span>
                <span className="block ng-caption mt-1.5">species</span>
              </button>
              <button onClick={() => setTab('posts')} className="text-left group">
                <span className="block text-[28px] leading-none font-display text-stone-900 tabular group-hover:underline decoration-theme-accent/50 decoration-1 underline-offset-[6px]">{headerStats.sightings}</span>
                <span className="block ng-caption mt-1.5">{headerStats.sightings === 1 ? 'shared sighting' : 'shared sightings'}</span>
              </button>
              <p className="ml-auto self-center text-sm text-stone-500 text-right">
                <button onClick={() => setSheet('followers')} className="hover:text-stone-900 hover:underline underline-offset-4">{(profile?.followersCount || 0).toLocaleString()} {profile?.followersCount === 1 ? 'follower' : 'followers'}</button>
                <span aria-hidden="true"> · </span>
                <button onClick={() => setSheet('following')} className="hover:text-stone-900 hover:underline underline-offset-4">{(profile?.followingCount || 0).toLocaleString()} following</button>
              </p>
            </div>
          </section>
          {stamps.length > 0 && (
            <section aria-label="Challenge stamps" className="mt-6">
              <p className="ng-caption mb-3">{stamps.length === 1 ? 'One fortnight answered' : `${stamps.length} fortnights answered`}</p>
              <ul className="flex gap-3 overflow-x-auto no-scrollbar py-1 px-1">
                {stamps.map(st => (
                  <li key={`${st.naturalistId}-${st.periodStart}`}>
                    <button onClick={() => st.postId && onOpenPost?.(st.postId)} title={`Answered ${st.naturalist}'s challenge`} className="block">
                      <PlateStamp tone="accent">{st.naturalist.split(' ').slice(-1)[0]}<br />{new Date(st.periodStart).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}</PlateStamp>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="flex items-center gap-3 mt-6">
            {isOwnProfile ? (
              <>
                <button onClick={() => setSheet('edit')} className="ng-button-quiet flex-1 sm:flex-none">Edit field page</button>
                <button onClick={shareProfile} aria-label="Share field page" className="ng-icon-button w-12 h-12 border border-stone-200"><Glyph name="share" size={20} /></button>
              </>
            ) : blocked ? (
              <button onClick={toggleBlock} className="ng-button-quiet flex-1 sm:flex-none">Unblock</button>
            ) : (
              <>
                <button onClick={() => {
                  // Unfollowing asks once: the first tap turns "Following" into "Unfollow?"
                  if (following && !confirmUnfollow) { setConfirmUnfollow(true); window.setTimeout(() => setConfirmUnfollow(false), 3500); return; }
                  setConfirmUnfollow(false); toggleFollow();
                }} disabled={followBusy} aria-pressed={following} className={`flex-1 sm:flex-none ${following ? 'ng-button-quiet' : 'ng-button-primary'}`}>
                  {following ? (confirmUnfollow ? 'Unfollow?' : 'Following') : 'Follow'}
                </button>
                <button onClick={async () => {
                  // A letter that can't be opened says why, instead of doing nothing.
                  try { await onMessage?.(userId); } catch (e: any) { console.error('letter failed', e); showToast(socialError(e, 'Could not open a letter. Please try again.')); }
                }} className="ng-button-quiet flex-1 sm:flex-none"><Glyph name="letter" size={20} className="text-stone-500" />Write a letter</button>
                <button onClick={shareProfile} aria-label="Share field page" className="ng-icon-button w-12 h-12 border border-stone-200"><Glyph name="share" size={20} /></button>
              </>
            )}
          </div>
          {isOwnProfile && needsVerification && <CheckInbox email={auth.currentUser?.email || ''} onToast={showToast} />}
        </section>

        {blocked && !isOwnProfile ? (
          <p className="text-center ng-small py-16 px-8">You've blocked this explorer. Unblock to see their sightings.</p>
        ) : (
          <>
            <div role="tablist" aria-label="Field page sections" className="flex gap-8 ng-page bg-day-bg/95 backdrop-blur border-b border-stone-200/80 sticky top-0 z-10">
              {([
                { key: 'posts', icon: 'landscape', label: 'Sightings' },
                { key: 'lifelist', icon: 'plate', label: 'Life list' },
                ...(isOwnProfile ? [{ key: 'saved', icon: 'filter_vintage', label: 'Kept' }] : []),
              ] as { key: Tab; icon: string; label: string }[]).map(t => (
                <button key={t.key} id={`tab-${t.key}`} role="tab" aria-selected={tab === t.key} aria-controls="field-page-panel" tabIndex={tab === t.key ? 0 : -1}
                  onKeyDown={e => {
                    // Arrow keys move between the tabs, as tabs do everywhere
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                    const keys: Tab[] = isOwnProfile ? ['posts', 'lifelist', 'saved'] : ['posts', 'lifelist'];
                    const next = keys[(keys.indexOf(t.key) + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length];
                    setTab(next); document.getElementById(`tab-${next}`)?.focus();
                  }}
                  onClick={() => setTab(t.key)} className={`ng-tab gap-2 min-h-[52px] ${tab === t.key ? 'ng-tab-on after:!bottom-0' : ''}`}>
                  {t.icon === 'plate'
                    ? <Glyph name="plate" size={20} />
                    : <Glyph name={t.icon === 'filter_vintage' ? 'keep' : 'landscape'} size={20} />}{t.label}
                </button>
              ))}
            </div>

            <div id="field-page-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === 'posts' && (
              visiblePosts.length === 0 ? (
                <div className="ng-empty">
                  <Glyph name="camera" size={40} strokeWidth={1.2} className="ng-empty-glyph" />
                  <p className="ng-empty-title">{isOwnProfile ? 'Your first sighting is out there' : 'No public sightings yet'}</p>
                  {isOwnProfile && <p className="ng-empty-body">Open the Lens and point it at something alive.</p>}
                </div>
              ) : (
                <>
                  {isOwnProfile && onViewJournal && (
                    <p className="ng-page pt-5 ng-small text-stone-600">
                      These are the sightings you've shared.{privateCount ? ` ${privateCount} more are only for you.` : ''}{' '}
                      <button onClick={onViewJournal} className="ng-link">All of them are in your Journal</button>
                    </p>
                  )}
                  <SightingDrawers posts={visiblePosts} own={isOwnProfile} onOpenPost={onOpenPost} />
                </>
              )
            )}

            {tab === 'lifelist' && (
              lifeList.length === 0 ? (
                <div className="ng-empty max-w-sm mx-auto">
                  <Glyph name="seedling" size={40} strokeWidth={1.2} className="ng-empty-glyph" />
                  <p className="ng-empty-title">{isOwnProfile ? 'Your herbarium is waiting' : 'No plates yet'}</p>
                  <p className="ng-empty-body">Every species {isOwnProfile ? 'you identify' : 'this explorer identifies'} becomes a numbered plate here, with the day, place and season it was first seen.</p>
                </div>
              ) : (
                <LifeListView entries={lifeList} own={isOwnProfile} ghosts={ghosts} onOpenPost={onOpenPost} onShare={sharePlateOf} firstName={firstName} homeRange={masthead.homeRange} season={masthead.season} />
              )
            )}

            {tab === 'saved' && isOwnProfile && (
              saved === null ? (
                <PressingLoader label="Opening what you kept…" className="py-14" />
              ) :
              saved.length === 0 ? (
                <div className="ng-empty max-w-sm mx-auto">
                  <Glyph name="keep" size={40} strokeWidth={1.2} className="ng-empty-glyph" />
                  <p className="ng-empty-body mt-0">Tap Keep on any sighting to find it here. Only you can see this.</p>
                </div>
              ) : (
                <KeptPages items={saved} onOpenPost={onOpenPost} />
              )
            )}
            </div>
          </>
        )}
      </main>

      {sheet === 'edit' && <EditProfileSheet profile={profile} onClose={() => setSheet(null)} onSaved={(m) => { setSheet(null); showToast(m); }} />}

      {(sheet === 'followers' || sheet === 'following') && (
        <Sheet title={sheet === 'followers' ? 'Followers' : 'Following'} onClose={() => setSheet(null)}>
          {people === null ? <p className="text-stone-500 text-center py-6 font-display italic" role="status">Gathering the names…</p> :
            people.length === 0 ? (
              <div className="ng-empty py-8 px-2">
                <Glyph name={sheet === 'followers' ? 'binoculars' : 'notebook'} size={32} strokeWidth={1.2} className="ng-empty-glyph" />
                <p className="ng-empty-title">
                  {sheet === 'followers'
                    ? (isOwnProfile ? 'No one follows you yet' : `No one follows ${username} yet`)
                    : (isOwnProfile ? "You're not following anyone yet" : `${username} isn't following anyone yet`)}
                </p>
                <p className="ng-empty-body">
                  {sheet === 'followers'
                    ? (isOwnProfile ? 'Share a sighting or two; explorers who notice the same things tend to find you.' : 'You could be the first to follow along.')
                    : (isOwnProfile ? 'Follow an explorer from any sighting and their new sightings will reach you.' : 'Their own sightings are worth a look in the meantime.')}
                </p>
              </div>
            ) : (
              <ul role="list">
                {people.map(p => (
                  <li key={p.uid}>
                    <button onClick={() => { setSheet(null); onViewProfile?.(p.uid); }} className="w-full flex items-center gap-4 py-3 border-b border-stone-200/70 text-left">
                      <Avatar url={p.avatarUrl} name={p.username} size={44} />
                      <span className="flex-1 min-w-0"><span className="block font-medium text-stone-900 truncate">{p.username}</span>{p.bio && <span className="block text-xs text-stone-500 truncate">{p.bio}</span>}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </Sheet>
      )}

      {sheet === 'menu' && !isOwnProfile && (
        <Sheet title={username} onClose={() => setSheet(null)}>
          <div className="flex flex-col -mx-3">
            <button onClick={shareProfile} className="ng-menu-item min-h-[52px]"><Glyph name="share" size={20} className="text-stone-500" />Share field page</button>
            {currentUserId && !isAnonymous && (<>
              <button onClick={toggleMute} className="ng-menu-item min-h-[52px]"><Glyph name={muted ? 'soundOn' : 'soundOff'} size={20} className="text-stone-500" />{muted ? 'Unmute' : 'Mute'} {username}</button>
              <button onClick={toggleBlock} className="ng-menu-item ng-menu-item-danger min-h-[52px]"><Glyph name="block" size={20} className="text-stone-500" />{blocked ? 'Unblock' : 'Block'} {username}</button>
              <button onClick={() => setSheet('report')} className="ng-menu-item min-h-[52px]"><Glyph name="flag" size={20} className="text-stone-500" />Report {username}</button>
            </>)}
          </div>
        </Sheet>
      )}

      {sheet === 'settings' && isOwnProfile && (
        <Sheet title="Settings" onClose={() => setSheet(null)}>
          <nav className="flex flex-col -mx-3" aria-label="Settings">
            <p className="ng-label px-3 pt-1 pb-1">Account</p>
            <p className="px-3 pb-2 ng-small text-stone-500 truncate">{auth.currentUser?.email ? `Logged in as ${auth.currentUser.email}` : `Logged in as ${username}`}</p>
            <button onClick={() => setSheet('edit')} className="ng-menu-item min-h-[52px]"><Glyph name="edit" size={20} className="text-stone-500" />Edit field page</button>
            <button onClick={() => { setSheet(null); onSignOut(); }} className="ng-menu-item min-h-[52px]"><Glyph name="signOut" size={20} className="text-stone-500" />Log out</button>

            <p className="ng-label px-3 pt-5 pb-1">Your guide and your feed</p>
            <button onClick={() => { setSheet(null); setPersonaOpen(true); }} className="ng-menu-item min-h-[52px]"><Glyph name="guide" size={20} className="text-stone-500" /><span className="flex-1">What makes you stop and look<span className="block ng-caption">{profile?.naturalistPersona?.archetype || 'Personalise your feed and guide'}</span></span></button>
            <p className="px-3 py-2 ng-small text-stone-600">Your guide is an AI. It can be wrong, so check what matters before you rely on a name.</p>

            <p className="ng-label px-3 pt-5 pb-1">Notifications</p>
            {pushSupported() && <PushToggle onToast={showToast} />}
            {currentUserId && <NotifyPrefs uid={currentUserId} />}

            <p className="ng-label px-3 pt-5 pb-1">Privacy</p>
            <PrivacyChoices />

            <p className="ng-label px-3 pt-5 pb-1">Your data</p>
            <button onClick={downloadData} className="ng-menu-item min-h-[52px]"><Glyph name="download" size={20} className="text-stone-500" />Download my data</button>
            {!!profile?.guardianOf?.length && currentUserId && <GuardianCare uids={profile.guardianOf} me={currentUserId} onToast={showToast} />}
            <button onClick={() => setSheet('delete')} className="ng-menu-item ng-menu-item-danger min-h-[52px]"><Glyph name="trash" size={20} className="text-stone-500" />Delete account</button>

            <p className="ng-label px-3 pt-5 pb-1">Help</p>
            {onRetakeTour && (
              <button onClick={() => { setSheet(null); onRetakeTour(); }} className="ng-menu-item min-h-[52px]"><Glyph name="leafCompass" size={20} className="text-stone-500" />Take the tour again</button>
            )}
            <button onClick={() => setSheet('words')} className="ng-menu-item min-h-[52px]"><Glyph name="help" size={20} className="text-stone-500" />What the words mean</button>
            {!isInstalled() && <button onClick={() => { setSheet(null); openInstallCard(); }} className="ng-menu-item min-h-[52px]"><Glyph name="plus" size={20} className="text-stone-500" />Add NatureGram to your home screen</button>}
            {onAbout && (
              <button onClick={() => { setSheet(null); onAbout(); }} className="ng-menu-item min-h-[52px]"><BrandMark size={20} />About NatureGram</button>
            )}
            <a href="/privacy.html" target="_blank" rel="noopener" className="ng-menu-item min-h-[52px]"><Glyph name="shield" size={20} className="text-stone-500" />Privacy policy</a>
            <a href="/terms.html" target="_blank" rel="noopener" className="ng-menu-item min-h-[52px]"><Glyph name="lines" size={20} className="text-stone-500" />Terms & community guidelines</a>
            {isAdmin && onAdminConsole && (<>
              <p className="ng-label px-3 pt-5 pb-1">Admin</p>
              <button onClick={() => { setSheet(null); onAdminConsole(); }} className="ng-menu-item min-h-[52px]"><Glyph name="seal" size={20} className="text-stone-500" />Admin console</button>
            </>)}
          </nav>
        </Sheet>
      )}

      {sheet === 'words' && <WordsSheet onClose={() => setSheet(null)} />}

      {sheet === 'report' && !isOwnProfile && (
        <Sheet title={`Report ${username}`} onClose={() => setSheet(null)}>
          <ReportProfile userId={userId} onDone={(m) => { setSheet(null); showToast(m); }} />
        </Sheet>
      )}

      {isOwnProfile && (
        <NaturalistPersonaModal
          userId={userId}
          initialPersona={profile?.naturalistPersona}
          isOpen={personaOpen}
          onClose={() => setPersonaOpen(false)}
          onSave={(updated: any) => { setProfile(prev => prev ? { ...prev, naturalistPersona: updated } : prev); setPersonaOpen(false); showToast('Noted. Your feed and guide will follow your eye.'); }}
        />
      )}

      {sheet === 'delete' && <DeleteAccountSheet username={username} lifeList={lifeList} onDownloadData={downloadData} onClose={() => setSheet(null)} onDeleted={onSignOut} />}

      {toast && <div role="status" className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[130] ng-toast animate-fade-in">{toast}</div>}
    </div>
  );
};

/** A labelled on/off switch in the settings list. */
const SwitchRow: React.FC<{ label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({ label, hint, on, onChange, disabled }) => (
  <button role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className="ng-menu-item min-h-[52px] disabled:opacity-60">
    <span className="flex-1 text-left">{label}{hint && <span className="block ng-caption">{hint}</span>}</span>
    <span className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${on ? 'bg-stone-900' : 'bg-stone-300'}`} aria-hidden="true"><span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} /></span>
  </button>
);

type NotifyPrefsT = { marvels?: boolean; notes?: boolean; follows?: boolean; identifications?: boolean; letters?: boolean; quietHours?: boolean };
const NOTIFY_DEFAULTS: Required<NotifyPrefsT> = { marvels: false, notes: true, follows: true, identifications: true, letters: true, quietHours: true };

/** What may reach your phone. Stored as users/{uid}.notifyPrefs; the server reads it before any push. */
const NotifyPrefs: React.FC<{ uid: string }> = ({ uid }) => {
  const [prefs, setPrefs] = useState<NotifyPrefsT>({});
  useEffect(() => onSnapshot(doc(db, 'users', uid), snap => setPrefs((snap.data() as any)?.notifyPrefs || {}), () => {}), [uid]);
  const teen = isTeenMode();
  const val = (k: keyof NotifyPrefsT) => k === 'quietHours' && teen ? true : (prefs[k] ?? NOTIFY_DEFAULTS[k]);
  const set = (k: keyof NotifyPrefsT, v: boolean) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    setDoc(doc(db, 'users', uid), { notifyPrefs: next }, { merge: true }).catch(() => setPrefs(prefs));
  };
  return (
    <div className="flex flex-col">
      <SwitchRow label="Marvels" hint="Off by default. Activity always shows them." on={val('marvels')} onChange={v => set('marvels', v)} />
      <SwitchRow label="Field notes and replies" on={val('notes')} onChange={v => set('notes', v)} />
      <SwitchRow label="Names suggested for your sightings" on={val('identifications')} onChange={v => set('identifications', v)} />
      <SwitchRow label="New followers" on={val('follows')} onChange={v => set('follows', v)} />
      <SwitchRow label="Letters" on={val('letters')} onChange={v => set('letters', v)} />
      <SwitchRow label="Quiet at night" hint={teen ? 'Always on in teen mode: nothing between 9 pm and 7 am.' : 'Nothing between 9 pm and 7 am.'} on={val('quietHours')} disabled={teen} onChange={v => set('quietHours', v)} />
    </div>
  );
};

/** The two consent choices from the first visit, changeable at any time. */
const PrivacyChoices: React.FC = () => {
  const teen = isTeenMode();
  const [stats, setStats] = useState(getConsent() === 'granted');
  const [ads, setAds] = useState(getAdsConsent() === 'granted');
  if (teen) return <p className="px-3 py-2 ng-small text-stone-600">In teen mode NatureGram keeps no usage statistics and loads no ads measurement.</p>;
  return (
    <div className="flex flex-col">
      <SwitchRow label="Usage statistics" hint="Screens used, crashes and speed. Never your photos, location or letters." on={stats} onChange={v => { setStats(v); setConsent(v ? 'granted' : 'denied'); }} />
      <SwitchRow label="Google ad measurement" hint="Lets Google count whether our ads brought you here." on={ads} onChange={v => { setAds(v); setAdsConsent(v ? 'granted' : 'denied'); }} />
    </div>
  );
};

/** NatureGram's own words, with the everyday word beside each. */
const WORDS: [string, string][] = [
  ['Moments', 'Short clips from outside, one after another.'],
  ['Wild', 'Sightings explorers have shared, newest and nearest first.'],
  ['Lens', 'Your camera, with a guide (an AI) that helps you name what you see.'],
  ['Journal', 'All your own sightings, shared or only for you.'],
  ['Sighting', 'One thing you saw or heard: photos, a clip or a sound, with its name.'],
  ['Marvel', 'A like. Double-tap a sighting, or tap the star.'],
  // glossary-ok: the glossary explains NatureGram's words with the everyday ones
  ['Field notes', 'Comments on a sighting.'],
  // glossary-ok: the glossary explains NatureGram's words with the everyday ones
  ['Letters', 'Private messages between explorers.'],
  ['Kept', 'Sightings you saved from other explorers.'],
  ['Life list', 'Every species you have found, numbered in the order you first met them.'],
  // glossary-ok: the glossary explains NatureGram's words with the everyday ones
  ['Plate', 'A card for one species, like a page in a field guide. You can share it as a picture.'],
  ['Only me (in pencil)', 'A sighting kept private in your Journal.'],
  ['Unfinished', 'Drafts: captures you haven’t written up yet.'],
  ['Naturalist of the fortnight', 'A famous naturalist who sets the colours and a small challenge for two weeks.'],
  ['Stamp', 'A mark on your field page for answering a fortnight’s challenge.'],
];
const WordsSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <Sheet title="What the words mean" onClose={onClose}>
    <dl className="flex flex-col">
      {WORDS.map(([w, d]) => (
        <div key={w} className="py-3 border-b border-stone-200/70 last:border-b-0">
          <dt className="font-display italic text-lg text-stone-900">{w}</dt>
          <dd className="ng-small text-stone-700 mt-0.5">{d}</dd>
        </div>
      ))}
    </dl>
  </Sheet>
);

const PROFILE_REASONS = ['Pretending to be someone', 'Harassment or bullying', 'Spam', 'Inappropriate photo or name', 'Someone under 13', 'Something else'];
const ReportProfile: React.FC<{ userId: string; onDone: (msg: string) => void }> = ({ userId, onDone }) => {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!reason || busy) return;
    setBusy(true);
    try {
      const fn = (FirebaseService as any).reportContent;
      if (typeof fn !== 'function') throw new Error('unavailable');
      await fn({ kind: 'profile', userId }, reason, details.trim());
      onDone("Thanks. We'll look at it within a day. They won't be told who reported them.");
    } catch { onDone("The report couldn't be sent. Please try again."); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-1 -mx-3">
      {PROFILE_REASONS.map(r => (
        <button key={r} role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className={`ng-menu-item min-h-[48px] ${reason === r ? 'font-semibold' : ''}`}>
          <span className={`w-4 h-4 rounded-full border ${reason === r ? 'border-stone-900 bg-stone-900' : 'border-stone-400'}`} aria-hidden="true" />{r}
        </button>
      ))}
      {reason === 'Something else' && (
        <label className="px-3 pt-2 block">
          <span className="ng-label">What's wrong?</span>
          <textarea value={details} onChange={e => setDetails(e.target.value.slice(0, 500))} rows={3} className="mt-2 w-full rounded-lg border border-stone-300 bg-white p-3 text-[15px]" />
        </label>
      )}
      <div className="px-3 pt-3">
        <button onClick={send} disabled={!reason || busy} className="ng-button-primary w-full disabled:opacity-50">{busy ? 'Sending…' : 'Send report'}</button>
      </div>
    </div>
  );
};

const PushToggle: React.FC<{ onToast: (m: string) => void }> = ({ onToast }) => {
  const [on, setOn] = useState(pushEnabled());
  const toggle = async () => {
    if (on) { disablePush(); setOn(false); onToast('Notifications turned off'); return; }
    const r = await enablePush();
    if (r === 'granted') { setOn(true); onToast('Notifications on'); }
    else if (r === 'denied') onToast('Notifications are blocked in your browser settings');
    else onToast('This browser does not support notifications');
  };
  return (
    <button role="switch" aria-checked={on} onClick={toggle} className="ng-menu-item min-h-[52px]">
      <Glyph name="bell" size={24} />
      <span className="flex-1">Notifications on this device<span className="block ng-caption">Choose below which ones may reach you</span></span>
      <span className={`w-11 h-6 rounded-full relative transition-colors ${on ? 'bg-stone-900' : 'bg-stone-300'}`} aria-hidden="true"><span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} /></span>
    </button>
  );
};

const EditProfileSheet: React.FC<{ profile: UserProfileData | null; onClose: () => void; onSaved: (msg: string) => void }> = ({ profile, onClose, onSaved }) => {
  const [username, setUsername] = useState(profile?.username || '');
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); }, [avatarPreview]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (avatarFile) await FirebaseService.uploadAvatar(avatarFile);
      await FirebaseService.updateMyProfile({ username, bio, displayName });
      onSaved('Field page updated');
    } catch (err: any) {
      setError(err?.message?.includes('Usernames') ? err.message : 'Could not save your field page. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <Sheet title="Edit field page" onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <Avatar url={avatarPreview || profile?.avatarUrl} name={username} size={96} />
          <button type="button" onClick={() => fileRef.current?.click()} className="ng-link-quiet min-h-[44px]">Change photo</button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => {
            const f = e.target.files?.[0];
            if (f) { setAvatarFile(f); setAvatarPreview(URL.createObjectURL(f)); }
          }} />
        </div>
        <label className="block">
          <span className="block ng-label mb-2">Name</span>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={60} autoComplete="name" className="ng-field w-full px-4 py-3" />
        </label>
        <label className="block">
          <span className="block ng-label mb-2">Username</span>
          <input value={username} onChange={e => setUsername(e.target.value)} maxLength={30} required minLength={3} pattern="[a-zA-Z0-9_.]{3,30}" autoComplete="username" className="ng-field w-full px-4 py-3" />
          <span className="block ng-caption mt-1.5">Letters, numbers, dots and underscores.</span>
        </label>
        <label className="block">
          <span className="block ng-label mb-2">Bio</span>
          <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={300} rows={3} placeholder="Birder in the Thar desert. Moth enthusiast." className="ng-field w-full px-4 py-3 resize-none" />
          <span className="block ng-caption mt-1.5 text-right">{bio.length}/300</span>
        </label>
        {error && <p role="alert" className="text-sm text-red-800 border-l-2 border-red-700 pl-3 py-1">{error}</p>}
        <button type="submit" disabled={busy} className="ng-button-primary w-full">{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Sheet>
  );
};

const DeleteAccountSheet: React.FC<{ username: string; lifeList: LifeEntry[]; onDownloadData: () => void; onClose: () => void; onDeleted: () => void }> = ({ username, lifeList, onDownloadData, onClose, onDeleted }) => {
  const [confirmText, setConfirmText] = useState('');
  const [plating, setPlating] = useState(false);
  const [saved, setSaved] = useState('');
  const savePlates = async () => {
    setPlating(true); setSaved('');
    try {
      const blob = await contactSheet(lifeList);
      if (blob) { saveBlob(blob, `naturegram-plates-${new Date().toISOString().slice(0, 10)}.png`); setSaved('Your plates are saved.'); }
      else setSaved("The plates couldn't be drawn. The list download still works.");
    } finally { setPlating(false); }
  };
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const busy = !!progress && !error;

  const run = async () => {
    setError('');
    try {
      await FirebaseService.deleteMyAccount(setProgress);
      onDeleted();
    } catch (e: any) {
      // The server checks a recent log-in before anything is deleted
      if (e?.code === 'auth/requires-recent-login' || e?.message === 'recent-login-required') {
        setNeedsReauth(true);
        setError('For your security, please log in again, then delete your account.');
      } else {
        setError('Deletion could not finish. Please try again. Anything already removed stays removed.');
      }
      setProgress('');
    }
  };

  return (
    <Sheet title="Delete account" onClose={busy ? () => {} : onClose}>
      {needsReauth ? (
        <AuthModal inline initialIsSignUp={false} reason="Log in again to confirm it's you." onSuccess={() => { setNeedsReauth(false); setError(''); run(); }} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="ng-body">This permanently deletes <strong>{username}</strong>: your field page, every sighting and its media, field notes, marvels, follows, drafts and private details. <strong>This cannot be undone.</strong></p>
          <section aria-labelledby="keep-first" className="py-5 border-y border-stone-200/80">
            <h3 id="keep-first" className="ng-subtitle flex items-center gap-3"><Glyph name="plate" size={20} className="text-stone-500" />Download your plates first</h3>
            <p className="ng-small mt-1">
              {lifeList.length
                ? `Take your life list of ${lifeList.length} species with you before it goes.`
                : 'Take a copy of everything you recorded before it goes.'}
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {lifeList.length > 0 && (
                <>
                  <button onClick={savePlates} disabled={plating} className="ng-button-quiet w-full text-sm">
                    {plating ? 'Pressing your plates…' : `Save ${Math.min(12, lifeList.length) === lifeList.length ? 'all your plates' : 'your first 12 plates'} as one picture`}
                  </button>
                  <button onClick={() => lifeListFiles(lifeList)} className="ng-button-quiet w-full text-sm">Save the life list (spreadsheet and JSON)</button>
                </>
              )}
              <button onClick={onDownloadData} className="ng-button-quiet w-full text-sm">Download all my data</button>
            </div>
            {saved && <p role="status" className="ng-small mt-3">{saved}</p>}
          </section>
          <label className="block">
            <span className="block ng-label mb-2">Type DELETE to confirm</span>
            <input value={confirmText} onChange={e => setConfirmText(e.target.value)} className="ng-field w-full px-4 py-3" autoCapitalize="characters" />
          </label>
          {progress && <p role="status" className="ng-small text-stone-700">{progress}</p>}
          {error && <p role="alert" className="text-sm text-red-800 border-l-2 border-red-700 pl-3 py-1">{error}</p>}
          <button onClick={run} disabled={confirmText !== 'DELETE' || busy} className="w-full min-h-[48px] rounded-full bg-red-700 hover:bg-red-800 text-white text-[15px] font-semibold disabled:opacity-40">{busy ? 'Deleting…' : 'Permanently delete my account'}</button>
        </div>
      )}
    </Sheet>
  );
};

export default UserProfile;
