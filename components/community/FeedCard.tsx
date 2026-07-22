
import React, { useEffect, useState, useRef } from 'react';
import { FirebaseService } from '../../services/firebaseService';
import { CommunityPost } from '../../types';

const FeedCard: React.FC<{
    post: CommunityPost;
    onPostClick: (post: CommunityPost) => void;
    loadedImages: Record<string, boolean>;
    onImageLoad: (id: string) => void;
}> = ({ post, onPostClick, loadedImages, onImageLoad }) => {
    const isLoaded = post.mediaType === 'audio' ? true : loadedImages[post.id];
    const [isHovered, setIsHovered] = useState(false);
    const [fullMedia, setFullMedia] = useState<{videoUrl?: string, audioUrl?: string}|null>(null);
    const cardRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const isMobile = window.matchMedia("(hover: none)").matches;
        if (!isMobile || !cardRef.current) return;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    // Start playing if at least 60% of the card is visible
                    setIsHovered(entry.isIntersecting);
                });
            },
            { threshold: 0.6 }
        );

        observer.observe(cardRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        let active = true;
        if (isHovered && !post.videoUrl && !post.audioUrl && (post.mediaType === 'video' || post.mediaType === 'audio')) {
            FirebaseService.getFullPost(post.id).then(full => {
                if (active && full) {
                    setFullMedia({ videoUrl: full.videoUrl, audioUrl: full.audioUrl });
                }
            });
        }
        return () => { active = false; };
    }, [isHovered, post]);

    const videoUrl = post.videoUrl || fullMedia?.videoUrl;
    const audioUrl = post.audioUrl || fullMedia?.audioUrl;

    return (
        <div
            ref={cardRef}
            onClick={() => { setIsHovered(false); onPostClick(post); }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`relative group cursor-pointer transition-all duration-700 break-inside-avoid ${isLoaded ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-[0.98]'}`}
        >
            <div className="relative overflow-hidden bg-theme-primary/10 shadow-sm border border-theme-primary/10 rounded-lg">
                {post.mediaType === 'audio' ? (
                    <div className="w-full h-48 bg-theme-primary/90 flex items-center justify-center transition-transform duration-1000 group-hover:scale-105 relative overflow-hidden">
                        {post.thumbnailUrl || post.imageUrl ? (
                            <img src={post.thumbnailUrl || post.imageUrl} className="absolute inset-0 w-full h-full object-cover opacity-60 font-display" alt={post.title || post.labels?.[0] || 'Audio sighting thumbnail'} onLoad={() => onImageLoad(post.id)} />
                        ) : null}
                        <span className="material-symbols-outlined text-theme-accent text-4xl relative z-10">mic</span>
                    </div>
                ) : post.mediaType === 'video' ? (
                    <div className="w-full aspect-[9/16] bg-black flex items-center justify-center transition-transform duration-1000 group-hover:scale-105 relative overflow-hidden">
                        {post.thumbnailUrl || post.imageUrl ? (
                            <img src={post.thumbnailUrl || post.imageUrl} className="w-full h-full object-cover opacity-80 font-display" alt={post.title || post.labels?.[0] || 'Video sighting thumbnail'} onLoad={() => onImageLoad(post.id)} />
                        ) : (
                            <div className="w-full h-full bg-stone-900 flex items-center justify-center">
                                <span className="material-symbols-outlined text-white/50 text-4xl">movie</span>
                            </div>
                        )}
                        <span className="material-symbols-outlined text-white text-4xl absolute z-10 drop-shadow-md">play_circle</span>
                    </div>
                ) : (
                    <img
                        src={post.thumbnailUrl || post.imageUrl}
                        alt={post.title || post.labels?.[0] || 'Nature sighting'}
                        loading="lazy"
                        onLoad={() => onImageLoad(post.id)}
                        className={`w-full h-auto object-contain transition-transform duration-1000 group-hover:scale-105`}
                    />
                )}
                {post.items && post.items.length > 1 && (
                    <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center z-20">
                        <span className="material-symbols-outlined text-white text-[12px]">filter_none</span>
                    </div>
                )}
                {post.mediaType === 'video' ? (
                    <div className={`absolute top-2 ${post.items && post.items.length > 1 ? 'right-10' : 'right-2'} w-5 h-5 rounded-full bg-black/10 backdrop-blur-md flex items-center justify-center`}>
                        <span className="material-symbols-outlined text-white text-[10px]">play_arrow</span>
                    </div>
                ) : post.mediaType === 'audio' ? (
                    <div className={`absolute top-2 ${post.items && post.items.length > 1 ? 'right-10' : 'right-2'} w-5 h-5 rounded-full bg-black/10 backdrop-blur-md flex items-center justify-center`}>
                        <span className="material-symbols-outlined text-white text-[10px]">mic</span>
                    </div>
                ) : post.audioUrl ? (
                    <div className={`absolute top-2 ${post.items && post.items.length > 1 ? 'right-10' : 'right-2'} w-5 h-5 rounded-full bg-black/10 backdrop-blur-md flex items-center justify-center`}>
                        <span className="material-symbols-outlined text-white text-[10px]">music_note</span>
                    </div>
                ) : null}
            </div>

            <div className={`px-1 mt-2 text-center md:text-left transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}>
                <h4 className="text-[10px] font-display font-bold italic text-theme-primary leading-tight truncate tracking-tight group-hover:text-theme-accent transition-colors">
                    {post.title || post.labels?.[0] || "Specimen"}
                </h4>
                <div className="flex items-center justify-center md:justify-start gap-1 mt-1 opacity-40">
                    <p className="catalog-label text-[6px] tracking-[0.2em] uppercase font-bold text-theme-primary/60">
                        {post.locationArea || "Earth"}
                    </p>
                    <span className="w-0.5 h-0.5 rounded-full bg-theme-primary/30 shrink-0"></span>
                    <div className="flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-[7px] text-theme-accent">favorite</span>
                            <span className="text-[7px] font-bold text-theme-primary/60">{post.likes?.length || 0}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FeedCard;
