import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { CommunityPost, UserMode } from '../types';
import { likeTotal, isDataSaver, timeAgo } from '../utils';
import { track } from '../services/analytics';
import { resolvePlayableVideo } from './PlayableVideo';
import { WonderBurst, WonderIcon, wonderLabel, fieldMoment, observedBehaviour } from './Wonder';
import { groupOf } from '../services/lifeList';

interface Props {
  currentUserMode: UserMode;
  onOpenPost: (postId: string) => void;
  onViewProfile: (uid: string) => void;
  onRequireAccount: (reason: string, then?: () => void) => void;
  onBack: () => void;
}

const PROGRAMME_MAX = 7;
const TITLE_MS = 2600;

/** What tends to be happening at this hour, as words to look for in a clip's labels. */
const HOUR_MATCH: Record<string, RegExp> = {
  'Dawn chorus': /(bird|song|call|chorus|robin|thrush|warbler|wren|bulbul|magpie|blackbird)/i,
  'Morning': /(butterfl|moth|bee\b|insect|dragonfl|flower|pollinat)/i,
  'Midday': /(raptor|hawk|eagle|kite|vulture|buzzard|falcon|kestrel|lizard|thermal)/i,
  'Afternoon': /(bird|feed|forag|squirrel|deer|monkey)/i,
  'Dusk': /(bat\b|bats\b|dusk|swift|nightjar|deer|fox)/i,
  'Night': /(owl|frog|toad|moth|cricket|night|bat\b|bats\b|firefl)/i,
};

const ordinalWord = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'];

/**
 * Moments, as an evening screening: a short programme of video sightings, each introduced by a quiet
 * title card (the species, the place, one line), and a natural end. Clips that suit the hour come first.
 * "Keep watching" opens the full reel, so nothing that was possible before is lost.
 */
const Reels: React.FC<Props> = ({ currentUserMode, onOpenPost, onRequireAccount, onBack }) => {
  const [items, setItems] = useState<CommunityPost[]>([]);
  const [cursor, setCursor] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});
  const [toast, setToast] = useState('');
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [burst, setBurst] = useState<{ id: string; x: number; y: number; key: number } | null>(null);
  const [extended, setExtended] = useState(false);
  const [titleShown, setTitleShown] = useState<Record<string, boolean>>({});
  const [titleFor, setTitleFor] = useState<string | null>(null);
  const lastTapRef = useRef(0);
  const isMember = !!currentUserMode.userId && currentUserMode.userId !== 'explorer_guest' && !currentUserMode.isAnonymous;
  const moment = useMemo(() => fieldMoment(), []);

  const loadMore = useCallback(async (pageSize?: number) => {
    if (!hasMore) return;
    try {
      const { posts, lastVisible } = await FirebaseService.getVideoPosts(cursor, pageSize);
      setItems(prev => { const ids = new Set(prev.map(p => p.id)); return [...prev, ...posts.filter(p => !ids.has(p.id))]; });
      setCursor(lastVisible);
      setHasMore(!!lastVisible);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [cursor, hasMore]);

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
  // While the programme plays, its order is fixed; after "Keep watching" the rest follows in date order
  const visible = useMemo(() => extended ? [...programme, ...items.filter(p => !programmeIds.has(p.id))] : programme, [extended, programme, items, programmeIds]);
  const showEndCard = !extended && !loading && programme.length > 0;

  // Resolve the playable URL for the active moment and its neighbours
  useEffect(() => {
    (isDataSaver() ? [activeIdx] : [activeIdx, activeIdx + 1, activeIdx + 2]).forEach(i => {
      const p = visible[i];
      if (!p || videoUrls[p.id]) return;
      const direct = (p as any).videoUrl as string | undefined;
      (direct ? Promise.resolve({ videoUrl: direct } as any) : FirebaseService.getFullPost(p.id)).then((full: any) => {
        resolvePlayableVideo(full?.items?.[0]?.videoUrl || full?.videoUrl).then(url => {
          if (url) setVideoUrls(prev => ({ ...prev, [p.id]: url }));
        });
      });
    });
    if (extended && activeIdx >= visible.length - 3 && hasMore) loadMore();
  }, [activeIdx, visible, hasMore, loadMore, videoUrls, extended]);

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

  // A quiet title card before each clip of the programme, once
  const active = visible[activeIdx];
  useEffect(() => {
    if (!active || titleShown[active.id] || !programmeIds.has(active.id)) { setTitleFor(null); return; }
    setTitleFor(active.id);
    setTitleShown(prev => ({ ...prev, [active.id]: true }));
    const t = window.setTimeout(() => setTitleFor(id => id === active.id ? null : id), TITLE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // Play only the active video, after its title card
  useEffect(() => {
    containerRef.current?.querySelectorAll('video').forEach(v => {
      const idx = Number(v.dataset.idx);
      if (idx === activeIdx && !titleFor) v.play().catch(() => {}); else { v.pause(); }
    });
  }, [activeIdx, videoUrls, titleFor]);

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

  const onTap = (e: React.MouseEvent<HTMLDivElement>, p: CommunityPost) => {
    if (titleFor === p.id) { setTitleFor(null); return; } // a tap skips the title card
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
    window.setTimeout(() => { if (lastTapRef.current === now) setMuted(m => !m); }, 310);
  };

  const keepWatching = () => {
    track('reels_keep_watching', { programme: programme.length });
    setExtended(true);
    if (hasMore && items.length <= programme.length) loadMore();
  };

  const watchAgain = () => {
    setTitleShown({});
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const programmeCount = programme.length;
  const countWord = programmeCount <= 7 ? ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'][programmeCount] : String(programmeCount);

  return (
    <div className="fixed inset-0 z-[45] bg-black text-white">
      <header className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-2 lg:pl-24 land:pl-20 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-6 bg-gradient-to-b from-black/30 to-transparent">
        <button onClick={onBack} aria-label="Back to the wild" className="w-11 h-11 rounded-full flex items-center justify-center"><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
        <h1 className="sr-only">Moments</h1>
        <button onClick={() => setMuted(m => !m)} aria-label={muted ? 'Turn sound on' : 'Turn sound off'} className="w-11 h-11 rounded-full flex items-center justify-center"><span className="material-symbols-outlined" aria-hidden="true">{muted ? 'volume_off' : 'graphic_eq'}</span></button>
      </header>

      {toast && <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom)+6rem)] z-30 px-4 py-2 rounded-full bg-white text-black text-sm font-semibold">{toast}</div>}
      {loading ? (
        <div className="h-full flex flex-col items-center justify-center gap-3" role="status">
          <span className="material-symbols-outlined text-4xl text-white/70 animate-pulse" style={{ fontVariationSettings: "'wght' 200" }} aria-hidden="true">wb_twilight</span>
          <span className="font-display text-white/80">Waiting quietly…</span>
        </div>
      ) : error && items.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center"><p className="font-display text-lg">Moments didn't load.</p><p className="text-sm text-white/70 -mt-2">Check your connection and try again.</p><button onClick={() => { setError(false); setLoading(true); loadMore(16); }} className="px-6 py-3 rounded-full bg-white text-black font-bold">Try again</button></div>
      ) : items.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
          <span className="material-symbols-outlined text-4xl text-white/60" style={{ fontVariationSettings: "'wght' 200" }} aria-hidden="true">videocam</span>
          <p className="font-display text-xl">No moments recorded yet</p>
          <p className="text-white/75 max-w-xs">Hold the shutter in the Lens to record one.</p>
        </div>
      ) : (
        <div ref={containerRef} className="h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar overscroll-contain" role="feed" aria-busy={loading} aria-label={extended ? 'Moments' : `Tonight's moments: ${countWord} clips`}>
          {visible.map((p, idx) => {
            const isLiked = !!liked[p.id] || !!p.likes?.includes(currentUserMode.userId || '');
            const src = videoUrls[p.id];
            const near = Math.abs(idx - activeIdx) <= 2;
            const species = p.labels?.[0] || p.title || 'Unnamed sighting';
            const n = likeTotal(p);
            const inProgramme = idx < programmeCount;
            const line = observedBehaviour(p.behavior) || (p.caption || '').split(/(?<=[.!?])\s/)[0] || (p.timestamp ? `Recorded ${timeAgo(p.timestamp)}.` : '');
            return (
              <article key={p.id} data-idx={idx} className="relative h-[100dvh] w-full snap-start snap-always flex items-center justify-center bg-black" aria-label={`${species} by ${p.userName}`}>
                <div className="absolute inset-0 flex items-center justify-center" onClick={(e) => onTap(e, p)}>
                  {near && src ? (
                    <video data-idx={idx} src={src} poster={p.thumbnailUrl || undefined} muted={muted} loop playsInline preload={idx === activeIdx ? 'auto' : isDataSaver() ? 'none' : 'metadata'} controlsList="nodownload" onContextMenu={e => e.preventDefault()} className="w-full h-full object-contain md:max-w-[min(100%,calc(100dvh*9/16))]" />
                  ) : p.thumbnailUrl ? (
                    <img src={p.thumbnailUrl} alt="" className="w-full h-full object-contain md:max-w-[min(100%,calc(100dvh*9/16))] opacity-80" />
                  ) : null}
                  {burst?.id === p.id && <WonderBurst key={burst.key} x={burst.x} y={burst.y} count={18} />}
                  {inProgramme && (
                    <div
                      className={`absolute inset-0 z-[5] bg-black flex flex-col items-center justify-center text-center px-10 transition-opacity duration-1000 ${titleFor === p.id ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                      aria-hidden={titleFor !== p.id}
                    >
                      <p className="text-xs text-white/50 font-display">{ordinalWord[idx] || `No. ${idx + 1}`} of {countWord}</p>
                      <p className="font-display italic text-3xl sm:text-4xl leading-tight mt-4">{species}</p>
                      {p.locationArea && p.showLocation !== false && <p className="text-sm text-white/70 mt-3">{p.locationArea}</p>}
                      {line && <p className="font-display text-white/80 text-base mt-5 max-w-sm leading-relaxed">{line}</p>}
                    </div>
                  )}
                </div>

                <div className={`absolute right-2 lg:right-6 bottom-[calc(env(safe-area-inset-bottom)+6rem)] lg:bottom-12 land:bottom-4 land:gap-3 z-10 flex flex-col items-center gap-5 transition-opacity duration-700 ${titleFor === p.id ? 'opacity-0' : 'opacity-100'}`}>
                  <button onClick={() => marvel(p)} aria-pressed={isLiked} aria-label={isLiked ? `You marvelled at this. ${wonderLabel(n)}` : `Marvel at this. ${wonderLabel(n)}`} className="flex flex-col items-center gap-0.5">
                    <span className={`w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-md transition-colors duration-300 ${isLiked ? 'bg-theme-primary text-white ring-2 ring-theme-vivid/70 shadow-lg shadow-theme-vivid/40' : 'bg-white/10'}`}>
                      <WonderIcon active={isLiked} className="text-[28px] drop-shadow" />
                    </span>
                  </button>
                  <button onClick={() => onOpenPost(p.id)} aria-label={`${species} by ${p.userName}: field notes${p.commentCount ? `, ${p.commentCount}` : ''}`} className="flex flex-col items-center gap-0.5">
                    <span className="w-12 h-12 rounded-full flex items-center justify-center bg-white/10 backdrop-blur-md">
                      <span className="material-symbols-outlined text-[26px] drop-shadow" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">history_edu</span>
                    </span>
                  </button>
                  <button onClick={async () => {
                    const url = `${window.location.origin}/post/${p.id}`;
                    try {
                      if (navigator.share) await navigator.share({ title: `${species} on NatureGram`, url });
                      else { await navigator.clipboard.writeText(url); setToast('Link copied'); window.setTimeout(() => setToast(''), 1800); }
                      track('share', { surface: 'moments' });
                    } catch { /* cancelled */ }
                  }} aria-label="Share this moment" className="w-12 h-12 rounded-full flex items-center justify-center bg-white/10 backdrop-blur-md">
                    <span className="material-symbols-outlined text-[24px] drop-shadow" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">share</span>
                  </button>
                </div>
              </article>
            );
          })}
          {showEndCard && (
            <article data-idx={visible.length} className="relative h-[100dvh] w-full snap-start snap-always flex flex-col items-center justify-center text-center px-8 bg-black" aria-label="The end of tonight's moments">
              <span className="material-symbols-outlined text-4xl text-white/50" style={{ fontVariationSettings: "'wght' 200" }} aria-hidden="true">{moment.icon}</span>
              <p className="font-display text-2xl sm:text-3xl leading-snug mt-5 max-w-sm">That's tonight's moments.<br />Go and listen outside.</p>
              <p className="text-sm text-white/60 mt-3 max-w-xs">{moment.name}: {moment.hint}.</p>
              <div className="mt-8 flex flex-col sm:flex-row items-center gap-3">
                <button onClick={onBack} className="px-6 py-3 rounded-full bg-white text-black font-semibold text-sm">Close for tonight</button>
                <button onClick={watchAgain} className="px-5 py-3 rounded-full text-white/80 hover:text-white text-sm font-semibold">Watch again</button>
                {(hasMore || items.length > programmeCount) && (
                  <button onClick={keepWatching} className="px-5 py-3 rounded-full border border-white/30 text-white text-sm font-semibold">Keep watching</button>
                )}
              </div>
            </article>
          )}
          {extended && hasMore && <div className="h-24 flex items-center justify-center text-white/60 text-sm font-display">More moments coming…</div>}
        </div>
      )}
    </div>
  );
};

export default Reels;
