import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { CommunityPost, UserMode } from '../types';
import { likeTotal } from '../utils';
import { track } from '../services/analytics';
import AiBadge from './AiBadge';
import { resolvePlayableVideo } from './PlayableVideo';

interface Props {
  currentUserMode: UserMode;
  onOpenPost: (postId: string) => void;
  onViewProfile: (uid: string) => void;
  onRequireAccount: (reason: string, then?: () => void) => void;
  onBack: () => void;
}

/** Full-screen vertical video feed (snap scrolling, autoplay in view, tap to unmute, double-tap like). */
const Reels: React.FC<Props> = ({ currentUserMode, onOpenPost, onViewProfile, onRequireAccount, onBack }) => {
  const [items, setItems] = useState<CommunityPost[]>([]);
  const [cursor, setCursor] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [heart, setHeart] = useState<string | null>(null);
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

  // Resolve the playable URL for the active reel and its neighbours (thumbnails omit video URLs)
  useEffect(() => {
    [activeIdx, activeIdx + 1, activeIdx + 2].forEach(i => {
      const p = items[i];
      if (!p || videoUrls[p.id]) return;
      FirebaseService.getFullPost(p.id).then(full => {
        resolvePlayableVideo(full?.items?.[0]?.videoUrl || full?.videoUrl).then(url => {
          if (url) setVideoUrls(prev => ({ ...prev, [p.id]: url }));
        });
      });
    });
    if (activeIdx >= items.length - 3 && hasMore) loadMore();
  }, [activeIdx, items, hasMore, loadMore, videoUrls]);

  // Track which reel is in view
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting && e.intersectionRatio > 0.6) setActiveIdx(Number((e.target as HTMLElement).dataset.idx)); });
    }, { root, threshold: [0.6] });
    root.querySelectorAll('[data-idx]').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [items.length]);

  // Play only the active video
  useEffect(() => {
    containerRef.current?.querySelectorAll('video').forEach(v => {
      const idx = Number(v.dataset.idx);
      if (idx === activeIdx) v.play().catch(() => {}); else { v.pause(); }
    });
  }, [activeIdx, videoUrls]);

  const like = async (p: CommunityPost) => {
    if (!isMember) { onRequireAccount('Create a free account to like reels.'); return; }
    const uid = currentUserMode.userId!;
    const legacy = !!p.likes?.includes(uid);
    const isLiked = legacy || !!liked[p.id];
    setLiked(prev => ({ ...prev, [p.id]: !isLiked }));
    setItems(prev => prev.map(x => x.id !== p.id ? x : (isLiked && legacy ? { ...x, likes: (x.likes || []).filter(u => u !== uid) } : { ...x, likeCount: Math.max(0, (x.likeCount || 0) + (isLiked ? -1 : 1)) })));
    try { await FirebaseService.toggleLike(p.id, uid, isLiked, legacy); track(isLiked ? 'unlike' : 'like', { media: 'video', surface: 'reels' }); }
    catch { setLiked(prev => ({ ...prev, [p.id]: isLiked })); }
  };

  const onTap = (p: CommunityPost) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      setHeart(p.id); setTimeout(() => setHeart(null), 900);
      const isLiked = !!liked[p.id] || !!p.likes?.includes(currentUserMode.userId || '');
      if (!isLiked) like(p);
      lastTapRef.current = 0;
      return;
    }
    lastTapRef.current = now;
    window.setTimeout(() => { if (lastTapRef.current === now) setMuted(m => !m); }, 310);
  };

  return (
    <div className="fixed inset-0 z-[45] bg-black text-white">
      <header className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-2 lg:pl-24 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 bg-gradient-to-b from-black/60 to-transparent">
        <button onClick={onBack} aria-label="Back to feed" className="w-11 h-11 rounded-full flex items-center justify-center"><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
        <h1 className="text-lg font-bold">Reels</h1>
        <button onClick={() => setMuted(m => !m)} aria-label={muted ? 'Unmute' : 'Mute'} className="w-11 h-11 rounded-full flex items-center justify-center"><span className="material-symbols-outlined" aria-hidden="true">{muted ? 'volume_off' : 'volume_up'}</span></button>
      </header>

      {loading ? (
        <div className="h-full flex items-center justify-center" role="status"><span className="material-symbols-outlined animate-spin text-4xl" aria-hidden="true">progress_activity</span><span className="sr-only">Loading reels</span></div>
      ) : error ? (
        <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center"><p>Reels didn't load.</p><button onClick={() => { setError(false); setLoading(true); loadMore(); }} className="px-6 py-3 rounded-full bg-white text-black font-bold">Try again</button></div>
      ) : items.length === 0 ? (
        <div className="h-full flex items-center justify-center p-8 text-center text-white/80">No video sightings yet. Hold the shutter in the lens to record one.</div>
      ) : (
        <div ref={containerRef} className="h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar overscroll-contain" role="feed" aria-busy={loading}>
          {items.map((p, idx) => {
            const isLiked = !!liked[p.id] || !!p.likes?.includes(currentUserMode.userId || '');
            const src = videoUrls[p.id];
            const near = Math.abs(idx - activeIdx) <= 2;
            return (
              <article key={p.id} data-idx={idx} className="relative h-[100dvh] w-full snap-start snap-always flex items-center justify-center bg-black" aria-label={`${p.labels?.[0] || 'Video sighting'} by ${p.userName}`}>
                <div className="absolute inset-0 flex items-center justify-center" onClick={() => onTap(p)}>
                  {near && src ? (
                    <video data-idx={idx} src={src} poster={p.thumbnailUrl} muted={muted} loop playsInline preload={idx === activeIdx ? 'auto' : 'metadata'} controlsList="nodownload" onContextMenu={e => e.preventDefault()} className="w-full h-full object-contain md:max-w-[min(100%,calc(100dvh*9/16))]" />
                  ) : p.thumbnailUrl ? (
                    <img src={p.thumbnailUrl} alt="" className="w-full h-full object-contain md:max-w-[min(100%,calc(100dvh*9/16))] opacity-80" />
                  ) : null}
                  {heart === p.id && <span className="absolute material-symbols-outlined text-[120px] animate-heart-burst" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">favorite</span>}
                </div>

                <div className="absolute right-2 lg:right-6 bottom-[calc(env(safe-area-inset-bottom)+6rem)] lg:bottom-12 z-10 flex flex-col items-center gap-5">
                  <button onClick={() => like(p)} aria-pressed={isLiked} aria-label={isLiked ? 'Unlike' : 'Like'} className="flex flex-col items-center">
                    <span className={`material-symbols-outlined text-[34px] drop-shadow ${isLiked ? 'text-red-500' : ''}`} style={isLiked ? { fontVariationSettings: "'FILL' 1" } : undefined} aria-hidden="true">favorite</span>
                    <span className="text-xs font-semibold tabular">{likeTotal(p)}</span>
                  </button>
                  <button onClick={() => onOpenPost(p.id)} aria-label="Comments" className="flex flex-col items-center">
                    <span className="material-symbols-outlined text-[32px] drop-shadow" aria-hidden="true">chat_bubble</span>
                    <span className="text-xs font-semibold tabular">{p.commentCount || 0}</span>
                  </button>
                  <button onClick={async () => {
                    const url = `${window.location.origin}/post/${p.id}`;
                    try { if (navigator.share) await navigator.share({ title: p.labels?.[0] || 'NatureGram reel', url }); else await navigator.clipboard.writeText(url); track('share', { surface: 'reels' }); } catch { /* cancelled */ }
                  }} aria-label="Share" className="flex flex-col items-center">
                    <span className="material-symbols-outlined text-[32px] drop-shadow" aria-hidden="true">send</span>
                  </button>
                </div>

                <div className="absolute left-0 right-16 bottom-0 z-10 p-4 lg:pl-28 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] bg-gradient-to-t from-black/70 to-transparent">
                  <button onClick={() => onViewProfile(p.userId)} className="font-bold text-[15px] drop-shadow py-1.5 pr-2 min-h-[36px]">{p.userName}</button>
                  <p className="text-[15px] font-semibold mt-1 drop-shadow">{p.labels?.[0] || 'Video sighting'}{p.locationArea ? <span className="font-normal text-white/80"> · {p.locationArea}</span> : null}</p>
                  {(p.caption || p.behavior) && <p className="text-sm text-white/90 mt-1 line-clamp-2">{p.caption || p.behavior}</p>}
                  <div className="mt-2 [&_*]:!text-[11px]"><AiBadge confidence={p.aiConfidence} compact /></div>
                </div>
              </article>
            );
          })}
          {hasMore && <div className="h-24 flex items-center justify-center text-white/60 text-sm">Loading more…</div>}
        </div>
      )}
    </div>
  );
};

export default Reels;
