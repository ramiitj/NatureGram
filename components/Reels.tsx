import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { CommunityPost, UserMode } from '../types';
import { likeTotal } from '../utils';
import { track } from '../services/analytics';
import AiBadge from './AiBadge';
import { resolvePlayableVideo } from './PlayableVideo';
import { WonderBurst, WonderIcon, wonderLabel, observedBehaviour } from './Wonder';

interface Props {
  currentUserMode: UserMode;
  onOpenPost: (postId: string) => void;
  onViewProfile: (uid: string) => void;
  onRequireAccount: (reason: string, then?: () => void) => void;
  onBack: () => void;
}

/**
 * One thing to watch for, drawn from the AI behaviour note: the first sentence that adds
 * something beyond the behaviour line already on screen. Not an essay.
 */
const watchForLine = (text?: string | null, behaviour?: string | null) => {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g)?.map(x => x.trim()) || [clean];
  const seen = (behaviour || '').toLowerCase().replace(/\W+/g, ' ').trim();
  const fresh = sentences.find(x => {
    const k = x.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 40);
    return x.length >= 20 && !(seen && (seen.includes(k) || k.includes(seen.slice(0, 40))));
  });
  if (!fresh) return '';
  return fresh.length > 220 ? fresh.slice(0, 217).trimEnd() + '…' : fresh;
};

/**
 * Moments: video sightings, one at a time, full screen. Built for watching closely rather than
 * scrolling past: after a moment settles on screen, a single line appears telling the explorer
 * what to watch for, drawn from the sighting's behaviour note.
 */
const Reels: React.FC<Props> = ({ currentUserMode, onOpenPost, onViewProfile, onRequireAccount, onBack }) => {
  const [items, setItems] = useState<CommunityPost[]>([]);
  const [cursor, setCursor] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});
  const [insights, setInsights] = useState<Record<string, string>>({});
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [burst, setBurst] = useState<{ id: string; x: number; y: number; key: number } | null>(null);
  const [settledIdx, setSettledIdx] = useState(-1);
  const lastTapRef = useRef(0);
  const isMember = !!currentUserMode.userId && currentUserMode.userId !== 'explorer_guest' && !currentUserMode.isAnonymous;

  const loadMore = useCallback(async () => {
    if (!hasMore) return;
    try {
      const { posts, lastVisible } = await FirebaseService.getVideoPosts(cursor);
      setItems(prev => { const ids = new Set(prev.map(p => p.id)); return [...prev, ...posts.filter(p => !ids.has(p.id))]; });
      setCursor(lastVisible);
      setHasMore(!!lastVisible);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [cursor, hasMore]);

  useEffect(() => { loadMore(); track('reels_open'); /* eslint-disable-next-line */ }, []);

  // Resolve the playable URL (and the behaviour note) for the active moment and its neighbours
  useEffect(() => {
    [activeIdx, activeIdx + 1, activeIdx + 2].forEach(i => {
      const p = items[i];
      if (!p || videoUrls[p.id]) return;
      FirebaseService.getFullPost(p.id).then(full => {
        const note = full?.items?.[0]?.aiInsight || full?.aiInsight;
        const line = watchForLine(note, full?.items?.[0]?.behavior || full?.behavior || p.behavior);
        if (line) setInsights(prev => ({ ...prev, [p.id]: line }));
        resolvePlayableVideo(full?.items?.[0]?.videoUrl || full?.videoUrl).then(url => {
          if (url) setVideoUrls(prev => ({ ...prev, [p.id]: url }));
        });
      });
    });
    if (activeIdx >= items.length - 3 && hasMore) loadMore();
  }, [activeIdx, items, hasMore, loadMore, videoUrls]);

  // Let a moment settle before offering something to watch for
  useEffect(() => {
    setSettledIdx(-1);
    const t = window.setTimeout(() => setSettledIdx(activeIdx), 2200);
    return () => window.clearTimeout(t);
  }, [activeIdx]);

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
  }, [items.length]);

  // Play only the active video
  useEffect(() => {
    containerRef.current?.querySelectorAll('video').forEach(v => {
      const idx = Number(v.dataset.idx);
      if (idx === activeIdx) v.play().catch(() => {}); else { v.pause(); }
    });
  }, [activeIdx, videoUrls]);

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

  return (
    <div className="fixed inset-0 z-[45] bg-black text-white">
      <header className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-2 lg:pl-24 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-6 bg-gradient-to-b from-black/60 to-transparent">
        <button onClick={onBack} aria-label="Back to the wild" className="w-11 h-11 rounded-full flex items-center justify-center"><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
        <div className="text-center">
          <h1 className="text-xl font-display italic font-bold leading-none">Moments</h1>
          <p className="text-[11px] text-white/70 mt-1">{muted ? 'Tap to hear the wild' : 'Listening'}</p>
        </div>
        <button onClick={() => setMuted(m => !m)} aria-label={muted ? 'Turn sound on' : 'Turn sound off'} className="w-11 h-11 rounded-full flex items-center justify-center"><span className="material-symbols-outlined" aria-hidden="true">{muted ? 'volume_off' : 'graphic_eq'}</span></button>
      </header>

      {loading ? (
        <div className="h-full flex flex-col items-center justify-center gap-3" role="status">
          <span className="material-symbols-outlined text-4xl text-white/70 animate-pulse" style={{ fontVariationSettings: "'wght' 200" }} aria-hidden="true">wb_twilight</span>
          <span className="font-display italic text-white/80">Waiting quietly…</span>
        </div>
      ) : error ? (
        <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center"><p className="font-display italic text-lg">Moments didn't load.</p><p className="text-sm text-white/70 -mt-2">Check your connection and try again.</p><button onClick={() => { setError(false); setLoading(true); loadMore(); }} className="px-6 py-3 rounded-full bg-white text-black font-bold">Try again</button></div>
      ) : items.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
          <span className="material-symbols-outlined text-4xl text-white/60" style={{ fontVariationSettings: "'wght' 200" }} aria-hidden="true">videocam</span>
          <p className="font-display italic text-xl">No moments recorded yet</p>
          <p className="text-white/75 max-w-xs">A bird bathing, a spider building, a frog calling. Hold the shutter in the lens to capture what happens next.</p>
        </div>
      ) : (
        <div ref={containerRef} className="h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar overscroll-contain" role="feed" aria-busy={loading}>
          {items.map((p, idx) => {
            const isLiked = !!liked[p.id] || !!p.likes?.includes(currentUserMode.userId || '');
            const src = videoUrls[p.id];
            const near = Math.abs(idx - activeIdx) <= 2;
            const watchFor = insights[p.id];
            const species = p.labels?.[0] || p.title || 'Unnamed sighting';
            const n = likeTotal(p);
            return (
              <article key={p.id} data-idx={idx} className="relative h-[100dvh] w-full snap-start snap-always flex items-center justify-center bg-black" aria-label={`${species} by ${p.userName}`}>
                <div className="absolute inset-0 flex items-center justify-center" onClick={(e) => onTap(e, p)}>
                  {near && src ? (
                    <video data-idx={idx} src={src} poster={p.thumbnailUrl || undefined} muted={muted} loop playsInline preload={idx === activeIdx ? 'auto' : 'metadata'} controlsList="nodownload" onContextMenu={e => e.preventDefault()} className="w-full h-full object-contain md:max-w-[min(100%,calc(100dvh*9/16))]" />
                  ) : p.thumbnailUrl ? (
                    <img src={p.thumbnailUrl} alt="" className="w-full h-full object-contain md:max-w-[min(100%,calc(100dvh*9/16))] opacity-80" />
                  ) : null}
                  {burst?.id === p.id && <WonderBurst key={burst.key} x={burst.x} y={burst.y} count={18} />}
                </div>

                <div className="absolute right-2 lg:right-6 bottom-[calc(env(safe-area-inset-bottom)+6rem)] lg:bottom-12 z-10 flex flex-col items-center gap-5">
                  <button onClick={() => marvel(p)} aria-pressed={isLiked} aria-label={isLiked ? `You marvelled at this. ${wonderLabel(n)}` : `Marvel at this. ${wonderLabel(n)}`} className="flex flex-col items-center gap-0.5">
                    <span className={`w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-md transition-colors duration-300 ${isLiked ? 'bg-theme-vivid/90 text-white shadow-lg shadow-theme-vivid/40' : 'bg-white/10'}`}>
                      <WonderIcon active={isLiked} className="text-[28px] drop-shadow" />
                    </span>
                    {n > 0 && <span className="text-xs font-semibold tabular drop-shadow">{n}</span>}
                  </button>
                  <button onClick={() => onOpenPost(p.id)} aria-label={`Field notes${p.commentCount ? `, ${p.commentCount}` : ''}`} className="flex flex-col items-center gap-0.5">
                    <span className="w-12 h-12 rounded-full flex items-center justify-center bg-white/10 backdrop-blur-md">
                      <span className="material-symbols-outlined text-[26px] drop-shadow" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">history_edu</span>
                    </span>
                    {!!p.commentCount && <span className="text-xs font-semibold tabular drop-shadow">{p.commentCount}</span>}
                  </button>
                  <button onClick={async () => {
                    const url = `${window.location.origin}/post/${p.id}`;
                    try { if (navigator.share) await navigator.share({ title: `${species} on NatureGram`, url }); else await navigator.clipboard.writeText(url); track('share', { surface: 'moments' }); } catch { /* cancelled */ }
                  }} aria-label="Share this moment" className="w-12 h-12 rounded-full flex items-center justify-center bg-white/10 backdrop-blur-md">
                    <span className="material-symbols-outlined text-[24px] drop-shadow" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">share</span>
                  </button>
                </div>

                <div className="absolute left-0 right-16 bottom-0 z-10 p-4 lg:pl-28 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                  <h2 className="text-2xl font-display italic font-bold leading-tight drop-shadow">{species}</h2>
                  {observedBehaviour(p.behavior) && <p className="text-[15px] text-white/90 mt-1 leading-snug drop-shadow line-clamp-2">{observedBehaviour(p.behavior)}</p>}

                  {watchFor && (
                    <button
                      onClick={() => onOpenPost(p.id)}
                      className={`mt-3 max-w-md text-left rounded-xl bg-white/10 backdrop-blur-md border border-white/15 px-3.5 py-2.5 transition-all duration-700 ${settledIdx === idx ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}
                      aria-hidden={settledIdx !== idx}
                      tabIndex={settledIdx === idx ? 0 : -1}
                    >
                      <span className="block text-[12px] font-display italic text-theme-vivid brightness-150 mb-0.5">Watch for this</span>
                      <span className="block text-sm text-white/95 leading-snug">{watchFor}</span>
                    </button>
                  )}

                  <div className="mt-3 flex items-center gap-2 text-[13px] text-white/80 flex-wrap">
                    <button onClick={() => onViewProfile(p.userId)} className="font-semibold text-white py-1.5 min-h-[36px] hover:underline">{p.userName}</button>
                    {p.locationArea && <span className="flex items-center gap-0.5"><span className="material-symbols-outlined text-[15px]" aria-hidden="true">location_on</span>{p.locationArea}</span>}
                  </div>
                  <div className="mt-1 [&_*]:!text-[11px]"><AiBadge confidence={p.aiConfidence} compact /></div>
                </div>
              </article>
            );
          })}
          {hasMore && <div className="h-24 flex items-center justify-center text-white/60 text-sm font-display italic">More moments coming…</div>}
        </div>
      )}
    </div>
  );
};

export default Reels;
