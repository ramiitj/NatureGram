import React, { useState, useEffect, useRef } from 'react';
import { CommunityPost } from '../types.ts';
import { FirebaseService } from '../services/firebaseService.ts';

interface SharedPostViewProps {
  postId: string;
  onGoToApp: () => void;
}

const SharedPostView: React.FC<SharedPostViewProps> = ({ postId, onGoToApp }) => {
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

  if (loading) {
      return (
          <div className="flex-1 bg-black text-white flex flex-col items-center justify-center font-body min-h-[100dvh]">
              <span className="material-symbols-outlined text-4xl animate-spin text-theme-accent mb-4">autorenew</span>
              <p className="tracking-widest uppercase text-sm font-bold text-white/50">Loading Discovery...</p>
          </div>
      );
  }

  if (error || !post) {
      return (
        <div className="flex-1 bg-black text-white flex flex-col items-center justify-center font-body min-h-[100dvh] p-6 text-center">
            <span className="material-symbols-outlined text-6xl text-red-500 mb-6">broken_image</span>
            <h1 className="text-2xl font-black mb-2">Post Not Found</h1>
            <p className="text-white/60 mb-8 max-w-md">This discovery may have been removed or the link is invalid.</p>
            <button onClick={onGoToApp} className="bg-theme-accent text-white px-8 py-4 rounded-full font-bold shadow-lg active:scale-95 transition-transform uppercase tracking-widest text-sm">
                Open NatureGram
            </button>
        </div>
      );
  }

  let currentItem = post.items && post.items.length > 0 ? post.items[activeItemIndex] : post;

  return (
      <div className="fixed inset-0 bg-black text-white flex flex-col font-body md:flex-row overflow-hidden">
          {/* Header (Mobile) */}
          <div className="absolute top-0 left-0 right-0 p-4 md:p-6 z-50 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
              <div className="flex items-center gap-2 text-theme-accent italic font-black font-display text-xl drop-shadow-md">
                 NatureGram
              </div>
          </div>

          <div className="flex-1 relative bg-black/90 flex flex-col justify-center min-h-[50dvh] md:min-h-screen group/media overflow-hidden">
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
                                       <video 
                                           src={item.videoUrl!} 
                                           controls 
                                           autoPlay={index === 0} 
                                           className="max-w-full max-h-full object-contain shadow-2xl rounded-sm" 
                                           style={{ transform: `rotate(${item.rotation || 0}deg)` }}
                                       />
                                  ) : item.mediaType === 'audio' ? (
                                       <div className="flex flex-col items-center justify-center w-[90%] md:w-auto p-8 bg-theme-primary/10 shadow-2xl rounded-sm">
                                            <span className="material-symbols-outlined text-6xl text-theme-accent mb-10">mic</span>
                                            {item.audioUrl && (
                                                 <audio src={item.audioUrl} controls className="w-full max-w-xs" />
                                            )}
                                       </div>
                                  ) : (
                                      <img 
                                          src={item.originalImageUrl || item.imageUrl || item.thumbnailUrl!} 
                                          alt="Discovery" 
                                          className="max-w-full max-h-full object-contain shadow-2xl rounded-sm" 
                                      />
                                  )}
                              </div>
                          ))}
                      </div>

                      {/* Hover Arrow Controllers */}
                      {activeItemIndex > 0 && (
                          <button 
                              onClick={(e) => { e.stopPropagation(); scrollToItem(activeItemIndex - 1); }}
                              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover/media:opacity-100 transition-opacity z-[175] active:scale-95 pointer-events-auto"
                          >
                              <span className="material-symbols-outlined text-xl">chevron_left</span>
                          </button>
                      )}

                      {activeItemIndex < post.items.length - 1 && (
                          <button 
                              onClick={(e) => { e.stopPropagation(); scrollToItem(activeItemIndex + 1); }}
                              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover/media:opacity-100 transition-opacity z-[175] active:scale-95 pointer-events-auto"
                          >
                              <span className="material-symbols-outlined text-xl">chevron_right</span>
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
                           <video 
                               src={currentItem.videoUrl!} 
                               controls 
                               autoPlay 
                               className="max-w-full max-h-full object-contain shadow-2xl rounded-sm" 
                               style={{ transform: `rotate(${currentItem.rotation || 0}deg)` }}
                           />
                      ) : currentItem.mediaType === 'audio' ? (
                           <div className="flex flex-col items-center justify-center w-full h-full bg-theme-primary/10 p-8 shadow-2xl rounded-sm">
                                <span className="material-symbols-outlined text-6xl text-theme-accent mb-10">mic</span>
                                {currentItem.audioUrl && (
                                     <audio src={currentItem.audioUrl} controls autoPlay className="w-full max-w-xs" />
                                )}
                           </div>
                      ) : (
                          <img 
                              src={currentItem.originalImageUrl || currentItem.imageUrl || currentItem.thumbnailUrl!} 
                              alt="Discovery" 
                              className="max-w-full max-h-full object-contain shadow-2xl rounded-sm" 
                          />
                      )}
                  </div>
              )}
          </div>
          
          <div className="w-full md:w-[400px] lg:w-[450px] bg-white text-black flex flex-col h-[50dvh] md:h-full overflow-y-auto z-10 shrink-0">
             <div className="p-6 md:p-10 space-y-6 flex-1">
                 <div className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                         <div className="w-10 h-10 rounded-full bg-theme-primary/10 flex items-center justify-center text-theme-primary font-black uppercase text-sm border border-theme-primary/20">
                             {post.userName.charAt(0)}
                         </div>
                         <div className="flex flex-col">
                             <span className="font-bold text-sm tracking-tight">{post.userName}</span>
                             <span className="text-[10px] text-theme-primary/60 uppercase tracking-wider font-bold">Explorer</span>
                         </div>
                     </div>
                 </div>

                 <div className="space-y-4">
                     {post.title && <h2 className="text-2xl md:text-3xl font-display font-black tracking-tight">{post.title}</h2>}
                     
                     <div className="flex flex-wrap gap-2 mt-2">
                         {post.labels.slice(0, 4).map((label: string, i: number) => (
                             <span key={i} className="bg-theme-primary px-3 py-1 text-[10px] uppercase font-black tracking-widest rounded-full text-white">
                                 {label}
                             </span>
                         ))}
                         {post.tags && post.tags.length > 0 && post.tags.map((tag: string, i: number) => (
                             <span key={`tag-${i}`} className="bg-stone-200 text-stone-700 px-3 py-1 text-[10px] font-bold tracking-widest rounded-full lowercase">
                                 #{tag}
                             </span>
                         ))}
                     </div>
                     
                     <div className="prose prose-sm text-theme-primary/80 prose-p:leading-relaxed">
                         <p>{post.behavior}</p>
                     </div>
                     {post.description && (
                         <div className="prose prose-sm text-theme-primary/70">
                             <p>{post.description}</p>
                         </div>
                     )}

                     {post.aiInsight && (
                         <div className="bg-theme-primary/5 rounded-xl p-5 border border-theme-primary/10 mt-6 relative">
                             <span className="material-symbols-outlined absolute -top-3 -right-2 text-theme-accent bg-day-bg rounded-full p-1 text-lg shadow-sm">auto_awesome</span>
                             <h4 className="text-xs font-black uppercase tracking-widest text-theme-accent mb-2">Ecological Insight</h4>
                             <p className="text-sm leading-relaxed text-theme-primary/70">{post.aiInsight}</p>
                         </div>
                     )}
                 </div>
             </div>

             <div className="p-6 border-t border-stone-100 bg-stone-50">
                 <button onClick={onGoToApp} className="w-full bg-theme-accent text-white px-6 py-4 rounded-xl font-black shadow-lg shadow-theme-accent/20 active:scale-95 transition-transform flex items-center justify-center gap-2 uppercase tracking-widest text-sm">
                     <span className="material-symbols-outlined">explore</span>
                     Explore More in App
                 </button>
             </div>
          </div>
      </div>
  );
};

export default SharedPostView;
