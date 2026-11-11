import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { CommunityPost, UserMode } from '../types';
import { likeTotal, isDataSaver } from '../utils';
import { track } from '../services/analytics';
import { watchTeen } from '../services/guardian';
import { resolvePlayableVideo } from './PlayableVideo';
import { WonderBurst, WonderIcon, wonderLabel, fieldMoment, observedBehaviour, firstSentence } from './Wonder';
import { groupOf, namesOf } from '../services/lifeList';
import ReportSheet, { ReportTarget } from './ReportSheet';
import Glyph from './Glyph';
const ShareSheet = React.lazy(() => import('./ShareSheet'));

interface Props {
  currentUserMode: UserMode;
  onOpenPost: (postId: string) => void;
  onViewProfile: (uid: string) => void;
  onRequireAccount: (reason: string, then?: () => void) => void;
  onBack: () => void;
  /** Moments is home, so it carries the same ways on as Wild: search, activity and letters */
  onOpenExplore?: () => void;
  onOpenActivity?: () => void;
  unreadActivity?: number;
  onOpenMessages?: () => void;
  unreadMessages?: number;
  /** "Send in a letter" from the share sheet (App opens Letters with this sighting attached) */
  onSendAsLetter?: (postId: string) => void;
  /** Hide marvel counts. Defaults to on for teen explorers */
  hideCounts?: boolean;
}

const PROGRAMME_MAX = 7;
/** Clips added by each "Keep watching" before the next gentle end */
const ENCORE = 10;

/** What tends to be happening at this hour, as words to look for in a clip's labels. */
const HOUR_MATCH: Record<string, RegExp> = {
  'Dawn chorus': /(bird|song|call|chorus|robin|thrush|warbler|wren|bulbul|magpie|blackbird)/i,
  'Morning': /(butterfl|moth|bee\b|insect|dragonfl|flower|pollinat)/i,
  'Midday': /(raptor|hawk|eagle|kite|vulture|buzzard|falcon|kestrel|lizard|thermal)/i,
  'Afternoon': /(bird|feed|forag|squirrel|deer|monkey)/i,
  'Dusk': /(bat\b|bats\b|dusk|swift|nightjar|deer|fox)/i,
  'Night': /(owl|frog|toad|moth|cricket|night|bat\b|bats\b|firefl)/i,
};

/** Old placeholder places that say nothing about where a clip was made. */
const PLACEHOLDER_PLACE = /^(uploaded|captured)?\s*field station$|^(unknown|somewhere)$/i;
/** Usernames made up at sign-up ("Explorer-ZJSz") read as "an explorer". */
const explorerName = (n?: string | null) => (!n || /^explorer[-_][a-z0-9]{3,6}$/i.test(n.trim()) ? 'an explorer' : n.trim());

/** "Tonight" only once the evening has come (after five o'clock); before that, "today". */
const isEvening = () => new Date().getHours() >= 17;
const prefersReducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

const HEADER_ACTION = 'relative inline-flex flex-col items-center justify-center gap-1 min-w-[48px] min-h-[52px] px-1 rounded-xl text-white transition-colors hover:bg-white/10';
const HEADER_LABEL = 'text-[11px] leading-none font-medium text-white/85';

/**
 * Moments, as an evening screening: a short programme of video sightings and a natural end that is
 * a resting place, not a door to an endless feed. Clips that suit the hour come first. "Keep
 * watching" adds ten more, then rests again. A tap pauses or plays; the sound is the header button.
 */
const Reels: React.FC<Props> = ({ currentUserMode, onOpenPost, onRequireAccount, onOpenExplore, onOpenActivity, unreadActivity = 0, onOpenMessages, unreadMessages = 0, onSendAsLetter, hideCounts: hideCountsProp }) => {
  const [items, setItems] = useState<CommunityPost[]>([]);
  const [cursor, setCursor] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [burst, setBurst] = useState<{ id: string; x: number; y: number; key: number } | null>(null);
  /** Clips shown after the programme (0 until "Keep watching") */
  const [extra, setExtra] = useState(0);
  const reduced = useMemo(() => prefersReducedMotion(), []);
  // Under reduced motion nothing plays until asked
  const [paused, setPaused] = useState(reduced);
  const [flash, setFlash] = useState<{ kind: 'play' | 'pause'; key: number } | null>(null);
  const [sharing, setSharing] = useState<CommunityPost | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [teenViewer, setTeenViewer] = useState(false);
  useEffect(() => watchTeen(s => setTeenViewer(s.teen)), []);
  const hideCounts = hideCountsProp ?? teenViewer;
  const lastTapRef = useRef(0);
  const isMember = !!currentUserMode.userId && currentUserMode.userId !== 'explorer_guest' && !currentUserMode.isAnonymous;
  const moment = useMemo(() => fieldMoment(), []);
  const evening = useMemo(() => isEvening(), []);
  const when = evening ? 'tonight' : 'today';

  const loadMore = useCallback(async (pageSize?: number) => {
    if (!hasMore || fetching) return;
    setFetching(true);
    try {
      const { posts, lastVisible } = await FirebaseService.getVideoPosts(cursor, pageSize);
      setItems(prev => { const ids = new Set(prev.map(p => p.id)); return [...prev, ...posts.filter(p => !ids.has(p.id))]; });
      setCursor(lastVisible);
      setHasMore(!!lastVisible);
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); setFetching(false); }
  }, [cursor, hasMore, fetching]);

  // The first load is a little larger so tonight's programme has a choice of clips
  useEffect(() => { loadMore(16); track('reels_open'); /* eslint-disable-next-line */ }, []);

  // Tonight's programme: up to seven clips, the ones that suit this hour first, then the most recent
  // (chosen once from the first load, then held still so later pages never reshuffle it)
  const [programmeIdList, setProgrammeIdList] = useState<string[] | null>(null);
  useEffect(() => {
    if (programmeIdList || loading || items.length === 0) return;
    const rx = HOUR_MATCH[moment.name];
    const hay = (p: CommunityPost) => [...(p.labels || []), ...(p.tags || []), p.caption || '', groupOf(p)].join(' ');
    const fits = rx ? items.filter(p => rx.test(hay(p))) : [];
    const rest = items.filter(p => !fits.includes(p));
    setProgrammeIdList([...fits, ...rest].slice(0, PROGRAMME_MAX).map(p => p.id));
  }, [programmeIdList, loading, items, moment.name]);
  const programme = useMemo(() => (programmeIdList || []).map(id => items.find(p => p.id === id)).filter(Boolean) as CommunityPost[], [programmeIdList, items]);
  const programmeIds = useMemo(() => new Set(programme.map(p => p.id)), [programme]);
  const rest = useMemo(() => items.filter(p => !programmeIds.has(p.id)), [items, programmeIds]);
  // The programme's order is fixed; each "Keep watching" adds the next ten in date order
  const visible = useMemo(() => [...programme, ...rest.slice(0, extra)], [programme, rest, extra]);
  const moreToWatch = hasMore || rest.length > extra;
  const showEndCard = !loading && programme.length > 0;
  const onEndCard = showEndCard && activeIdx >= visible.length;

  // After "Keep watching", fetch ahead so the next ten are there when they're wanted
  useEffect(() => {
    if (extra > 0 && rest.length < extra + 3 && hasMore && !fetching && !error) loadMore();
  }, [extra, rest.length, hasMore, fetching, error, loadMore]);

  // Resolve the playable URL for the active moment and its neighbours
  useEffect(() => {
    (isDataSaver() ? [activeIdx] : [activeIdx, activeIdx + 1, activeIdx + 2]).forEach(i => {
      const p = visible[i];
      if (!p || videoUrls[p.id]) return;
      const direct = (p as any).videoUrl as string | undefined;
      (direct ? Promise.resolve({ videoUrl: direct } as any) : FirebaseService.getFullPost(p.id)).then((full: any) => {
        const first = full?.items?.[0];
        resolvePlayableVideo(first?.videoUrl || full?.videoUrl, 'video', first?.streamUrl || full?.streamUrl || (p as any).streamUrl).then(url => {
          if (url) setVideoUrls(prev => ({ ...prev, [p.id]: url }));
        });
      }).catch(() => {});
    });
  }, [activeIdx, visible, videoUrls]);

  // Track which moment is in view
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting && e.intersectionRatio > 0.6) setActiveIdx(Number((e.target as HTMLElement).dataset.idx)); });
    }, { root, threshold: [0.6] });
    root.querySelectorAll('article[data-idx]').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [visible.length, showEndCard]);

  // A new clip in view: it plays from the start (unless reduced motion asks for stillness)
  useEffect(() => { setPaused(reduced); setFlash(null); }, [activeIdx, reduced]);

  // Reaching an end card
  const endSeenRef = useRef(-1);
  useEffect(() => {
    if (!onEndCard || endSeenRef.current === visible.length) return;
    endSeenRef.current = visible.length;
    track('moments_end_reached', { clips: visible.length, encore: extra > 0 });
  }, [onEndCard, visible.length, extra]);

  // Play only the active video, unless it is paused
  useEffect(() => {
    containerRef.current?.querySelectorAll('video').forEach(v => {
      const idx = Number(v.dataset.idx);
      if (idx === activeIdx && !paused) v.play().catch(() => {}); else v.pause();
    });
  }, [activeIdx, videoUrls, paused]);

  const marvel = async (p: CommunityPost) => {
    if (!isMember) { onRequireAccount('Create a free account to marvel at sightings.'); return; }
    const uid = currentUserMode.userId!;
    const legacy = !!p.likes?.includes(uid);
    const isLiked = legacy || !!liked[p.id];
    setLiked(prev => ({ ...prev, [p.id]: !isLiked }));
    setItems(prev => prev.map(x => x.id !== p.id ? x : (isLiked && legacy ? { ...x, likes: (x.likes || []).filter(u => u !== uid) } : { ...x, likeCount: Math.max(0, (x.likeCount || 0) + (isLiked ? -1 : 1)) })));
    try { await FirebaseService.toggleLike(p.id, uid, isLiked, legacy); track(isLiked ? 'unlike' : 'like', { media: 'video', surface: 'moments' }); }
    catch { setLiked(prev => ({ ...prev, [p.id]: isLiked })); }
  };

  const togglePlay = () => {
    setPaused(p => {
      const next = !p;
      setFlash({ kind: next ? 'pause' : 'play', key: Date.now() });
      return next;
    });
  };

  // One tap pauses or plays; two quick taps marvel (and leave play as it was)
  const onTap = (e: React.MouseEvent<HTMLDivElement>, p: CommunityPost) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      const box = e.currentTarget.getBoundingClientRect();
      setBurst({ id: p.id, x: e.clientX - box.left, y: e.clientY - box.top, key: now });
      window.setTimeout(() => setBurst(b => b && b.key === now ? null : b), 1700);
      const isLiked = !!liked[p.id] || !!p.likes?.includes(currentUserMode.userId || '');
      if (!isLiked) marvel(p);
      lastTapRef.current = 0;
      return;
    }
    lastTapRef.current = now;
    window.setTimeout(() => { if (lastTapRef.current === now) togglePlay(); }, 310);
  };

  const keepWatching = () => {
    track('reels_keep_watching', { programme: programme.length, encore: extra > 0 });
    const from = visible.length;
    setExtra(x => x + ENCORE);
    // Straight on to the first new clip
    window.setTimeout(() => containerRef.current?.querySelector(`article[data-idx="${from}"]`)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }), 60);
  };

  // On a keyboard: up and down (or j and k) move between clips, m turns the sound on or off, k / space pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const el = containerRef.current; if (!el) return;
      const step = (d: number) => { e.preventDefault(); el.scrollBy({ top: d * el.clientHeight, behavior: 'smooth' }); };
      if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'PageDown') step(1);
      else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'PageUp') step(-1);
      else if (e.key === 'm') setMuted(m => !m);
      else if (e.key === ' ' && !(t && /^(BUTTON|A)$/.test(t.tagName))) { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The first time: a quiet cue on the first clip showing how to move on, gone after the first swipe
  const [swipeCue, setSwipeCue] = useState(() => { try { return !localStorage.getItem('ng_hint_moments_swipe'); } catch { return false; } });
  const [cueReady, setCueReady] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setCueReady(true), 1800); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (swipeCue && activeIdx > 0) { setSwipeCue(false); try { localStorage.setItem('ng_hint_moments_swipe', '1'); } catch { /* storage blocked */ } }
  }, [activeIdx, swipeCue]);
  const touch = useMemo(() => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return true; } }, []);

  const watchAgain = () => {
    track('moments_watch_again', { clips: visible.length });
    containerRef.current?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };

  const report = (p: CommunityPost) => {
    if (!isMember) { onRequireAccount('Create a free account to report content.'); return; }
    setReporting({ kind: 'post', postId: p.id, userId: p.userId });
  };

  const programmeCount = programme.length;
  const countWord = programmeCount <= 7 ? ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'][programmeCount] : String(programmeCount);
  const firstEnd = extra === 0;

  return (
    <div className="fixed inset-0 z-[45] bg-black text-white">
      <header className="absolute top-0 inset-x-0 z-20 flex items-start justify-between px-4 md:px-8 lg:pl-28 land:pl-24 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-8 bg-gradient-to-b from-black/40 to-transparent">
        {/* Moments is where explorers arrive; the bottom bar is the way on, so there is no back arrow */}
        <h1 className="font-display italic text-xl text-white/90 pt-2.5">Moments</h1>
        <div className="flex items-start gap-0.5 -mr-2">
          {onOpenActivity && (
            <button onClick={onOpenActivity} aria-label={unreadActivity ? `Activity, ${unreadActivity} new` : 'Activity'} className={HEADER_ACTION}>
              <span className="relative"><Glyph name="ripples" size={22} />
              {unreadActivity > 0 && <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-theme-vivid ring-2 ring-black/60" aria-hidden="true" />}</span>
              <span className={HEADER_LABEL} aria-hidden="true">Activity</span>
            </button>
          )}
          {onOpenExplore && (
            <button onClick={onOpenExplore} aria-label="Explore" className={HEADER_ACTION}>
              <Glyph name="leafCompass" size={22} />
              <span className={HEADER_LABEL} aria-hidden="true">Explore</span>
            </button>
          )}
          {onOpenMessages && (
            <button onClick={onOpenMessages} aria-label={unreadMessages ? `Letters, ${unreadMessages} unread` : 'Letters'} className={HEADER_ACTION}>
              <span className="relative"><Glyph name="sealed" size={22} />
              {unreadMessages > 0 && <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-theme-vivid ring-2 ring-black/60" aria-hidden="true" />}</span>
              <span className={HEADER_LABEL} aria-hidden="true">Letters</span>
            </button>
          )}
          <button onClick={() => setMuted(m => !m)} aria-label={muted ? 'Turn sound on' : 'Turn sound off'} aria-pressed={!muted} className={HEADER_ACTION}>
            <Glyph name={muted ? 'soundOff' : 'soundOn'} size={22} />
            <span className={HEADER_LABEL} aria-hidden="true">{muted ? 'Sound off' : 'Sound on'}</span>
          </button>
        </div>
      </header>

      {loading ? (
        <div className="h-full flex flex-col items-center justify-center gap-3" role="status">
          <Glyph name="dawn" size={40} strokeWidth={1.2} className="text-white/60" />
          <span className="font-display italic text-lg text-white/80">Waiting quietly…</span>
        </div>
      ) : error && items.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center"><p className="ng-dark-title text-[20px]">Moments didn't load.</p><p className="ng-dark-caption -mt-2">Check your connection and try again.</p><button onClick={() => { setError(false); setLoading(true); loadMore(16); }} className="ng-button-light mt-4">Try again</button></div>
      ) : items.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
          <Glyph name="video" size={40} strokeWidth={1.2} className="text-white/50 mb-2" />
          <p className="ng-dark-title text-[20px]">No moments captured yet</p>
          <p className="ng-dark-caption max-w-xs">Hold the shutter in the Lens to capture one.</p>
        </div>
      ) : (
        <div ref={containerRef} className="h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar overscroll-contain" role="feed" aria-busy={fetching} aria-label={extra ? 'Moments' : `${evening ? "Tonight's" : "Today's"} moments: ${countWord} clips`}>
          {visible.map((p, idx) => {
            const isLiked = !!liked[p.id] || !!p.likes?.includes(currentUserMode.userId || '');
            const src = videoUrls[p.id];
            const near = Math.abs(idx - activeIdx) <= 2;
            const isActive = idx === activeIdx;
            const species = namesOf(p).common || p.title || 'Unnamed sighting';
            const rawPlace = p.showLocation !== false && p.locationArea ? String(p.locationArea).split(',')[0].trim() : '';
            const place = rawPlace && !PLACEHOLDER_PLACE.test(rawPlace) ? rawPlace : '';
            const n = likeTotal(p);
            const line = firstSentence(observedBehaviour(p.behavior) || p.caption || '');
            const by = explorerName(p.userName);
            const descId = `moment-desc-${p.id}`;
            return (
              <article
                key={p.id}
                data-idx={idx}
                // Clips out of view stay out of the way of Tab and screen readers
                inert={!isActive || undefined}
                aria-setsize={-1}
                aria-posinset={idx + 1}
                aria-describedby={descId}
                className="relative h-[100dvh] w-full snap-start snap-always flex items-center justify-center bg-black"
                aria-label={`${species} by ${by}`}
              >
                <div className="absolute inset-0 flex items-center justify-center" onClick={(e) => onTap(e, p)}>
                  {near && src ? (
                    <video data-idx={idx} src={src} poster={p.thumbnailUrl || undefined} muted={muted} loop playsInline preload={isActive ? 'auto' : isDataSaver() ? 'none' : 'metadata'} controlsList="nodownload" onContextMenu={e => e.preventDefault()} aria-describedby={descId} className="w-full h-full object-contain md:max-w-[min(100%,calc(100dvh*9/16))]" />
                  ) : p.thumbnailUrl ? (
                    <img src={p.thumbnailUrl} alt="" className="w-full h-full object-contain md:max-w-[min(100%,calc(100dvh*9/16))] opacity-80" />
                  ) : null}
                  {/* Paused (or waiting under reduced motion): a clear play button; a brief mark on each tap */}
                  {isActive && paused && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); togglePlay(); }} aria-label={`Play ${species}`} className="absolute z-10 w-20 h-20 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center text-white">
                      <Glyph name="play" size={34} filled />
                    </button>
                  )}
                  {isActive && !paused && flash?.kind === 'play' && (
                    <span key={flash.key} className="pointer-events-none absolute z-10 w-20 h-20 rounded-full bg-black/45 flex items-center justify-center animate-out fade-out duration-700 fill-mode-forwards motion-reduce:hidden" aria-hidden="true" onAnimationEnd={() => setFlash(null)}>
                      <Glyph name="play" size={34} filled />
                    </span>
                  )}
                  {idx === 0 && swipeCue && cueReady && visible.length > 1 && (
                    <div role="note" className="pointer-events-none absolute inset-x-0 top-[24%] land:top-[20%] z-10 flex flex-col items-center gap-2 text-white ng-rise">
                      <Glyph name="chevronUp" size={28} className="motion-safe:animate-bounce drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]" />
                      <span className="rounded-full bg-black/50 backdrop-blur-md px-4 py-2 text-sm text-white/95 whitespace-nowrap">
                        {touch ? 'Swipe up for the next moment' : 'Scroll or press ↓ for the next moment'}
                      </span>
                    </div>
                  )}
                  {burst?.id === p.id && <WonderBurst key={burst.key} x={burst.x} y={burst.y} count={18} />}
                </div>
                {/* A soft shade where the words sit, instead of shadows on the letters */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 ng-scrim-bottom" aria-hidden="true" />

                {/* The species and one brief line (also the clip's description); tapping it opens the sighting */}
                <button
                  type="button"
                  onClick={() => onOpenPost(p.id)}
                  aria-label={`${species}. ${line} Open the sighting`}
                  className="absolute left-6 right-20 md:right-auto md:left-[calc(50%_-_min(50%_-_4.5rem,_100dvh*9/32)_+_0.75rem)] md:max-w-[calc(2_*_min(50%_-_4.5rem,_100dvh*9/32)_-_1.5rem)] bottom-[calc(env(safe-area-inset-bottom)+6rem)] lg:bottom-12 land:bottom-4 z-10 text-left text-white"
                >
                  <span className="flex items-center gap-3 text-sm text-white/80 mb-2"><span className="block w-8 h-px bg-theme-vivid" aria-hidden="true" />{place || by}</span>
                  <span id={descId} className="block">
                    <span className="block ng-dark-title truncate">{species}</span>
                    {line && <span className="block ng-dark-caption mt-1.5 line-clamp-2">{line}</span>}
                  </span>
                </button>

                {/* The actions sit beside the clip on wide screens, at the edge on phones */}
                <div className="absolute right-2 md:right-auto md:left-[calc(50%_+_min(50%_-_4.5rem,_100dvh*9/32)_+_0.75rem)] bottom-[calc(env(safe-area-inset-bottom)+6rem)] lg:bottom-12 land:bottom-4 land:gap-2 z-10 flex flex-col items-center gap-4">
                  <button onClick={() => marvel(p)} aria-pressed={isLiked} aria-label={hideCounts ? (isLiked ? 'You marvelled at this' : 'Marvel at this') : (isLiked ? `You marvelled at this. ${wonderLabel(n)}` : `Marvel at this. ${wonderLabel(n)}`)} className="flex flex-col items-center gap-0.5">
                    <span className={`w-12 h-12 flex items-center justify-center drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] transition-colors duration-300 ${isLiked ? 'text-theme-vivid' : 'text-white'}`}>
                      <WonderIcon active={isLiked} className="text-[26px]" />
                    </span>
                    <span className="text-xs text-white/90 tabular-nums">{!hideCounts && n > 0 ? n.toLocaleString() : 'Marvel'}</span>
                  </button>
                  <button onClick={() => onOpenPost(p.id)} aria-label={`${species} by ${by}: field notes${p.commentCount ? `, ${p.commentCount}` : ''}`} className="flex flex-col items-center gap-0.5">
                    <span className="w-12 h-12 flex items-center justify-center drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
                      <Glyph name="feather" size={24} />
                    </span>
                    <span className="text-xs text-white/90 tabular-nums">{p.commentCount ? p.commentCount : 'Notes'}</span>
                  </button>
                  <button onClick={() => setSharing(p)} aria-label={`Share ${species}`} className="flex flex-col items-center gap-0.5">
                    <span className="w-12 h-12 flex items-center justify-center drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
                      <Glyph name="share" size={24} />
                    </span>
                    <span className="text-xs text-white/90">Share</span>
                  </button>
                  {p.userId !== currentUserMode.userId && (
                    <button onClick={() => report(p)} aria-label={`Report ${species}`} className="flex flex-col items-center gap-0.5">
                      <span className="w-11 h-11 flex items-center justify-center drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] text-white/85">
                        <Glyph name="flag" size={20} />
                      </span>
                      <span className="text-[11px] text-white/80">Report</span>
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          {extra > 0 && rest.length < extra && (fetching || error) && (
            <div className="h-24 flex items-center justify-center text-white/70 text-base font-display italic" role="status">
              {error
                ? <button onClick={() => { setError(false); loadMore(); }} className="ng-link-light min-h-[44px]">More moments didn't load. Try again</button>
                : 'More moments coming…'}
            </div>
          )}
          {showEndCard && (
            // The end is a resting place: nothing here leads into an endless feed
            <article data-idx={visible.length} inert={!onEndCard || undefined} className="relative h-[100dvh] w-full snap-start snap-always flex flex-col items-center justify-center text-center px-8 bg-black" aria-label={firstEnd ? `The end of ${when}'s moments` : 'A resting place'}>
              <Glyph name={moment.icon} size={40} strokeWidth={1.2} className="text-white/50" />
              {firstEnd
                ? <p className="font-display italic text-[28px] md:text-[40px] leading-[1.15] mt-6 max-w-md text-balance">That's {when}'s moments.<br />Go and listen outside.</p>
                : <p className="font-display italic text-[28px] md:text-[40px] leading-[1.15] mt-6 max-w-md text-balance">{moreToWatch ? 'A good place to pause.' : "That's every moment for now."}<br />The real ones are outside.</p>}
              <p className="ng-dark-caption mt-4 max-w-xs">{moment.name}: {moment.hint}.</p>
              <div className="mt-10 flex flex-col sm:flex-row items-center gap-x-6 gap-y-4">
                <button onClick={watchAgain} className="ng-button-light">Watch again</button>
                {moreToWatch && (
                  <button onClick={keepWatching} className="ng-link-light min-h-[44px]">Keep watching</button>
                )}
              </div>
            </article>
          )}
        </div>
      )}

      {sharing && (
        <React.Suspense fallback={null}>
          <ShareSheet
            post={sharing}
            onClose={() => setSharing(null)}
            surface="moments"
            onSendLetter={onSendAsLetter && isMember ? (post) => onSendAsLetter(post.id) : undefined}
          />
        </React.Suspense>
      )}
      {reporting && <ReportSheet target={reporting} what="this moment" onClose={() => setReporting(null)} surface="moments" />}
    </div>
  );
};

export default Reels;
