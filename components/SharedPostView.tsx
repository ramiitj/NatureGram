import React, { useState, useEffect, useRef } from 'react';
import { PressingLoader } from './SkeletonPost';
import PlayableVideo, { PlayableAudio } from './PlayableVideo';
import { CommunityPost, UserMode } from '../types.ts';
import { FirebaseService } from '../services/firebaseService.ts';
import { observedBehaviour, insightBeyond } from './Wonder';
import { isFungiPost, FungiWarning } from './AiBadge';
import { getThemePeriod, getNaturalistExtra } from '../constants/naturalistExtras';
import { speciesOf, publicArea } from './ShareSheet';
import Glyph from './Glyph';

interface SharedPostViewProps {
  postId: string;
  onGoToApp: () => void;
  /** Opens the Lens directly; falls back to entering the app (which opens the Lens on a first visit). */
  onOpenLens?: () => void;
  userMode?: UserMode;
}

const SharedPostView: React.FC<SharedPostViewProps> = ({ postId, onGoToApp, onOpenLens, userMode }) => {
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeItemIndex, setActiveItemIndex] = useState(0);

  const mediaScrollRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);

  const handleMediaScroll = (e: React.UIEvent<HTMLDivElement>) => {
      if (isScrollingRef.current) return;
      const container = e.currentTarget;
      const scrollLeft = container.scrollLeft;
      const width = container.clientWidth;
      if (width > 0) {
          const index = Math.round(scrollLeft / width);
          if (index !== activeItemIndex && index >= 0 && index < (post?.items?.length || 0)) {
              setActiveItemIndex(index);
          }
      }
  };

  const scrollToItem = (index: number) => {
      if (mediaScrollRef.current) {
          isScrollingRef.current = true;
          const width = mediaScrollRef.current.clientWidth;
          mediaScrollRef.current.scrollTo({
              left: index * width,
              behavior: 'smooth'
          });
          setActiveItemIndex(index);
          setTimeout(() => {
              isScrollingRef.current = false;
          }, 400);
      }
  };

  useEffect(() => {
    if (mediaScrollRef.current) {
      mediaScrollRef.current.scrollLeft = 0;
    }
    setActiveItemIndex(0);
  }, [post]);

  useEffect(() => {
    FirebaseService.getPost(postId).then(fetched => {
        if (fetched) setPost(fetched);
        else setError(true);
        setLoading(false);
    }).catch(err => {
        console.error(err);
        setError(true);
        setLoading(false);
    });
  }, [postId]);

  const period = getThemePeriod();
  const naturalist = period.theme.naturalist;
  const extra = getNaturalistExtra(period.theme.id);

  if (loading) {
      return (
          <div className="flex-1 bg-day-bg flex flex-col items-center justify-center min-h-[100dvh] px-6 text-center" role="status" aria-live="polite">
              <PressingLoader size={40} />
              <p className="mt-4 font-display italic text-lg text-stone-600">Opening this sighting…</p>
          </div>
      );
  }

  if (error || !post) {
      return (
        <div className="flex-1 bg-day-bg flex flex-col items-center justify-center min-h-[100dvh] p-6 text-center">
            <Glyph name="leafCompass" size={40} strokeWidth={1.2} className="text-stone-400 mb-6" />
            <h1 className="ng-title italic mb-3 max-w-md">This sighting has gone back to the wild</h1>
            <p className="ng-body text-stone-600 mb-10 max-w-sm">The explorer may have removed it, or made it visible only to themselves. There is plenty more alive out there.</p>
            <button onClick={onOpenLens || onGoToApp} className="ng-button-primary group">
                Open the Lens<Glyph name="forward" size={20} className="ng-arrow transition-transform group-hover:translate-x-0.5" />
            </button>
            <button onClick={onGoToApp} className="mt-4 ng-link-quiet min-h-[44px]">See what others found</button>
        </div>
      );
  }

  const currentItem: any = post.items && post.items.length > 0 ? post.items[activeItemIndex] : post;

  const canDownload = userMode ? (post.userId === userMode.userId || userMode.type === 'admin') : false;
  const itemLabels: string[] = currentItem.labels || post.labels || [];
  const species = speciesOf({ ...post, labels: itemLabels });
  const hasSpecies = !!itemLabels[0] && species === itemLabels[0].trim();
  const scientific: string = (itemLabels[1] && /^[A-Z][a-z]+ [a-z]+/.test(itemLabels[1])) ? itemLabels[1] : (currentItem.aiIdentifications?.[0]?.scientificName || '');
  const alsoSeen = itemLabels.slice(1).filter(l => l !== scientific);
  const behaviour = observedBehaviour(currentItem.behavior ?? post.behavior);
  const insightRaw: string = currentItem.aiInsight || post.aiInsight || '';
  const beyond = insightRaw ? insightBeyond(insightRaw, behaviour) : [];
  const insight = beyond.length ? beyond : insightRaw.split(/\n+/).filter(Boolean);
  const area = publicArea({ ...post, locationArea: currentItem.locationArea || post.locationArea, showLocation: currentItem.showLocation ?? post.showLocation });
  const words = (post.caption || '').trim() || ((post.items?.length || 0) > 1 ? '' : (post.description || '').trim());
  const explorer = post.userName || 'An explorer';
  const ts: any = post.timestamp;
  const ms = ts?.toMillis ? ts.toMillis() : (typeof ts?.seconds === 'number' ? ts.seconds * 1000 : 0);
  const when = ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const tags = (post.tags || []).map((t: string) => String(t).replace(/^#+/, '')).filter(Boolean).slice(0, 6);
  const fungi = isFungiPost({ labels: itemLabels, tags: post.tags }) || !!post.aiFlags?.fungi;

  return (
      <div className="fixed inset-0 bg-day-bg flex flex-col md:flex-row overflow-hidden">
          <div className="absolute top-0 left-0 right-0 md:right-[400px] lg:right-[450px] px-6 pt-6 pb-8 md:px-12 md:pt-8 z-50 flex items-center bg-gradient-to-b from-black/50 to-transparent pointer-events-none safe-pt">
              <span className="flex items-center gap-2.5 text-white"><Glyph name="mark" size={22} /><span className="font-display italic text-xl md:text-2xl tracking-tight">NatureGram</span></span>
          </div>

          <div className="flex-1 relative bg-stone-950 flex flex-col justify-center min-h-[48dvh] md:min-h-screen group/media overflow-hidden">
              {post.items && post.items.length > 1 ? (
                  <>
                      <div
                          ref={mediaScrollRef}
                          onScroll={handleMediaScroll}
                          className="flex flex-row overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar w-full h-full relative"
                      >
                          {post.items.map((item, index) => (
                              <div key={index} className="w-full h-full shrink-0 snap-center flex items-center justify-center relative p-4 bg-transparent select-none">
                                  {item.mediaType === 'video' ? (
                                       <PlayableVideo
                                           src={item.videoUrl!}
                                           streamUrl={(item as any).streamUrl}
                                           preload="metadata"
                                           controls
                                           controlsList={!canDownload ? "nodownload" : undefined}
                                           onContextMenu={(e) => { if (!canDownload) e.preventDefault(); }}
                                           autoPlay={index === 0}
                                           className="max-w-full max-h-full object-contain rounded-md"
                                           style={{ transform: `rotate(${item.rotation || 0}deg)` }}
                                       />
                                  ) : item.mediaType === 'audio' ? (
                                       <div className="flex flex-col items-center justify-center w-[90%] md:w-auto p-8 rounded-md">
                                            <Glyph name="sound" size={44} strokeWidth={1.2} className="text-white/60 mb-10" />
                                            {item.audioUrl && (
                                                 <PlayableAudio src={item.audioUrl} controls controlsList={!canDownload ? "nodownload" : undefined} onContextMenu={(e) => { if (!canDownload) e.preventDefault(); }} className="w-full max-w-xs" />
                                            )}
                                       </div>
                                  ) : (
                                      <img
                                          src={item.originalImageUrl || item.imageUrl || item.thumbnailUrl!}
                                          alt={post?.labels?.[0] || "Nature sighting"}
                                          draggable={canDownload}
                                          onContextMenu={(e) => { if (!canDownload) e.preventDefault(); }}
                                          className="max-w-full max-h-full object-contain rounded-md"
                                      />
                                  )}
                              </div>
                          ))}
                      </div>

                      {/* Hover Arrow Controllers */}
                      {activeItemIndex > 0 && (
                          <button
                              onClick={(e) => { e.stopPropagation(); scrollToItem(activeItemIndex - 1); }} aria-label="Previous"
                              className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover/media:opacity-100 transition-opacity z-[175] active:scale-95 pointer-events-auto"
                          >
                              <Glyph name="chevronLeft" size={20} />
                          </button>
                      )}

                      {activeItemIndex < post.items.length - 1 && (
                          <button
                              onClick={(e) => { e.stopPropagation(); scrollToItem(activeItemIndex + 1); }} aria-label="Next"
                              className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover/media:opacity-100 transition-opacity z-[175] active:scale-95 pointer-events-auto"
                          >
                              <Glyph name="chevronRight" size={20} />
                          </button>
                      )}

                      {/* Subtle Overlay Dots Indicator */}
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-[175] py-1 px-2.5 rounded-full bg-black/20 backdrop-blur-sm">
                          {post.items.map((_, index) => (
                              <button
                                  key={index}
                                  onClick={() => scrollToItem(index)}
                                  className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${index === activeItemIndex ? 'bg-white scale-110 opacity-100' : 'bg-white/40 hover:bg-white/60 opacity-30'}`}
                              />
                          ))}
                      </div>
                  </>
              ) : (
                  <div className="w-full h-full flex items-center justify-center p-4">
                      {currentItem.mediaType === 'video' ? (
                           <PlayableVideo
                               src={currentItem.videoUrl!}
                               streamUrl={(currentItem as any).streamUrl}
                               preload="metadata"
                               controls
                               controlsList={!canDownload ? "nodownload" : undefined}
                               onContextMenu={(e) => { if (!canDownload) e.preventDefault(); }}
                               autoPlay
                               className="max-w-full max-h-full object-contain rounded-md"
                               style={{ transform: `rotate(${currentItem.rotation || 0}deg)` }}
                           />
                      ) : currentItem.mediaType === 'audio' ? (
                           <div className="flex flex-col items-center justify-center w-full h-full bg-stone-900/[0.045] p-8 shadow-2xl rounded-sm">
                                <Glyph name="sound" size={44} strokeWidth={1.2} className="text-white/60 mb-10" />
                                {currentItem.audioUrl && (
                                     <PlayableAudio src={currentItem.audioUrl} controls controlsList={!canDownload ? "nodownload" : undefined} onContextMenu={(e) => { if (!canDownload) e.preventDefault(); }} className="w-full max-w-xs" />
                                )}
                           </div>
                      ) : (
                          <img
                              src={currentItem.originalImageUrl || currentItem.imageUrl || currentItem.thumbnailUrl!}
                              alt={post?.labels?.[0] || "Nature sighting"}
                              draggable={canDownload}
                              onContextMenu={(e) => { if (!canDownload) e.preventDefault(); }}
                              className="max-w-full max-h-full object-contain rounded-md"
                          />
                      )}
                  </div>
              )}
          </div>

          <div className="w-full md:w-[400px] lg:w-[450px] bg-day-bg text-stone-800 flex flex-col h-[52dvh] md:h-full overflow-y-auto z-10 shrink-0 border-t md:border-t-0 md:border-l border-stone-200/80">
             <article className="px-6 pt-8 pb-4 md:px-10 md:pt-12 space-y-8 flex-1 ng-rise">
                 <header>
                     <h1 className={`ng-title ${hasSpecies ? 'italic' : ''}`}>{species}</h1>
                     {scientific && <p className="font-display italic text-base text-stone-500 mt-1">{scientific}</p>}
                     {behaviour && <p className="ng-body mt-3">{behaviour}</p>}
                     {alsoSeen.length > 0 && <p className="ng-small mt-2">Also in view: <span className="italic">{alsoSeen.join(', ')}</span></p>}
                     <p className="ng-caption mt-4">{[explorer, area ? `near ${area}` : '', when].filter(Boolean).join(' · ')}</p>
                 </header>

                 {fungi && <FungiWarning />}

                 {words && (
                     <figure className="border-l border-theme-accent pl-5">
                         <blockquote className="ng-body text-stone-800 whitespace-pre-line">{words}</blockquote>
                         <figcaption className="ng-caption mt-2">{explorer}, in the field</figcaption>
                     </figure>
                 )}

                 {insight.length > 0 && (
                     <section aria-labelledby="why-it-does-this">
                         <h2 id="why-it-does-this" className="ng-subtitle mb-3 flex items-center gap-3"><span className="ng-rule" aria-hidden="true" />Why it does this</h2>
                         <div className="space-y-3">
                             {insight.map((para, i) => <p key={i} className="font-display text-[18px] text-stone-800 leading-[1.6]">{para}</p>)}
                         </div>
                     </section>
                 )}

                 {tags.length > 0 && (
                     <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">{tags.map(t => <span key={t}>#{t}</span>)}</p>
                 )}
             </article>

             <aside className="mx-6 mb-6 md:mx-10 md:mb-10 pt-8 border-t border-stone-200/80" aria-label={`An invitation in the spirit of ${naturalist}`}>
                 <p className="ng-kicker">A note in the spirit of {naturalist}</p>
                 <p className="mt-4 font-display italic text-[20px] leading-[1.4] text-stone-900">
                     {explorer} found this {hasSpecies ? <em>{species}</em> : 'sighting'}{area ? ` near ${area}` : ''}. What's alive near you?
                 </p>
                 {extra.philosophy && <p className="mt-3 ng-small">{extra.philosophy}</p>}
                 <button onClick={onOpenLens || onGoToApp} className="mt-6 ng-button-primary group w-full sm:w-auto">
                     Open the Lens
                     <Glyph name="forward" size={20} className="ng-arrow transition-transform group-hover:translate-x-0.5" />
                 </button>
                 <button onClick={onGoToApp} className="mt-3 block ng-link-quiet min-h-[44px]">See what others found</button>
             </aside>
          </div>
      </div>
  );
};

export default SharedPostView;
