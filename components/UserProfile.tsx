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
import { buildLifeList, LifeEntry, LifeGroup, GROUP_GLYPH, MILESTONES, ordinal, toMs, seasonOf, groupOf } from '../services/lifeList';
import { renderPlate, sharePlate } from '../services/plateImage';
import { SpecimenPlate, PlateStamp, PlateData } from './SpecimenPlate';
import Glyph from './Glyph';
import { getThemePeriod } from '../constants/naturalistExtras';
import { fieldMoment } from './Wonder';
import { themeAccent } from './ShareSheet';

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
}

type Tab = 'posts' | 'lifelist' | 'saved';

const Avatar: React.FC<{ url?: string | null; name?: string; size?: number }> = ({ url, name, size = 88 }) => (
  url
    ? <img src={url} alt={`${name || 'Explorer'}'s profile photo`} className="rounded-full object-cover bg-stone-100" style={{ width: size, height: size }} />
    : <div className="rounded-full bg-theme-accent/10 text-theme-accent flex items-center justify-center font-display font-semibold" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">{(name || '?').charAt(0).toUpperCase()}</div>
);

const Sheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center animate-fade-in" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-[2rem] sm:rounded-[2rem] max-h-[85dvh] flex flex-col animate-slide-up pb-[env(safe-area-inset-bottom)]">
        <header className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <h2 className="text-lg font-bold text-stone-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-stone-100">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
};

/** "23 species since March 2026. Your first was the House Sparrow." in one quiet line. */
const lifeListSummary = (entries: LifeEntry[], own: boolean): string => {
  const first = entries[0];
  if (!first) return '';
  const since = first.firstMs ? ` since ${new Date(first.firstMs).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` : '';
  const n = entries.length;
  return `${n} species${since}. ${own ? 'Your' : 'Their'} first was the ${first.name}.`;
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
      <div className="relative flex items-center gap-3 px-4 py-2.5 bg-[#fdf4dc] border-y border-[#e3c98a] text-[#6f5114]">
        <Glyph name="stamp" size={22} className="shrink-0 text-[#b8892b]" />
        <p className="text-sm leading-snug">
          <span className="font-display text-[15px]">{own ? 'Your' : 'Their'} {ordinal(entry.no)} species</span>, the <em className="font-display">{entry.name}</em>, found during {naturalist}'s fortnight.
        </p>
      </div>
    </li>
  );
};

/** A plate in the grid: tapping it opens the sighting; the small corner button shares the plate image. */
const PlateCell: React.FC<{ entry: LifeEntry; onOpen?: (id: string) => void; onShare: (e: LifeEntry) => void; milestone?: boolean }> = ({ entry, onOpen, onShare, milestone }) => (
  <li className="relative mb-2">
    <SpecimenPlate data={plateOf(entry)} onClick={() => onOpen?.(entry.postId)} stamp={milestone ? <PlateStamp>{ordinal(entry.no)} species</PlateStamp> : undefined} />
    <button onClick={() => onShare(entry)} aria-label={`Share the plate of ${entry.name}`} className="absolute -bottom-3 right-2 w-9 h-9 rounded-full flex items-center justify-center bg-[#fbf7ef] border border-[#d8ccb6] shadow-sm text-[#8a7a60] hover:text-theme-primary">
      <span className="material-symbols-outlined text-[17px]" aria-hidden="true">ios_share</span>
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
}> = ({ entries, own, ghosts, onOpenPost, onShare }) => {
  const [view, setView] = useState<'kind' | 'chronicle'>(() => {
    try { return localStorage.getItem('ng_lifelist_view') === 'chronicle' ? 'chronicle' : 'kind'; } catch { return 'kind'; }
  });
  const choose = (v: 'kind' | 'chronicle') => { setView(v); try { localStorage.setItem('ng_lifelist_view', v); } catch { /* storage blocked */ } };

  const groups = useMemo(() => {
    const m = new Map<LifeGroup, LifeEntry[]>();
    entries.forEach(e => m.set(e.group, [...(m.get(e.group) || []), e]));
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [entries]);

  const grid = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4';

  return (
    <div className="px-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 pt-4 pb-3">
        <p className="text-sm font-display text-stone-600 min-w-0">{lifeListSummary(entries, own)}</p>
        <div role="radiogroup" aria-label="Arrange the life list" className="flex p-0.5 rounded-full bg-theme-primary/5 border border-theme-primary/10 text-sm">
          {([['kind', 'By kind of life'], ['chronicle', 'Chronicle']] as const).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={view === k} onClick={() => choose(k)} className={`px-3.5 py-1.5 rounded-full transition-colors ${view === k ? 'bg-white text-theme-primary font-semibold shadow-sm' : 'text-stone-500'}`}>{label}</button>
          ))}
        </div>
      </div>

      {view === 'kind' ? (
        <div className="space-y-7">
          {groups.map(([g, list]) => (
            <section key={g} aria-labelledby={`grp-${g}`}>
              <h3 id={`grp-${g}`} className="flex items-center gap-2 mb-3 text-theme-primary">
                <Glyph name={GROUP_GLYPH[g]} size={20} className="text-theme-accent" />
                <span className="font-display text-lg">{g}</span>
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
                  <li className="col-span-full flex items-baseline gap-2 pt-3 first:pt-0 border-b border-theme-primary/10 pb-1.5">
                    <span className="font-display text-lg text-theme-primary">{monthKey(e.firstMs)}</span>
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
        <section aria-labelledby="still-to-find" className="mt-10">
          <h3 id="still-to-find" className="font-display text-lg text-theme-primary">Still to find nearby</h3>
          <p className="text-sm text-stone-500 mb-3">Other explorers have recorded these close to where you walk. The plate is waiting.</p>
          <ul className={grid} role="list">
            {ghosts.map(g => (
              <li key={g.id}>
                <SpecimenPlate ghost data={{ name: g.name, group: g.group }} onClick={() => onOpenPost?.(g.id)} />
                <p className="mt-1.5 px-1 text-xs text-stone-500 truncate">{[g.by ? `Seen by ${g.by}` : '', g.area ? `near ${g.area}` : ''].filter(Boolean).join(' ')}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

/** Sightings as specimen drawers: one drawer per month, each tile labelled along a date strip. */
const SightingDrawers: React.FC<{ posts: CommunityPost[]; own: boolean; onOpenPost?: (id: string) => void }> = ({ posts, own, onOpenPost }) => {
  const drawers = useMemo(() => {
    const out: { key: string; season: string; list: CommunityPost[] }[] = [];
    for (const p of posts) {
      const ms = toMs(p.timestamp);
      const key = monthKey(ms);
      const last = out[out.length - 1];
      if (last && last.key === key) last.list.push(p);
      else out.push({ key, season: seasonWord(ms), list: [p] });
    }
    return out;
  }, [posts]);
  return (
    <div className="px-3 pb-8 pt-3 space-y-6">
      {drawers.map(d => (
        <section key={d.key} aria-label={`${d.key}, ${d.list.length} sightings`}>
          <header className="flex items-baseline justify-between px-1 mb-2">
            <h3 className="font-display text-lg text-theme-primary">{d.key}</h3>
            <span className="text-sm text-stone-500">{d.season ? `${d.season} · ` : ''}{d.list.length} {d.list.length === 1 ? 'sighting' : 'sightings'}</span>
          </header>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2 rounded-md bg-[#efe7d6]/70 border border-[#d8ccb6] shadow-[inset_0_2px_6px_rgba(60,40,20,0.10)]" role="list">
            {d.list.map(p => {
              const ms = toMs(p.timestamp);
              const name = p.labels?.[0] || p.title || 'Sighting';
              const src = p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl;
              const multi = (p.items?.length || 0) > 1;
              return (
                <li key={p.id} className="relative bg-[#fbf7ef] rounded-[3px] shadow-[0_1px_2px_rgba(60,40,20,0.12)] overflow-hidden">
                  <button onClick={() => onOpenPost?.(p.id)} className="group block w-full text-left" aria-label={`Open ${name}`}>
                    <span className="block aspect-[4/5] bg-[#efe7d6] overflow-hidden relative">
                      {src
                        ? <img src={src} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                        : <span className="w-full h-full flex items-center justify-center text-[#b9a98a]">{p.mediaType === 'audio' ? <Glyph name="sound" size={32} /> : <Glyph name={GROUP_GLYPH[groupOf(p)]} size={32} />}</span>}
                      {(p.mediaType === 'video' || multi) && (
                        <span className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/45 text-white px-1.5 py-0.5" aria-hidden="true">
                          {p.mediaType === 'video' && <span className="material-symbols-outlined text-[16px]">play_circle</span>}
                          {multi && <><span className="material-symbols-outlined text-[16px]">collections</span><span className="text-[11px] font-semibold tabular">{p.items!.length}</span></>}
                        </span>
                      )}
                      {own && !p.isPublic && <span className="absolute top-1.5 left-1.5 bg-black/55 text-white text-[11px] font-semibold rounded-full px-2 py-0.5 flex items-center gap-1"><span className="material-symbols-outlined text-xs" aria-hidden="true">lock</span>Journal</span>}
                    </span>
                    <span className="flex items-baseline justify-between gap-2 px-2 py-1.5 border-t border-[#e8dfcd]">
                      <span className="font-display italic text-[14px] text-[#2f2a22] truncate">{name}</span>
                      {ms > 0 && <span className="shrink-0 text-[11px] text-[#8a7a60] tabular">{new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
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
    <div className="px-4 pb-8 pt-3 space-y-6">
      {folios.map(f => (
        <section key={f.key} aria-label={f.key}>
          <h3 className="font-display text-base text-stone-600 mb-2 px-1">{f.key}</h3>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3" role="list">
            {f.list.map(s => {
              const name = (s.label || '').trim() || 'A kept sighting';
              const group = groupOf({ labels: [name] });
              return (
                <li key={s.id}>
                  <button onClick={() => onOpenPost?.(s.id)} aria-label={`Open kept ${name}`} className="block w-full text-left p-2 pb-2.5 bg-[#fbf7ef] rounded-[3px] shadow-[0_1px_2px_rgba(60,40,20,0.12),0_6px_14px_-8px_rgba(60,40,20,0.25)] active:scale-[0.98] transition-transform">
                    <span className="relative block aspect-square overflow-hidden bg-[#efe7d6]">
                      {s.thumbnailUrl
                        ? <img src={s.thumbnailUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover sepia-[.12] saturate-[.9]" />
                        : <span className="w-full h-full flex items-center justify-center text-[#b9a98a]"><Glyph name={s.mediaType === 'audio' ? 'sound' : GROUP_GLYPH[group]} size={36} /></span>}
                      {/* glassine: a faint translucent sheet over the specimen */}
                      <span className="absolute inset-0 bg-gradient-to-b from-white/35 via-white/15 to-white/30 ring-1 ring-inset ring-white/60" aria-hidden="true" />
                    </span>
                    <span className="block mt-2 font-display italic text-[14px] text-[#2f2a22] leading-tight line-clamp-2">{name}</span>
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
  ctx.fillStyle = '#f3ede1'; ctx.fillRect(0, 0, c.width, c.height);
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

const UserProfile: React.FC<UserProfileProps> = ({ userId, currentUserId, isAnonymous, onBack, onSignOut, onViewJournal, onAdminConsole, onOpenPost, onViewProfile, onRequireAccount, onMessage }) => {
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('posts');
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [saved, setSaved] = useState<{ id: string; thumbnailUrl?: string; label?: string }[] | null>(null);
  const [sheet, setSheet] = useState<null | 'settings' | 'edit' | 'followers' | 'following' | 'delete' | 'menu'>(null);
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
  const visiblePosts = useMemo(() => isOwnProfile ? posts : posts.filter(p => p.isPublic), [posts, isOwnProfile]);

  // Life list: every distinct species, numbered in the order it was first found
  const lifeList = useMemo(() => buildLifeList(visiblePosts), [visiblePosts]);

  // The masthead: home range, favourite season and hour, latest plate
  const masthead = useMemo(() => {
    const stamps = visiblePosts.map(p => toMs(p.timestamp)).filter(ms => ms > 0);
    const areas = visiblePosts
      .filter(p => isOwnProfile || p.showLocation !== false)
      .map(p => String(p.locationArea || p.items?.[0]?.locationArea || '').trim());
    const latest = lifeList.length ? lifeList[lifeList.length - 1] : null;
    return {
      homeRange: mode(areas),
      season: mode(stamps.map(seasonWord)),
      hour: mode(stamps.map(ms => fieldMoment(new Date(ms)).name.toLowerCase())),
      latest,
    };
  }, [visiblePosts, lifeList, isOwnProfile]);

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

  const toggleBlock = async () => {
    setSheet(null);
    if (!blocked && !window.confirm(`Block ${username}? You won't see their posts or comments, and they'll be removed from your followers list.`)) return;
    try {
      if (blocked) { await FirebaseService.unblockUser(userId); setBlocked(false); showToast(`${username} unblocked`); }
      else { await FirebaseService.blockUser(userId); setBlocked(true); setFollowing(false); showToast(`${username} blocked`); }
    } catch { showToast('Something went wrong. Please try again.'); }
  };

  const shareProfile = async () => {
    const url = `${PUBLIC_ORIGIN}/profile?user=${encodeURIComponent(userId)}`;
    try {
      if (navigator.share) await navigator.share({ title: `${username} on NatureGram`, url });
      else { await navigator.clipboard.writeText(url); showToast('Profile link copied'); }
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
        <Glyph name="press" size={36} className="text-theme-accent/60 animate-pulse" />
        <span className="sr-only">Opening the field page…</span>
      </div>
    );
  }

  if (isAnonymous && isOwnProfile) {
    return (
      <div className="flex-1 overflow-y-auto no-scrollbar bg-day-bg pb-28 safe-pt">
        <section className="px-5 pt-8 pb-4 max-w-lg mx-auto">
          <div className="flex items-center gap-4">
            <span className="shrink-0 w-20 h-20 rounded-full border border-dashed border-theme-accent/50 flex items-center justify-center text-theme-accent/70" aria-hidden="true">
              <span className="material-symbols-outlined text-4xl" style={{ fontVariationSettings: "'wght' 200" }}>fingerprint</span>
            </span>
            <div>
              <p className="text-2xl font-display font-semibold text-theme-primary leading-tight">Your field page</p>
              <p className="text-sm text-stone-500 mt-0.5">Exploring as a guest</p>
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 border-y border-theme-primary/10 divide-x divide-theme-primary/10">
            <div className="py-3 text-center"><dd className="text-xl font-display font-semibold text-theme-primary/40 tabular">0</dd><dt className="text-xs text-stone-500">species</dt></div>
            <div className="py-3 text-center"><dd className="text-xl font-display font-semibold text-theme-primary/40 tabular">0</dd><dt className="text-xs text-stone-500">sightings</dt></div>
          </dl>
          <p className="text-[15px] text-stone-700 mt-6">Your life list and journal will live here.</p>
          <button onClick={() => onRequireAccount?.('Create a free account to keep your journal and life list.')} className="mt-6 w-full py-3.5 rounded-2xl bg-theme-primary text-white font-bold">Start my field page</button>
        </section>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-day-bg overflow-hidden animate-fade-in">
      <header className="px-3 py-2 flex items-center justify-between bg-day-bg/90 backdrop-blur border-b border-theme-primary/10 shrink-0 safe-pt">
        {!isOwnProfile ? (
          <button onClick={onBack} aria-label="Back" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-stone-100">
            <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          </button>
        ) : <span className="w-11" />}
        <h1 className="font-display font-semibold text-lg text-theme-primary truncate">{username}</h1>
        <button onClick={() => setSheet(isOwnProfile ? 'settings' : 'menu')} aria-label={isOwnProfile ? 'Settings' : 'More options'} className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-stone-100">
          <span className="material-symbols-outlined" aria-hidden="true">{isOwnProfile ? 'menu' : 'more_horiz'}</span>
        </button>
      </header>

      <main className="flex-1 overflow-y-auto no-scrollbar pb-24">
        <section className="px-5 pt-6 pb-4">
          <div className="flex items-center gap-4">
            <button onClick={() => isOwnProfile && setSheet('edit')} disabled={!isOwnProfile} aria-label={isOwnProfile ? 'Change profile photo' : undefined} className="shrink-0 rounded-full p-[3px] border border-theme-accent/40">
              <Avatar url={profile?.avatarUrl} name={username} />
            </button>
            <div className="min-w-0">
              <p className="text-2xl font-display font-semibold text-theme-primary leading-tight truncate">{profile?.displayName || username}</p>
              <p className="text-sm text-stone-500 mt-0.5">{exploringSince(profile?.joinedAt)}</p>
            </div>
          </div>
          {profile?.bio ? <p className="text-[15px] font-display text-stone-700 mt-4 whitespace-pre-line leading-relaxed">{profile.bio}</p> : isOwnProfile && (
            <button onClick={() => setSheet('edit')} className="text-sm text-theme-accent font-semibold mt-4">Add a bio</button>
          )}
          <section aria-label="Field page" className="mt-5 py-4 border-y border-theme-primary/15 flex gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-5">
                <button onClick={() => setTab('lifelist')} className="text-left group">
                  <span className="block text-[28px] leading-none font-display text-theme-primary tabular group-hover:underline decoration-theme-accent/40 underline-offset-4">{lifeList.length}</span>
                  <span className="block text-xs text-stone-500 mt-1">species on the list</span>
                </button>
                <button onClick={() => setTab('posts')} className="text-left group">
                  <span className="block text-[28px] leading-none font-display text-theme-primary tabular group-hover:underline decoration-theme-accent/40 underline-offset-4">{visiblePosts.length}</span>
                  <span className="block text-xs text-stone-500 mt-1">{visiblePosts.length === 1 ? 'sighting' : 'sightings'}</span>
                </button>
              </div>
              <dl className="mt-3 space-y-1 text-sm">
                {masthead.homeRange && <div className="flex gap-2"><dt className="text-stone-500 shrink-0">Home range</dt><dd className="text-stone-800 font-display truncate">{masthead.homeRange}</dd></div>}
                {masthead.season && <div className="flex gap-2"><dt className="text-stone-500 shrink-0">Favourite season</dt><dd className="text-stone-800 font-display">{masthead.season}</dd></div>}
                {masthead.hour && <div className="flex gap-2"><dt className="text-stone-500 shrink-0">Favourite hour</dt><dd className="text-stone-800 font-display">{masthead.hour}</dd></div>}
                {!masthead.homeRange && !masthead.season && <div className="text-stone-500">{isOwnProfile ? 'The first entry on this page is still to be written.' : 'This field page is still blank.'}</div>}
              </dl>
            </div>
            {masthead.latest && (
              <div className="w-[112px] shrink-0">
                <p className="text-xs text-stone-500 mb-1.5">Latest plate</p>
                <SpecimenPlate size="sm" data={plateOf(masthead.latest)} onClick={() => onOpenPost?.(masthead.latest!.postId)} />
              </div>
            )}
          </section>
          <p className="mt-3 text-sm text-stone-500">
            <button onClick={() => setSheet('followers')} className="hover:text-theme-primary hover:underline underline-offset-4">Read by {(profile?.followersCount || 0).toLocaleString()} {profile?.followersCount === 1 ? 'explorer' : 'explorers'}</button>
            <span aria-hidden="true"> · </span>
            <button onClick={() => setSheet('following')} className="hover:text-theme-primary hover:underline underline-offset-4">reads {(profile?.followingCount || 0).toLocaleString()}</button>
          </p>
          <div className="flex gap-2 mt-4">
            {isOwnProfile ? (
              <>
                <button onClick={() => setSheet('edit')} className="flex-1 py-2.5 rounded-xl border border-theme-primary/15 hover:bg-theme-primary/5 text-sm font-bold text-theme-primary">Edit profile</button>
                <button onClick={onViewJournal} className="flex-1 py-2.5 rounded-xl border border-theme-primary/15 hover:bg-theme-primary/5 text-sm font-bold text-theme-primary flex items-center justify-center gap-1.5"><span className="material-symbols-outlined text-lg" aria-hidden="true">fingerprint</span>Journal</button>
                <button onClick={shareProfile} aria-label="Share profile" className="w-11 py-2.5 rounded-xl border border-theme-primary/15 hover:bg-theme-primary/5 text-theme-primary flex items-center justify-center"><span className="material-symbols-outlined text-xl" aria-hidden="true">share</span></button>
              </>
            ) : blocked ? (
              <button onClick={toggleBlock} className="flex-1 py-2.5 rounded-xl border border-theme-primary/15 text-sm font-bold text-theme-primary">Unblock</button>
            ) : (
              <>
                <button onClick={toggleFollow} disabled={followBusy} aria-pressed={following} className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${following ? 'border border-theme-primary/15 text-theme-primary hover:bg-theme-primary/5' : 'bg-theme-primary text-white hover:opacity-90'}`}>
                  {following ? 'Following' : 'Follow'}
                </button>
                <button onClick={async () => {
                  // A letter that can't be opened says why, instead of doing nothing.
                  try { await onMessage?.(userId); } catch (e: any) { console.error('letter failed', e); showToast(socialError(e, 'Could not open a letter. Please try again.')); }
                }} className="flex-1 py-2.5 rounded-xl border border-theme-primary/15 hover:bg-theme-primary/5 text-sm font-bold text-theme-primary flex items-center justify-center gap-1.5"><span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">mail</span>Write a letter</button>
                <button onClick={shareProfile} aria-label="Share profile" className="w-11 py-2.5 rounded-xl border border-theme-primary/15 hover:bg-theme-primary/5 text-theme-primary flex items-center justify-center"><span className="material-symbols-outlined text-xl" aria-hidden="true">share</span></button>
              </>
            )}
          </div>
          {isOwnProfile && needsVerification && (
            <div className="mt-4 p-3 rounded-xl bg-amber-50 text-amber-900 text-sm flex items-center gap-3">
              <span className="material-symbols-outlined" aria-hidden="true">mark_email_unread</span>
              <span className="flex-1">Verify your email to secure your account.</span>
              <button onClick={async () => { await FirebaseService.sendVerificationEmail(); showToast('Verification email sent'); }} className="font-bold">Send link</button>
            </div>
          )}
        </section>

        {blocked && !isOwnProfile ? (
          <p className="text-center text-stone-500 py-16 px-8">You've blocked this explorer. Unblock to see their posts.</p>
        ) : (
          <>
            <div role="tablist" aria-label="Profile sections" className="flex bg-day-bg/95 backdrop-blur border-b border-theme-primary/10 sticky top-0 z-10">
              {([
                { key: 'posts', icon: 'landscape', label: 'Sightings' },
                { key: 'lifelist', icon: 'fern', label: 'Life list' },
                ...(isOwnProfile ? [{ key: 'saved', icon: 'filter_vintage', label: 'Kept' }] : []),
              ] as { key: Tab; icon: string; label: string }[]).map(t => (
                <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`flex-1 py-3 flex items-center justify-center gap-1.5 text-sm border-b-2 transition-colors ${tab === t.key ? 'border-theme-accent text-theme-primary font-display font-semibold text-[15px]' : 'border-transparent text-stone-500 font-semibold'}`}>
                  {t.icon === 'fern'
                    ? <Glyph name="fern" size={20} strokeWidth={tab === t.key ? 1.8 : 1.4} />
                    : <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: tab === t.key ? "'FILL' 1" : "'wght' 300" }} aria-hidden="true">{t.icon}</span>}{t.label}
                </button>
              ))}
            </div>

            {tab === 'posts' && (
              visiblePosts.length === 0 ? (
                <div className="text-center py-16 px-8 text-stone-500">
                  <span className="material-symbols-outlined text-5xl mb-3 text-theme-accent/60" style={{ fontVariationSettings: "'wght' 200" }} aria-hidden="true">camera</span>
                  <p className="font-display text-xl text-stone-800">{isOwnProfile ? 'Your first sighting is out there' : 'No public sightings yet'}</p>
                  {isOwnProfile && <p className="text-sm mt-1">Open the Lens and point it at something alive.</p>}
                </div>
              ) : (
                <SightingDrawers posts={visiblePosts} own={isOwnProfile} onOpenPost={onOpenPost} />
              )
            )}

            {tab === 'lifelist' && (
              lifeList.length === 0 ? (
                <div className="text-center py-16 px-8 max-w-sm mx-auto text-stone-500">
                  <Glyph name="fern" size={44} className="text-theme-accent/60 mb-3" />
                  <p className="font-display text-xl text-stone-800">{isOwnProfile ? 'Your herbarium is waiting' : 'No plates yet'}</p>
                  <p className="text-sm mt-1">Every species {isOwnProfile ? 'you identify' : 'this explorer identifies'} becomes a numbered plate here, with the day, place and season it was first seen.</p>
                </div>
              ) : (
                <LifeListView entries={lifeList} own={isOwnProfile} ghosts={ghosts} onOpenPost={onOpenPost} onShare={sharePlateOf} />
              )
            )}

            {tab === 'saved' && isOwnProfile && (
              saved === null ? (
                <div className="flex flex-col items-center py-14 text-stone-500" role="status">
                  <Glyph name="press" size={32} className="text-theme-accent/60 animate-pulse" />
                  <p className="mt-2 text-sm font-display">Opening the press…</p>
                </div>
              ) :
              saved.length === 0 ? (
                <div className="text-center py-16 px-8 max-w-sm mx-auto text-stone-500">
                  <span className="material-symbols-outlined text-5xl mb-3 text-theme-accent/60" style={{ fontVariationSettings: "'wght' 200" }} aria-hidden="true">filter_vintage</span>
                  <p className="text-sm">Tap Keep on any sighting you want to come back to, and it is pressed here like a flower between pages. Only you can see what you've kept.</p>
                </div>
              ) : (
                <KeptPages items={saved} onOpenPost={onOpenPost} />
              )
            )}
          </>
        )}
      </main>

      {sheet === 'edit' && <EditProfileSheet profile={profile} onClose={() => setSheet(null)} onSaved={(m) => { setSheet(null); showToast(m); }} />}

      {(sheet === 'followers' || sheet === 'following') && (
        <Sheet title={sheet === 'followers' ? 'Read by' : 'Reading'} onClose={() => setSheet(null)}>
          {people === null ? <p className="text-stone-500 text-center py-6 font-display" role="status">Gathering the names…</p> :
            people.length === 0 ? (
              <div className="text-center py-6 px-2">
                <Glyph name={sheet === 'followers' ? 'binoculars' : 'notebook'} size={32} className="text-theme-accent/60 mb-2" />
                <p className="text-stone-700 font-display text-lg">
                  {sheet === 'followers'
                    ? (isOwnProfile ? 'No one is reading your field page yet' : `No one reads ${username}'s page yet`)
                    : (isOwnProfile ? "You're not reading anyone yet" : `${username} isn't reading anyone yet`)}
                </p>
                <p className="text-sm text-stone-500 mt-1">
                  {sheet === 'followers'
                    ? (isOwnProfile ? 'Share a sighting or two; explorers who notice the same things tend to find you.' : 'You could be the first to follow along.')
                    : (isOwnProfile ? 'Follow an explorer from any sighting and their new pages will reach you.' : 'Their own pages are worth a look in the meantime.')}
                </p>
              </div>
            ) : (
              <ul className="space-y-1" role="list">
                {people.map(p => (
                  <li key={p.uid}>
                    <button onClick={() => { setSheet(null); onViewProfile?.(p.uid); }} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-stone-50 text-left">
                      <Avatar url={p.avatarUrl} name={p.username} size={44} />
                      <span className="flex-1 min-w-0"><span className="block font-semibold text-stone-900 truncate">{p.username}</span>{p.bio && <span className="block text-xs text-stone-500 truncate">{p.bio}</span>}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </Sheet>
      )}

      {sheet === 'menu' && !isOwnProfile && (
        <Sheet title={username} onClose={() => setSheet(null)}>
          <div className="flex flex-col gap-1">
            <button onClick={shareProfile} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">ios_share</span>Share profile</button>
            {currentUserId && !isAnonymous && (
              <button onClick={toggleBlock} className="text-left p-3 rounded-xl hover:bg-red-50 font-semibold text-red-700 flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">block</span>{blocked ? 'Unblock' : 'Block'} {username}</button>
            )}
          </div>
        </Sheet>
      )}

      {sheet === 'settings' && isOwnProfile && (
        <Sheet title="Settings" onClose={() => setSheet(null)}>
          <nav className="flex flex-col gap-1" aria-label="Account settings">
            <button onClick={() => setSheet('edit')} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">edit</span>Edit profile</button>
            <button onClick={() => { setSheet(null); setPersonaOpen(true); }} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><Glyph name="guide" size={24} /><span className="flex-1">Naturalist persona<span className="block text-xs font-normal text-stone-500">{profile?.naturalistPersona?.archetype || 'Personalise your feed and guide'}</span></span></button>
            {pushSupported() && <PushToggle onToast={showToast} />}
            <button onClick={downloadData} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">download</span>Download my data</button>
            {isAdmin && onAdminConsole && (
              <button onClick={() => { setSheet(null); onAdminConsole(); }} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">admin_panel_settings</span>Admin console</button>
            )}
            <a href="/privacy.html" target="_blank" rel="noopener" className="p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">shield</span>Privacy policy</a>
            <a href="/terms.html" target="_blank" rel="noopener" className="p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">description</span>Terms & community guidelines</a>
            <hr className="my-2 border-stone-100" />
            <button onClick={() => { setSheet(null); onSignOut(); }} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">logout</span>Log out</button>
            <button onClick={() => setSheet('delete')} className="text-left p-3 rounded-xl hover:bg-red-50 font-semibold text-red-700 flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">delete_forever</span>Delete account</button>
          </nav>
        </Sheet>
      )}

      {isOwnProfile && (
        <NaturalistPersonaModal
          userId={userId}
          initialPersona={profile?.naturalistPersona}
          isOpen={personaOpen}
          onClose={() => setPersonaOpen(false)}
          onSave={(updated: any) => { setProfile(prev => prev ? { ...prev, naturalistPersona: updated } : prev); setPersonaOpen(false); showToast('Persona saved'); }}
        />
      )}

      {sheet === 'delete' && <DeleteAccountSheet username={username} lifeList={lifeList} onDownloadData={downloadData} onClose={() => setSheet(null)} onDeleted={onSignOut} />}

      {toast && <div role="status" className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[130] bg-stone-900 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg animate-fade-in">{toast}</div>}
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
    <button role="switch" aria-checked={on} onClick={toggle} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3">
      <span className="material-symbols-outlined" aria-hidden="true">notifications</span>
      <span className="flex-1">Notifications<span className="block text-xs font-normal text-stone-500">When explorers marvel, leave field notes, follow or mention you</span></span>
      <span className={`w-11 h-6 rounded-full relative transition-colors ${on ? 'bg-theme-accent' : 'bg-stone-300'}`} aria-hidden="true"><span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} /></span>
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
      onSaved('Profile updated');
    } catch (err: any) {
      setError(err?.message?.includes('Usernames') ? err.message : 'Could not save your profile. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <Sheet title="Edit profile" onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <Avatar url={avatarPreview || profile?.avatarUrl} name={username} size={96} />
          <button type="button" onClick={() => fileRef.current?.click()} className="text-sm font-bold text-theme-accent">Change photo</button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => {
            const f = e.target.files?.[0];
            if (f) { setAvatarFile(f); setAvatarPreview(URL.createObjectURL(f)); }
          }} />
        </div>
        <label className="block">
          <span className="block text-sm font-semibold text-stone-700 mb-1.5">Name</span>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={60} autoComplete="name" className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-base" />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold text-stone-700 mb-1.5">Username</span>
          <input value={username} onChange={e => setUsername(e.target.value)} maxLength={30} required minLength={3} pattern="[a-zA-Z0-9_.]{3,30}" autoComplete="username" className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-base" />
          <span className="block text-xs text-stone-500 mt-1">Letters, numbers, dots and underscores.</span>
        </label>
        <label className="block">
          <span className="block text-sm font-semibold text-stone-700 mb-1.5">Bio</span>
          <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={300} rows={3} placeholder="Birder in the Thar desert. Moth enthusiast." className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-base resize-none" />
          <span className="block text-xs text-stone-500 mt-1 text-right">{bio.length}/300</span>
        </label>
        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 p-3 rounded-xl">{error}</p>}
        <button type="submit" disabled={busy} className="w-full py-3.5 rounded-xl bg-stone-900 text-white font-bold disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
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
      if (e?.code === 'auth/requires-recent-login') {
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
          <p className="text-stone-700 leading-relaxed">This permanently deletes <strong>{username}</strong>: your profile, every post and its media, comments, likes, follows, drafts and private records. <strong>This cannot be undone.</strong></p>
          <section aria-labelledby="keep-first" className="rounded-2xl bg-[#fbf7ef] border border-[#e8dfcd] p-4">
            <h3 id="keep-first" className="font-display text-lg text-theme-primary flex items-center gap-2"><Glyph name="plate" size={20} className="text-theme-accent" />Download your plates first</h3>
            <p className="text-sm text-stone-600 mt-1">
              {lifeList.length
                ? `Take your life list of ${lifeList.length} species with you before it goes.`
                : 'Take a copy of everything you recorded before it goes.'}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {lifeList.length > 0 && (
                <>
                  <button onClick={savePlates} disabled={plating} className="w-full py-2.5 rounded-xl bg-white border border-theme-primary/15 text-sm font-semibold text-theme-primary disabled:opacity-60">
                    {plating ? 'Pressing your plates…' : `Save ${Math.min(12, lifeList.length) === lifeList.length ? 'all your plates' : 'your first 12 plates'} as one picture`}
                  </button>
                  <button onClick={() => lifeListFiles(lifeList)} className="w-full py-2.5 rounded-xl bg-white border border-theme-primary/15 text-sm font-semibold text-theme-primary">Save the life list (spreadsheet and JSON)</button>
                </>
              )}
              <button onClick={onDownloadData} className="w-full py-2.5 rounded-xl bg-white border border-theme-primary/15 text-sm font-semibold text-theme-primary">Download all my data</button>
            </div>
            {saved && <p role="status" className="text-sm text-stone-600 mt-2">{saved}</p>}
          </section>
          <label className="block">
            <span className="block text-sm font-semibold text-stone-700 mb-1.5">Type DELETE to confirm</span>
            <input value={confirmText} onChange={e => setConfirmText(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-base" autoCapitalize="characters" />
          </label>
          {progress && <p role="status" className="text-sm text-stone-700">{progress}</p>}
          {error && <p role="alert" className="text-sm text-red-700 bg-red-50 p-3 rounded-xl">{error}</p>}
          <button onClick={run} disabled={confirmText !== 'DELETE' || busy} className="w-full py-3.5 rounded-xl bg-red-700 text-white font-bold disabled:opacity-40">{busy ? 'Deleting…' : 'Permanently delete my account'}</button>
        </div>
      )}
    </Sheet>
  );
};

export default UserProfile;
