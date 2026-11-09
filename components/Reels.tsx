import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { CommunityPost, UserMode } from '../types';
import { likeTotal, isDataSaver } from '../utils';
import { track } from '../services/analytics';
import { resolvePlayableVideo } from './PlayableVideo';
import { WonderBurst, WonderIcon, wonderLabel } from './Wonder';

interface Props {
  currentUserMode: UserMode;
  onOpenPost: (postId: string) => void;
  onViewProfile: (uid: string) => void;
  onRequireAccount: (reason: string, then?: () => void) => void;
  onBack: () => void;
}

/**
 * Moments: video sightings, one at a time, full screen, with nothing written over the video.
 * The name, notes and explorer are one tap away in the sighting's field notes.
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
  const [toast, setToast] = useState('');
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [burst, setBurst] = useState<{ id: string; x: number; y: number; key: number } | null>(null);
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

  // Resolve the playable URL for the active moment and its neighbours
  useEffect(() => {
    // On slow connections, fetch only the moment on screen
    (isDataSaver() ? [activeIdx] : [activeIdx, activeIdx + 1, activeIdx + 2]).forEach(i => {
      const p = items[i];
      if (!p || videoUrls[p.id]) return;
      const direct = (p as any).videoUrl as string | undefined;
      (direct ? Promise.resolve({ videoUrl: direct } as any) : FirebaseService.getFullPost(p.id)).then((full: any) => {
        resolvePlayableVideo(full?.items?.[0]?.videoUrl || full?.videoUrl).then(url => {
          if (url) setVideoUrls(prev => ({ ...prev, [p.id]: url }));
        });
      });
    });
    if (activeIdx >= items.length - 3 && hasMore) loadMore();
  }, [activeIdx, items, hasMore, loadMore, videoUrls]);

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
      ) : error ? (
        <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center"><p className="font-display text-lg">Moments didn't load.</p><p className="text-sm text-white/70 -mt-2">Check your connection and try again.</p><button onClick={() => { setError(false); setLoading(true); loadMore(); }} className="px-6 py-3 rounded-full bg-white text-black font-bold">Try again</button></div>
      ) : items.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
          <span className="material-symbols-outlined text-4xl text-white/60" style={{ fontVariationSettings: "'wght' 200" }} aria-hidden="true">videocam</span>
          <p className="font-display text-xl">No moments recorded yet</p>
          <p className="text-white/75 max-w-xs">Hold the shutter in the Lens to record one.</p>
        </div>
      ) : (
        <div ref={containerRef} className="h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar overscroll-contain" role="feed" aria-busy={loading}>
          {items.map((p, idx) => {
            const isLiked = !!liked[p.id] || !!p.likes?.includes(currentUserMode.userId || '');
            const src = videoUrls[p.id];
            const near = Math.abs(idx - activeIdx) <= 2;
            const species = p.labels?.[0] || p.title || 'Unnamed sighting';
            const n = likeTotal(p);
            return (
              <article key={p.id} data-idx={idx} className="relative h-[100dvh] w-full snap-start snap-always flex items-center justify-center bg-black" aria-label={`${species} by ${p.userName}`}>
                <div className="absolute inset-0 flex items-center justify-center" onClick={(e) => onTap(e, p)}>
                  {near && src ? (
                    <video data-idx={idx} src={src} poster={p.thumbnailUrl || undefined} muted={muted} loop playsInline preload={idx === activeIdx ? 'auto' : isDataSaver() ? 'none' : 'metadata'} controlsList="nodownload" onContextMenu={e => e.preventDefault()} className="w-full h-full object-contain md:max-w-[min(100%,calc(100dvh*9/16))]" />
                  ) : p.thumbnailUrl ? (
                    <img src={p.thumbnailUrl} alt="" className="w-full h-full object-contain md:max-w-[min(100%,calc(100dvh*9/16))] opacity-80" />
                  ) : null}
                  {burst?.id === p.id && <WonderBurst key={burst.key} x={burst.x} y={burst.y} count={18} />}
                </div>

                <div className="absolute right-2 lg:right-6 bottom-[calc(env(safe-area-inset-bottom)+6rem)] lg:bottom-12 land:bottom-4 land:gap-3 z-10 flex flex-col items-center gap-5">
                  <button onClick={() => marvel(p)} aria-pressed={isLiked} aria-label={isLiked ? `You marvelled at this. ${wonderLabel(n)}` : `Marvel at this. ${wonderLabel(n)}`} className="flex flex-col items-center gap-0.5">
                    <span className={`w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-md transition-colors duration-300 ${isLiked ? 'bg-theme-vivid/90 text-white shadow-lg shadow-theme-vivid/40' : 'bg-white/10'}`}>
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
          {hasMore && <div className="h-24 flex items-center justify-center text-white/60 text-sm font-display">More moments coming…</div>}
        </div>
      )}
    </div>
  );
};

export default Reels;
