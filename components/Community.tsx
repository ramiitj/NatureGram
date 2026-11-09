
import { openExternal, timeAgo } from '../utils';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { getNaturalistExtra, getThemePeriod } from '../constants/naturalistExtras';
import AiBadge, { isFungiPost, FungiWarning } from './AiBadge';
import RichText from './RichText';
import { UserProfileData } from '../types';
import { track } from '../services/analytics';
import { CommunityPost, UserMode, Comment } from '../types';
import ShareStudio from './ShareStudio';
import PublisherStudio from './PublisherStudio';
import MediaEditor from './MediaEditor';
import SkeletonPost from './SkeletonPost';
import AuthModal from './AuthModal';
import { AnimatePresence, motion } from 'motion/react';
import { hapticFeedback } from '../utils';

const FeedCard: React.FC<{
    post: CommunityPost;
    onPostClick: (post: CommunityPost) => void;
    loadedImages: Record<string, boolean>;
    onImageLoad: (id: string) => void;
}> = ({ post, onPostClick, loadedImages, onImageLoad }) => {
    const hasThumb = !!(post.thumbnailUrl || post.imageUrl);
    const isLoaded = post.mediaType === 'audio' || !hasThumb ? true : loadedImages[post.id];
    const label = post.title || post.caption || post.labels?.[0] || 'Sighting';
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
            role="button"
            tabIndex={0}
            aria-label={`${label} by ${post.userName || 'an explorer'}`}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPostClick(post); } }}
            onClick={() => { setIsHovered(false); onPostClick(post); }} 
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`relative group cursor-pointer transition-all duration-700 break-inside-avoid ${isLoaded ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-[0.98]'}`}
        >
            <div className="relative overflow-hidden bg-theme-primary/10 shadow-sm border border-theme-primary/10 rounded-lg">
                {post.mediaType === 'audio' ? (
                    <div className="w-full h-48 bg-theme-primary/90 flex items-center justify-center transition-transform duration-1000 group-hover:scale-105 relative overflow-hidden">
                        {post.thumbnailUrl || post.imageUrl ? (
                            <img src={post.thumbnailUrl || post.imageUrl} className="absolute inset-0 w-full h-full object-cover opacity-60 font-display" alt="" loading="lazy" onLoad={() => onImageLoad(post.id)} onError={() => onImageLoad(post.id)} />
                        ) : null}
                        <span className="material-symbols-outlined text-theme-accent text-4xl relative z-10">mic</span>
                    </div>
                ) : post.mediaType === 'video' ? (
                    <div className="w-full aspect-[9/16] bg-black flex items-center justify-center transition-transform duration-1000 group-hover:scale-105 relative overflow-hidden">
                        {post.thumbnailUrl || post.imageUrl ? (
                            <img src={post.thumbnailUrl || post.imageUrl} className="w-full h-full object-cover opacity-80 font-display" alt={`Video: ${label}`} loading="lazy" onLoad={() => onImageLoad(post.id)} onError={() => onImageLoad(post.id)} />
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
                        alt={label}
                        loading="lazy" 
                        decoding="async"
                        onLoad={() => onImageLoad(post.id)}
                        onError={() => onImageLoad(post.id)}
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
                        <span className="material-symbols-outlined text-white text-xs">play_arrow</span>
                    </div>
                ) : post.mediaType === 'audio' ? (
                    <div className={`absolute top-2 ${post.items && post.items.length > 1 ? 'right-10' : 'right-2'} w-5 h-5 rounded-full bg-black/10 backdrop-blur-md flex items-center justify-center`}>
                        <span className="material-symbols-outlined text-white text-xs">mic</span>
                    </div>
                ) : post.audioUrl ? (
                    <div className={`absolute top-2 ${post.items && post.items.length > 1 ? 'right-10' : 'right-2'} w-5 h-5 rounded-full bg-black/10 backdrop-blur-md flex items-center justify-center`}>
                        <span className="material-symbols-outlined text-white text-xs">music_note</span>
                    </div>
                ) : null}
            </div>
            
            <div className={`px-1 mt-2 transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}>
                <h3 className="text-sm font-display font-bold italic text-theme-primary leading-tight truncate group-hover:text-theme-accent transition-colors">
                    {label}
                </h3>
                <div className="flex items-center gap-1.5 mt-1 text-xs text-stone-600 min-w-0">
                    <span className="truncate font-medium">{post.userName || 'Explorer'}</span>
                    {post.locationArea && <><span aria-hidden="true">·</span><span className="truncate">{post.locationArea}</span></>}
                    <span className="ml-auto flex items-center gap-0.5 shrink-0" aria-label={`${post.likes?.length || 0} likes`}>
                        <span className="material-symbols-outlined text-sm text-theme-accent" aria-hidden="true" style={{ fontVariationSettings: "'FILL' 1" }}>favorite</span>
                        <span className="font-semibold tabular">{post.likes?.length || 0}</span>
                    </span>
                </div>
            </div>
        </div>
    );
};

interface CommunityProps {
  currentUserMode: UserMode;
  selectedPostId?: string | null;
  onPostClose?: () => void;
  onPostOpen?: () => void;
  backLabel?: string;
  onViewProfile?: (userId: string) => void;
  isJournalOnly?: boolean;
  activeDraftsCount?: number;
  onViewDrafts?: () => void;
  onLogoClick?: () => void;
  onRequireAccount?: (reason: string, then?: () => void) => void;
  dailyTheme?: any;
}

const Community: React.FC<CommunityProps> = ({ 
    currentUserMode, 
    selectedPostId, 
    onPostClose, 
    onPostOpen, 
    backLabel = "Feed",
    onViewProfile,
    isJournalOnly = false,
    activeDraftsCount = 0,
    onViewDrafts,
    onLogoClick,
    onRequireAccount,
    dailyTheme
}) => {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [lastVisible, setLastVisible] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [activePost, setActivePost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTag, setSearchTag] = useState<string | null>(null);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [feedMode, setFeedMode] = useState<'foryou' | 'following'>('foryou');
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [loadMoreState, setLoadMoreState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [isSaved, setIsSaved] = useState(false);
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const isMember = !!currentUserMode.userId && currentUserMode.userId !== 'explorer_guest' && !currentUserMode.isAnonymous;
  const showToast = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 2600); };
  /** Gate an action behind an account, then resume it after sign-up. */
  const askAccount = (reason: string, then?: () => void) => {
    if (onRequireAccount) onRequireAccount(reason, then);
    else setShowAuthModal(true);
  };
  const themeExtra = getNaturalistExtra(dailyTheme?.id);
  const themePeriod = getThemePeriod();

  useEffect(() => {
    if (isMember) FirebaseService.getBlockedIds().then(setBlockedIds);
  }, [isMember]);

  // "Fresh sightings" rail: explorers you follow who posted in the last 72 hours
  const [freshRail, setFreshRail] = useState<{ userId: string; userName: string; avatar?: string | null; post: CommunityPost; count: number }[]>([]);
  useEffect(() => {
    if (!isMember || isJournalOnly || !currentUserMode.userId) { setFreshRail([]); return; }
    let active = true;
    (async () => {
      const ids = await FirebaseService.getFollowingIds(currentUserMode.userId!);
      if (!ids.length) return;
      const feed = await FirebaseService.getFollowingFeed(ids, 20);
      const cutoff = Date.now() - 72 * 3600 * 1000;
      const byUser = new Map<string, { userId: string; userName: string; avatar?: string | null; post: CommunityPost; count: number }>();
      feed.forEach(p => {
        const ms = (p.timestamp as any)?.toMillis ? (p.timestamp as any).toMillis() : 0;
        if (ms < cutoff) return;
        const e = byUser.get(p.userId);
        if (e) e.count++;
        else byUser.set(p.userId, { userId: p.userId, userName: p.userName, avatar: p.userAvatar, post: p, count: 1 });
      });
      if (active) setFreshRail([...byUser.values()].slice(0, 20));
    })().catch(() => {});
    return () => { active = false; };
  }, [isMember, isJournalOnly, currentUserMode.userId]);

  // Rich Search Feature States
  const [searchQuery, setSearchQuery] = useState("");
  const [mediaFilter, setMediaFilter] = useState<'all' | 'image' | 'video' | 'audio'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'likes' | 'title'>('newest');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [activeExploreTab, setActiveExploreTab] = useState<'all' | 'flora' | 'fauna' | 'fungi' | 'audio' | 'video' | 'popular'>('all');
  const [serverUsers, setServerUsers] = useState<UserProfileData[]>([]);
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2 || q.startsWith('#') || isJournalOnly) { setServerUsers([]); return; }
    const t = window.setTimeout(() => {
      FirebaseService.searchUsers(q).then(setServerUsers);
      track('search', { length: q.length });
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchQuery, isJournalOnly]);
  const openMention = async (username: string) => {
    const u = await FirebaseService.findUserByUsername(username);
    if (u) { setIsCommentsOpen(false); onViewProfile?.(u.uid); }
    else showToast(`@${username} isn't on NatureGram yet`);
  };

  // Dynamically generated Instagram-style search suggestions
  const dynamicSuggestions = React.useMemo(() => {
    const popularTags = new Set<string>();
    const activeCreators = new Set<string>();
    const topLocations = new Set<string>();

    posts.forEach(p => {
      if (p.tags) p.tags.forEach(t => {
        if (t) popularTags.add(t.startsWith('#') ? t : `#${t}`);
      });
      if (p.labels) p.labels.forEach(lbl => {
        if (lbl) popularTags.add(`#${lbl.toLowerCase().replace(/\s+/g, '')}`);
      });
      if (p.userName) activeCreators.add(p.userName);
      if (p.locationArea) topLocations.add(p.locationArea);
    });

    return {
      tags: Array.from(popularTags).slice(0, 8),
      creators: Array.from(activeCreators).slice(0, 6),
      locations: Array.from(topLocations).slice(0, 5),
    };
  }, [posts]);

  // Computes sorted and filtered posts in memory (allowing dynamic full-text and attribute search without Firestore indexing errors)
  const filteredAndSortedPosts = React.useMemo(() => {
    return posts
      .filter(post => {
        if (blockedIds.includes(post.userId)) return false;
        // 1. Full-text search match (Titles, Labels, Descriptions, Locations, Insights)
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase().trim();
          const cleanQuery = query.startsWith('#') ? query.slice(1) : query;
          const cleanQueryAt = query.startsWith('@') ? query.slice(1) : query;

          const titleMatch = post.title?.toLowerCase().includes(query) || post.title?.toLowerCase().includes(cleanQuery);
          const descMatch = post.description?.toLowerCase().includes(query) || post.description?.toLowerCase().includes(cleanQuery);
          const locationMatch = post.locationArea?.toLowerCase().includes(query) || post.locationArea?.toLowerCase().includes(cleanQuery);
          const behaviorMatch = post.behavior?.toLowerCase().includes(query) || post.behavior?.toLowerCase().includes(cleanQuery);
          const insightMatch = post.aiInsight?.toLowerCase().includes(query) || post.aiInsight?.toLowerCase().includes(cleanQuery);
          const labelMatch = post.labels?.some(lbl => lbl.toLowerCase().includes(query) || lbl.toLowerCase().includes(cleanQuery));
          const tagMatch = post.tags?.some(tag => tag.toLowerCase().includes(query) || tag.toLowerCase().includes(cleanQuery));
          const userNameMatch = post.userName?.toLowerCase().includes(query) || post.userName?.toLowerCase().includes(cleanQuery) || post.userName?.toLowerCase().includes(cleanQueryAt);

          if (!titleMatch && !descMatch && !locationMatch && !behaviorMatch && !insightMatch && !labelMatch && !tagMatch && !userNameMatch) {
            return false;
          }
        }

        // 2. Dynamic Instagram Explore Category Tab Filters
        if (activeExploreTab === 'flora') {
          const floraKeywords = ['plant', 'flower', 'flora', 'tree', 'vegetation', 'leaf', 'shrub', 'moss', 'clover', 'botany', 'fern', 'bloom', 'rose', 'grass', 'oak', 'maple', 'pine', 'nature'];
          const matchesFlora = post.labels?.some(lbl => floraKeywords.some(kw => lbl.toLowerCase().includes(kw))) ||
                              post.tags?.some(tag => floraKeywords.some(kw => tag.toLowerCase().includes(kw))) ||
                              floraKeywords.some(kw => post.description?.toLowerCase().includes(kw));
          if (!matchesFlora) return false;
        } else if (activeExploreTab === 'fauna') {
          const faunaKeywords = ['animal', 'bird', 'insect', 'reptile', 'fauna', 'bug', 'wildlife', 'mammal', 'creature', 'caterpillar', 'squirrel', 'deer', 'rabbit', 'fly', 'moth', 'butterfly', 'bee', 'sparrow', 'frog', 'lizard', 'snake', 'fish', 'hawk', 'crow'];
          const matchesFauna = post.labels?.some(lbl => faunaKeywords.some(kw => lbl.toLowerCase().includes(kw))) ||
                              post.tags?.some(tag => faunaKeywords.some(kw => tag.toLowerCase().includes(kw))) ||
                              faunaKeywords.some(kw => post.description?.toLowerCase().includes(kw));
          if (!matchesFauna) return false;
        } else if (activeExploreTab === 'fungi') {
          const fungiKeywords = ['mushroom', 'fungus', 'fungi', 'mycelium', 'lichen', 'spore', 'toadstool', 'amanita', 'chanterelle', 'bolete', 'shelf', 'mold'];
          const matchesFungi = post.labels?.some(lbl => fungiKeywords.some(kw => lbl.toLowerCase().includes(kw))) ||
                               post.tags?.some(tag => fungiKeywords.some(kw => tag.toLowerCase().includes(kw))) ||
                               fungiKeywords.some(kw => post.description?.toLowerCase().includes(kw));
          if (!matchesFungi) return false;
        } else if (activeExploreTab === 'audio') {
          if (post.mediaType !== 'audio') return false;
        } else if (activeExploreTab === 'video') {
          if (post.mediaType !== 'video') return false;
        }

        // 3. Media Type Filter
        if (mediaFilter !== 'all') {
          if (post.mediaType !== mediaFilter) {
            return false;
          }
        }

        // 4. Date Sighting Filter
        if (dateFilter !== 'all') {
          const postDate = post.timestamp?.toDate ? post.timestamp.toDate() : (post.timestamp ? new Date(post.timestamp) : new Date());
          const now = new Date();
          const diffTime = Math.abs(now.getTime() - postDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (dateFilter === 'today' && diffDays > 1) return false;
          if (dateFilter === 'week' && diffDays > 7) return false;
          if (dateFilter === 'month' && diffDays > 30) return false;
        }

        // 5. Taxonomic Species Label Filters
        if (selectedLabels.length > 0) {
          const hasLabel = post.labels?.some(lbl => selectedLabels.includes(lbl));
          if (!hasLabel) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const querySortOrder = activeExploreTab === 'popular' ? 'likes' : sortOrder;
        // 6. High-fidelity Sorting Order
        if (querySortOrder === 'newest') {
          const tA = a.timestamp?.seconds || (a.timestamp ? new Date(a.timestamp).getTime() : 0);
          const tB = b.timestamp?.seconds || (b.timestamp ? new Date(b.timestamp).getTime() : 0);
          return tB - tA;
        } else if (querySortOrder === 'likes') {
          const likesA = a.likes?.length || 0;
          const likesB = b.likes?.length || 0;
          return likesB - likesA;
        } else if (querySortOrder === 'title') {
          const titleA = a.title || a.labels?.[0] || 'Specimen';
          const titleB = b.title || b.labels?.[0] || 'Specimen';
          return titleA.localeCompare(titleB);
        }
        return 0;
      });
  }, [posts, searchQuery, activeExploreTab, mediaFilter, dateFilter, sortOrder, selectedLabels, blockedIds]);

  // Extract all categories / species labels currently present in observations for selection
  const allAvailableLabels = React.useMemo(() => {
    const labelsSet = new Set<string>();
    posts.forEach(p => {
      if (p.labels) p.labels.forEach(lbl => labelsSet.add(lbl));
    });
    return Array.from(labelsSet).sort();
  }, [posts]);

  // Handle label selection clicks
  const toggleLabelFilter = (lbl: string) => {
    setSelectedLabels(prev => 
      prev.includes(lbl) ? prev.filter(x => x !== lbl) : [...prev, lbl]
    );
  };

  // Reset all search search query indices and category filters
  const resetAllFilters = () => {
    setSearchQuery("");
    setMediaFilter('all');
    setDateFilter('all');
    setSortOrder('newest');
    setSelectedLabels([]);
    setSearchTag(null);
    setActiveExploreTab('all');
    setIsSearchFocused(false);
  };
  
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const activePostIndex = activePost ? posts.findIndex(p => p.id === activePost.id) : -1;
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const mediaScrollRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);

  const swipeTouchStartX = useRef(0);
  const swipeTouchStartY = useRef(0);

  const handleSwipeTouchStart = (e: React.TouchEvent) => {
    swipeTouchStartX.current = e.touches[0].clientX;
    swipeTouchStartY.current = e.touches[0].clientY;
  };

  const handleSwipeTouchEnd = (e: React.TouchEvent) => {
    const diffX = e.changedTouches[0].clientX - swipeTouchStartX.current;
    const diffY = e.changedTouches[0].clientY - swipeTouchStartY.current;
    
    if (Math.abs(diffX) > 60 && Math.abs(diffY) < 50) {
      const hasMultipleItems = activePost && activePost.items && activePost.items.length > 1;
      if (diffX < 0) {
        // Swiped Left - try to go to next item or next post
        if (hasMultipleItems && activeItemIndex < activePost!.items!.length - 1) {
          return;
        }
        navigateSequential('next');
      } else {
        // Swiped Right - try to go to prev item or prev post
        if (hasMultipleItems && activeItemIndex > 0) {
          return;
        }
        navigateSequential('prev');
      }
    }
  };

  const handleMediaScroll = (e: React.UIEvent<HTMLDivElement>) => {
      if (isScrollingRef.current) return;
      const container = e.currentTarget;
      const scrollLeft = container.scrollLeft;
      const width = container.clientWidth;
      if (width > 0) {
          const index = Math.round(scrollLeft / width);
          if (index !== activeItemIndex && index >= 0 && index < (activePost?.items?.length || 0)) {
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
  }, [activePost]);

  const [sharingPost, setSharingPost] = useState<CommunityPost | null>(null);
  const [publishingPost, setPublishingPost] = useState<CommunityPost | null>(null);

  const loadMore = useCallback(async () => {
      if (!hasMore || isLoading || isJournalOnly || feedMode === 'following' || loadMoreState === 'loading') return;
      setLoadMoreState('loading');
      try {
          const { posts: newPosts, lastVisible: newLastVisible } = await FirebaseService.getMorePosts(lastVisible, searchTag);
          setPosts(prev => {
              const seen = new Set(prev.map(p => p.id));
              return [...prev, ...newPosts.filter(p => !seen.has(p.id))];
          });
          setLastVisible(newLastVisible);
          setHasMore(newLastVisible !== null);
          setLoadMoreState('idle');
      } catch (err) {
          console.error("Failed to load more posts:", err);
          setLoadMoreState('error');
      }
  }, [hasMore, isLoading, lastVisible, searchTag, isJournalOnly, feedMode, loadMoreState]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            loadMore();
        }
    }, { threshold: 0.1 });

    if (loadMoreRef.current) {
        observer.observe(loadMoreRef.current);
    }

    return () => {
        if (loadMoreRef.current) {
            observer.unobserve(loadMoreRef.current);
        }
    };
  }, [loadMore]);

  const [isEditing, setIsEditing] = useState(false);
  const [localFlipH, setLocalFlipH] = useState(false);
  const [localFlipV, setLocalFlipV] = useState(false);
  const [fetchedPostId, setFetchedPostId] = useState<string | null>(null);
  const unsubscribeCommentsRef = useRef<(() => void) | null>(null);
  const [lastTap, setLastTap] = useState<number>(0);
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  
  // Advanced Species Intelligence
  const [selectedSpecies, setSelectedSpecies] = useState<{name: string, location: string, id: string} | null>(null);
  const [speciesData, setSpeciesData] = useState<{extract: string, thumbnail: string, loading: boolean, url?: string} | null>(null);

  const handleSpeciesClick = async (label: string, locationArea?: string) => {
    setSelectedSpecies({name: label, location: locationArea || "Unknown Habitat", id: label});
    setSpeciesData({extract: "", thumbnail: "", loading: true});
    try {
        const clean = label.replace(/\(.*?\)/g, '').trim();
        const candidates = Array.from(new Set([clean, clean.split(' ').slice(0, 2).join(' ')])).filter(Boolean);
        let found: any = null;
        for (const c of candidates) {
            const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c)}?redirect=true`);
            if (res.ok) {
                const data = await res.json();
                if (data.type !== 'disambiguation' && data.extract) { found = data; break; }
            }
        }
        setSpeciesData({
            extract: found?.extract || `We couldn't find an encyclopedia entry for "${clean}". The name may be a general group or an uncertain AI suggestion.`,
            thumbnail: found?.thumbnail?.source || "",
            loading: false,
            url: found?.content_urls?.desktop?.page || '',
        } as any);
    } catch(e) {
        setSpeciesData({extract: "We couldn't reach the encyclopedia right now. Please try again later.", thumbnail: "", loading: false});
    }
  };

  const handleDeletePost = async (postId: string) => {
      setConfirmDeleteId(postId);
  };

  const executeDelete = async () => {
      if (!confirmDeleteId) return;
      const postId = confirmDeleteId;
      setConfirmDeleteId(null);
      try {
          // Optimistic update
          setPosts(prev => prev.filter(p => p.id !== postId));
          
          await FirebaseService.deletePost(postId);
          if (activePost?.id === postId) {
              closeDetail();
          }
      } catch (e) {
          console.error("Failed to delete post", e);
          alert("Failed to delete observation.");
          // Revert optimistic update is handled by the onSnapshot listener automatically
      }
  };

  // Real-time user journal query subscription
  useEffect(() => {
    if (!isJournalOnly) return;
    
    setIsLoading(true);
    setPosts([]);
    setError(null);
    setHasMore(false); // Subscriptions fetch everything at once
    
    if (!currentUserMode.userId) {
        setIsLoading(false);
        return;
    }
    
    const unsubscribe = FirebaseService.subscribeToUserJournal(currentUserMode.userId, (data) => {
        setPosts(data);
        setIsLoading(false);
    });
    
    return () => unsubscribe();
  }, [isJournalOnly, currentUserMode.userId]);

  // Original Global Feed loaded paginated query
  useEffect(() => {
    if (isJournalOnly || feedMode !== 'following') return;
    let active = true;
    setIsLoading(true);
    setError(null);
    setHasMore(false);
    (async () => {
      try {
        const ids = currentUserMode.userId ? await FirebaseService.getFollowingIds(currentUserMode.userId) : [];
        const feed = await FirebaseService.getFollowingFeed(ids);
        if (active) setPosts(feed);
      } catch (e: any) {
        if (active) setError(e?.message || 'failed');
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [feedMode, isJournalOnly, currentUserMode.userId]);

  // Logo / Feed tab re-tap: back to the top of the main feed
  useEffect(() => {
    const onTop = () => {
      document.getElementById('community-scroll-container')?.scrollTo({ top: 0, behavior: 'smooth' });
    };
    window.addEventListener('ng:feed-top', onTop);
    return () => window.removeEventListener('ng:feed-top', onTop);
  }, []);

  useEffect(() => {
    if (isJournalOnly || feedMode !== 'foryou') return;
    
    window.scrollTo(0, 0);
    const container = document.getElementById('community-scroll-container');
    if (container) container.scrollTop = 0;
    
    setIsLoading(true);
    setPosts([]);
    setLastVisible(null);
    setHasMore(true);
    setError(null);
    
    FirebaseService.getMorePosts(null, searchTag).then(({ posts: newPosts, lastVisible: newLastVisible }) => {
        setPosts(newPosts);
        setLastVisible(newLastVisible);
        setHasMore(newLastVisible !== null);
        setIsLoading(false);
    }).catch(err => {
        console.error("Failed to load initial posts:", err);
        let msg = err.message || String(err);
        try {
            const parsed = JSON.parse(msg);
            if (parsed && parsed.error) msg = parsed.error;
        } catch (e) {}
        setError(msg);
        setIsLoading(false);
    });
  }, [searchTag, isJournalOnly, feedMode]);

  useEffect(() => {
    if (selectedPostId) {
        const post = posts.find(p => p.id === selectedPostId);
        if (post) {
            setActivePost(post);
            setActiveItemIndex(0);
            onPostOpen?.();
        } else if (!isLoading && fetchedPostId !== selectedPostId) {
            setFetchedPostId(selectedPostId);
            FirebaseService.getPost(selectedPostId).then(fetchedPost => {
                if (fetchedPost) {
                    setActivePost(fetchedPost);
                    setActiveItemIndex(0);
                    onPostOpen?.();
                }
            });
        }
    }
  }, [selectedPostId, posts, isLoading, fetchedPostId]);

  useEffect(() => {
    if (activePost) {
        let isMissingData = false;
        if (activePost.items && activePost.items.length > 0) {
            const first = activePost.items[0];
            if (first.mediaType === 'video' && !first.videoUrl) isMissingData = true;
            else if (first.mediaType === 'audio' && !first.audioUrl) isMissingData = true;
            else if (first.mediaType === 'image' && !first.imageUrl && !first.originalImageUrl) isMissingData = true;
        } else {
            if (activePost.mediaType === 'video' && !activePost.videoUrl) isMissingData = true;
            else if (activePost.mediaType === 'audio' && !activePost.audioUrl) isMissingData = true;
            else if (activePost.mediaType === 'image' && !activePost.imageUrl && !activePost.originalImageUrl) isMissingData = true;
        }

        if (isMissingData) {
            FirebaseService.getPost(activePost.id).then(fullPost => {
                if (fullPost && activePost.id === fullPost.id) {
                    setActivePost(fullPost);
                }
            });
        }
    }
  }, [activePost?.id]);

  useEffect(() => {
      setPostMenuOpen(false);
      setReportOpen(false);
      if (activePost && isMember) FirebaseService.isSaved(activePost.id).then(setIsSaved);
      else setIsSaved(false);
  }, [activePost?.id, isMember]);

  // Real back-button support: opening a post adds a history entry; Back closes it
  const historyPushedRef = useRef(false);
  useEffect(() => {
      if (activePost && !historyPushedRef.current) {
          const url = new URL(window.location.href);
          url.searchParams.set('p', activePost.id);
          window.history.pushState({ post: activePost.id }, '', url.toString());
          historyPushedRef.current = true;
      } else if (activePost && historyPushedRef.current) {
          const url = new URL(window.location.href);
          url.searchParams.set('p', activePost.id);
          window.history.replaceState({ post: activePost.id }, '', url.toString());
      }
  }, [activePost?.id]);
  useEffect(() => {
      const onPop = () => {
          if (historyPushedRef.current && !new URLSearchParams(window.location.search).get('p')) {
              historyPushedRef.current = false;
              setIsCommentsOpen(false);
              setActivePost(null);
              onPostClose?.();
          }
      };
      window.addEventListener('popstate', onPop);
      return () => window.removeEventListener('popstate', onPop);
  }, [onPostClose]);

  useEffect(() => {
      if (unsubscribeCommentsRef.current) unsubscribeCommentsRef.current();
      if (activePost) {
          unsubscribeCommentsRef.current = FirebaseService.subscribeToComments(activePost.id, (newComments) => {
              setComments(newComments);
          });
      }
      return () => { if (unsubscribeCommentsRef.current) unsubscribeCommentsRef.current(); };
  }, [activePost]);

  const handlePostClick = async (post: CommunityPost) => {
    hapticFeedback(10);
    track('post_open', { media: post.mediaType, feed: feedMode });
    setActivePost(post);
    setActiveItemIndex(0);
    onPostOpen?.();
    try {
      const fullPost = await FirebaseService.getFullPost(post.id);
      if (fullPost) setActivePost(fullPost);
    } catch (e) {
      console.warn('Could not load full post:', e);
    }
  };

  const applyLikeLocally = (postId: string, uid: string, like: boolean) => {
      const update = (p: CommunityPost) => {
          if (p.id !== postId) return p;
          const set = new Set(p.likes || []);
          if (like) set.add(uid); else set.delete(uid);
          return { ...p, likes: [...set] };
      };
      setPosts(prev => prev.map(update));
      setActivePost(prev => prev ? update(prev) : prev);
  };

  const setLike = async (post: CommunityPost, like: boolean) => {
      if (!isMember) {
          askAccount('Create a free account to like sightings and support other explorers.', () => setLike(post, like));
          return;
      }
      const uid = currentUserMode.userId!;
      const isLiked = !!post.likes?.includes(uid);
      if (isLiked === like) return;
      hapticFeedback(10);
      applyLikeLocally(post.id, uid, like);
      track(like ? 'like' : 'unlike', { media: post.mediaType });
      try {
          await FirebaseService.toggleLike(post.id, uid, isLiked);
      } catch (err) {
          console.error('Like failed', err);
          applyLikeLocally(post.id, uid, !like);
          showToast('Could not save your like. Please try again.');
      }
  };

  const handleLike = (e: React.MouseEvent, post: CommunityPost) => {
      e.stopPropagation();
      setLike(post, !post.likes?.includes(currentUserMode.userId || ''));
  };

  const handleDoubleTap = (_e: React.MouseEvent | React.TouchEvent, post: CommunityPost) => {
      const now = Date.now();
      if (now - lastTap < 300) {
          hapticFeedback([30, 40, 30]);
          setShowHeartAnimation(true);
          window.setTimeout(() => setShowHeartAnimation(false), 900);
          setLike(post, true);
          setLastTap(0);
          return;
      }
      setLastTap(now);
  };

  const handleSave = async () => {
      if (!activePost) return;
      if (!isMember) { askAccount('Create a free account to save sightings to your collection.', handleSave); return; }
      const next = !isSaved;
      setIsSaved(next);
      try {
          await FirebaseService.toggleSave(activePost.id, next, activePost);
          track(next ? 'save' : 'unsave');
          showToast(next ? 'Saved to your collection' : 'Removed from saved');
      } catch {
          setIsSaved(!next);
          showToast('Could not update saved posts.');
      }
  };

  const handleReport = async (reason: string) => {
      if (!activePost) return;
      setReportOpen(false);
      if (!isMember) { askAccount('Create a free account to report content.'); return; }
      if (activePost.reports?.includes(currentUserMode.userId!)) { showToast('You already reported this post. Thank you.'); return; }
      try {
          await FirebaseService.reportPost(activePost.id, reason);
          track('report', { reason });
          setActivePost(prev => prev ? { ...prev, reports: [...(prev.reports || []), currentUserMode.userId!] } : prev);
          showToast('Thanks. Our moderators will review this post.');
      } catch {
          showToast('Could not send the report. Please try again.');
      }
  };

  const handleBlockAuthor = async () => {
      if (!activePost) return;
      setPostMenuOpen(false);
      if (!isMember) { askAccount('Create a free account to block explorers.'); return; }
      if (!window.confirm(`Block ${activePost.userName}? You won't see their posts or comments.`)) return;
      try {
          await FirebaseService.blockUser(activePost.userId);
          setBlockedIds(prev => [...prev, activePost.userId]);
          closeDetail();
          showToast(`${activePost.userName} blocked`);
      } catch { showToast('Could not block. Please try again.'); }
  };

  const handleSendComment = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!isMember) {
          askAccount('Create a free account to join the conversation.');
          return;
      }
      if (!newComment.trim() || !activePost || !currentUserMode.userId || sendingComment) return;
      setSendingComment(true);
      try {
          await FirebaseService.addComment(activePost.id, currentUserMode.userId, newComment);
          track('comment', { length: newComment.length, mention: newComment.includes('@') });
          setNewComment("");
          setActivePost(prev => prev ? { ...prev, commentCount: (prev.commentCount || 0) + 1 } : prev);
      } catch {
          showToast('Your comment could not be posted. Please try again.');
      } finally {
          setSendingComment(false);
      }
  };

  const handleDeleteComment = async (commentId: string) => {
      if (!activePost || !window.confirm('Delete this comment?')) return;
      try {
          await FirebaseService.deleteComment(activePost.id, commentId);
      } catch { showToast('Could not delete the comment.'); }
  };

  const handleProfileClick = (userId: string) => {
      onViewProfile?.(userId);
  };

  const navigateSequential = (direction: 'next' | 'prev') => {
    if (!activePost) return;
    const currentIndex = posts.findIndex(p => p.id === activePost.id);
    if (currentIndex === -1) return;
    
    let nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex >= 0 && nextIndex < posts.length) {
        setActivePost(posts[nextIndex]);
        setActiveItemIndex(0);
        if (contentContainerRef.current) contentContainerRef.current.scrollTop = 0;
        if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
    }
  };

  const closeDetail = () => {
    if (historyPushedRef.current) {
        historyPushedRef.current = false;
        const url = new URL(window.location.href);
        url.searchParams.delete('p');
        window.history.replaceState({}, '', url.toString());
    }
    setIsCommentsOpen(false);
    setActivePost(null);
    setLocalFlipH(false);
    setLocalFlipV(false);
    onPostClose?.();
  };

  const handleEditSave = async (result: { blob?: Blob, rotation?: number }) => {
    if (!activePost || !currentUserMode.userId) return;
    setIsEditing(false);
    try {
        const updates: Partial<CommunityPost> = {};
        
        const hasMultipleItems = activePost.items && activePost.items.length > 0;
        const currentItem = hasMultipleItems ? activePost.items![activeItemIndex] : activePost;

        let newUrl: string | undefined;
        if (result.blob) {
            newUrl = await FirebaseService.uploadMedia(result.blob, currentUserMode.userId, currentItem.mediaType as any);
        }

        if (hasMultipleItems) {
            const newItems = [...activePost.items!];
            if (newUrl) {
                if (currentItem.mediaType === 'video') newItems[activeItemIndex].videoUrl = newUrl;
                else if (currentItem.mediaType === 'audio') newItems[activeItemIndex].audioUrl = newUrl;
                else newItems[activeItemIndex].imageUrl = newUrl;
            }
            if (result.rotation !== undefined) {
                newItems[activeItemIndex].rotation = result.rotation;
            }
            updates.items = newItems;
            
            // If editing the first item, also update the primary fields
            if (activeItemIndex === 0) {
                if (newUrl) {
                    if (currentItem.mediaType === 'video') updates.videoUrl = newUrl;
                    else if (currentItem.mediaType === 'audio') updates.audioUrl = newUrl;
                    else updates.imageUrl = newUrl;
                }
                if (result.rotation !== undefined) {
                    updates.rotation = result.rotation;
                }
            }
        } else {
            if (newUrl) {
                if (activePost.mediaType === 'video') updates.videoUrl = newUrl;
                else if (activePost.mediaType === 'audio') updates.audioUrl = newUrl;
                else updates.imageUrl = newUrl;
            }
            if (result.rotation !== undefined) {
                updates.rotation = result.rotation;
            }
        }

        if (Object.keys(updates).length > 0) {
            await FirebaseService.updatePost(activePost.id, updates);
            setActivePost(prev => prev ? { ...prev, ...updates } : null);
        }
    } catch (e) {
        console.error("Failed to update post", e);
        alert("Failed to save edits.");
    }
  };

  const handleTagClick = (tag: string) => {
      const cleanTag = (tag.startsWith('#') ? tag.slice(1) : tag).toLowerCase();
      setSearchTag(cleanTag);
      setFeedMode('foryou');
      track('tag_open', { tag: cleanTag });
      closeDetail();
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearSearch = () => {
      setSearchTag(null);
  };

  const onImageLoad = (postId: string) => {
    setLoadedImages(prev => ({ ...prev, [postId]: true }));
  };

  return (
    <div id="community-scroll-container" className="w-full relative min-h-screen max-h-screen overflow-y-auto no-scrollbar scroll-smooth">
        {/* Advanced Species Intelligence Modal */}
        {selectedSpecies && (
            <div className="fixed inset-0 z-[400] flex items-center justify-center p-6 animate-fade-in">
                <div className="absolute inset-0 bg-theme-shadow/80 backdrop-blur-sm" onClick={() => setSelectedSpecies(null)}></div>
                <div className="relative w-full max-w-lg bg-day-bg rounded-3xl overflow-hidden shadow-2xl animate-slide-up border border-theme-primary/10 flex flex-col max-h-[80vh]">
                    <div className="p-6 md:p-8 shrink-0 flex items-center justify-between border-b border-theme-primary/10">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                                <span className="material-symbols-outlined text-2xl">pest_control</span>
                            </div>
                            <div>
                                <h3 className="text-xl font-display font-black italic text-theme-primary tracking-tight">{selectedSpecies.name}</h3>
                                <p className="text-xs font-black uppercase tracking-widest text-theme-primary/50 flex items-center gap-1 mt-0.5">
                                    <span className="material-symbols-outlined text-xs">public</span>
                                    {selectedSpecies.location}
                                </p>
                            </div>
                        </div>
                        <button onClick={() => setSelectedSpecies(null)} className="text-theme-primary/60 hover:text-theme-primary transition-colors">
                            <span className="material-symbols-outlined text-2xl">close</span>
                        </button>
                    </div>
                    
                    <div className="p-6 md:p-8 overflow-y-auto hidden-scrollbar flex-1">
                        {speciesData?.loading ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-4">
                                <span className="material-symbols-outlined text-4xl text-theme-accent animate-spin">sync</span>
                                <p className="text-stone-600 text-sm" role="status">Looking up {selectedSpecies.name}…</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-6">
                                {speciesData?.thumbnail && (
                                    <div className="w-full aspect-[16/9] rounded-2xl overflow-hidden shadow-inner border border-theme-primary/10 shrink-0">
                                        <img src={speciesData.thumbnail} className="w-full h-full object-cover" alt={selectedSpecies.name} />
                                    </div>
                                )}
                                <div className="space-y-4">
                                    <p className="catalog-label text-xs font-black tracking-[0.2em] text-theme-primary uppercase flex items-center gap-1.5 opacity-60">
                                        <span className="material-symbols-outlined text-xs">science</span>
                                        Encyclopedia Data
                                    </p>
                                    <p className="text-theme-primary/80 font-serif leading-relaxed text-sm text-justify">
                                        {speciesData?.extract}
                                    </p>
                                </div>
                                <p className="text-xs text-stone-500">
                                    Source: Wikipedia{(speciesData as any)?.url && <> · <a href={(speciesData as any).url} target="_blank" rel="noopener noreferrer" className="underline">Read more</a></>}. Sighted near {selectedSpecies.location}.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Custom Confirmation Modal */}
        {confirmDeleteId && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 animate-fade-in">
                <div className="absolute inset-0 bg-theme-shadow/80 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)}></div>
                <div className="relative w-full max-w-sm bg-white rounded-[2.5rem] p-8 shadow-2xl animate-slide-up border border-theme-primary/10">
                    <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mb-6 mx-auto">
                        <span className="material-symbols-outlined text-3xl">delete_forever</span>
                    </div>
                    <h3 className="text-2xl font-display font-black italic text-theme-primary text-center mb-3">Discard Specimen?</h3>
                    <p className="text-sm text-theme-primary/60 text-center leading-relaxed mb-8">
                        This observation will be permanently removed from the Living Field Guide and your personal archive.
                    </p>
                    <div className="flex flex-col gap-3">
                        <button 
                            onClick={executeDelete}
                            className="w-full py-4 bg-red-600 text-white font-black text-xs uppercase tracking-widest rounded-full shadow-lg shadow-red-500/20 active:scale-95 transition-all"
                        >
                            Confirm Deletion
                        </button>
                        <button 
                            onClick={() => setConfirmDeleteId(null)}
                            className="w-full py-4 bg-theme-primary/5 text-theme-primary/60 font-black text-xs uppercase tracking-widest rounded-full active:scale-95 transition-all"
                        >
                            Keep Observation
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Instagram/Explore Inspired Search Header */}
        <div className="w-full px-4 md:px-12 pt-10 pb-6 flex flex-col gap-5 animate-fade-in border-b border-theme-primary/10 select-none relative z-50">
            {/* Header branding & stats */}
            <div className="flex items-center justify-between gap-4">
                <button
                    type="button"
                    onClick={() => onLogoClick?.()}
                    aria-label={isJournalOnly ? 'Scroll to top of journal' : 'NatureGram, scroll to top'}
                    className="text-left hover:opacity-80 active:scale-95 transition-all rounded-lg"
                >
                    <h2 className="text-2xl md:text-3xl font-display font-black italic text-theme-primary tracking-tight">
                        {isJournalOnly ? "My Journal" : "NatureGram"}
                    </h2>
                    <p className="text-xs font-bold text-theme-primary/70 uppercase tracking-widest mt-0.5">
                        {isJournalOnly ? "Every sighting you've made" : "Living field guide"}
                    </p>
                </button>

                {/* Drafts Drawer Toggle Button */}
                <div className="flex items-center gap-3">
                    {onViewDrafts && (
                        <button 
                            onClick={onViewDrafts} 
                            className="relative w-10 h-10 rounded-full bg-stone-100 border border-theme-primary/5 hover:bg-stone-200/50 flex items-center justify-center text-theme-accent active:scale-95 transition-all"
                            aria-label={activeDraftsCount > 0 ? `Drafts, ${activeDraftsCount} unfinished` : 'Drafts'}
                        >
                            <span className="material-symbols-outlined text-lg">inventory</span>
                            {activeDraftsCount > 0 ? (
                                <span className="absolute -top-1 -right-1 w-4 h-4 bg-theme-accent rounded-full border border-white flex items-center justify-center text-[11px] font-bold text-white animate-pulse">
                                    {activeDraftsCount}
                                </span>
                            ) : null}
                        </button>
                    )}
                </div>
            </div>

            {!isJournalOnly && (
                <div className="flex items-center gap-2" role="tablist" aria-label="Feed">
                    {([['foryou', 'For you'], ['following', 'Following']] as const).map(([key, label]) => (
                        <button
                            key={key}
                            role="tab"
                            aria-selected={feedMode === key}
                            onClick={() => {
                                if (key === 'following' && !isMember) { askAccount('Create a free account to follow explorers and build your own feed.'); return; }
                                setFeedMode(key);
                            }}
                            className={`px-4 py-2 rounded-full text-sm font-bold transition-colors ${feedMode === key ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}
                        >{label}</button>
                    ))}
                </div>
            )}

            {freshRail.length > 0 && feedMode === 'foryou' && (
                <section aria-label="Fresh sightings from explorers you follow">
                    <p className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Fresh from explorers you follow</p>
                    <ul className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1" role="list">
                        {freshRail.map(r => (
                            <li key={r.userId} className="shrink-0">
                                <button onClick={() => handlePostClick(r.post)} className="flex flex-col items-center gap-1 w-[72px]" aria-label={`${r.userName}: ${r.count} new sighting${r.count === 1 ? '' : 's'}`}>
                                    <span className="p-[3px] rounded-full bg-gradient-to-tr from-theme-primary to-theme-vivid">
                                        <span className="block p-[2px] bg-day-bg rounded-full">
                                            {r.post.thumbnailUrl || r.avatar
                                                ? <img src={(r.avatar || r.post.thumbnailUrl)!} alt="" className="w-14 h-14 rounded-full object-cover" />
                                                : <span className="w-14 h-14 rounded-full bg-theme-primary/10 flex items-center justify-center font-bold text-theme-primary">{r.userName?.charAt(0)}</span>}
                                        </span>
                                    </span>
                                    <span className="text-xs text-stone-700 truncate w-full text-center">{r.userName}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {!isJournalOnly && dailyTheme?.naturalist && (
                <button
                    type="button"
                    onClick={() => { setSearchQuery(themeExtra.challengeTag); setFeedMode('foryou'); }}
                    className="w-full text-left rounded-2xl p-4 bg-gradient-to-r from-theme-primary to-theme-primary-gradient text-white shadow-md flex items-start gap-3 active:scale-[0.99] transition-transform"
                >
                    <span className="material-symbols-outlined text-2xl shrink-0 mt-0.5" aria-hidden="true">flag</span>
                    <span className="flex-1 min-w-0">
                        <span className="block text-[11px] font-bold uppercase tracking-[0.18em] text-white/80">{dailyTheme.naturalist}'s fortnight · {themePeriod.daysRemaining}d left</span>
                        <span className="block text-sm font-semibold leading-snug mt-1">{themeExtra.challenge}</span>
                        <span className="block text-xs text-white/80 mt-1">See posts tagged {themeExtra.challengeTag} →</span>
                    </span>
                </button>
            )}

            {/* Instagram Search Input with Cancel State transition */}
            <div className="relative flex flex-col gap-3">
                {/* Backdrop overlay for focus state to make UX clean, elegant and focused */}
                {isSearchFocused && (
                    <div 
                        className="fixed inset-0 bg-stone-950/10 backdrop-blur-[2px] z-[150] transition-opacity duration-300 pointer-events-auto" 
                        onClick={() => setIsSearchFocused(false)}
                    />
                )}

                <div className={`flex items-center gap-3 relative ${isSearchFocused ? 'z-[160]' : ''}`}>
                    <div className="relative flex-1">
                        <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-theme-primary/55 text-lg font-bold select-none">
                            search
                        </span>
                        <input 
                            type="text"
                            value={searchQuery}
                            onFocus={() => {
                                setIsSearchFocused(true);
                                setShowFilters(false);
                            }}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            aria-label={isJournalOnly ? 'Search your journal' : 'Search sightings, species, places and explorers'}
                            placeholder={isJournalOnly ? "Search your journal…" : "Search species, places, explorers…"}
                            className="w-full pl-11 pr-11 py-3 bg-stone-100 hover:bg-stone-200/50 focus:bg-white text-sm text-theme-primary placeholder-theme-primary/40 rounded-2xl border-none outline-none focus:ring-2 focus:ring-theme-accent/20 transition-all font-sans font-medium"
                        />
                        {searchQuery && (
                            <button 
                                onClick={() => setSearchQuery("")}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-theme-primary/55 hover:text-theme-primary transition-colors flex items-center justify-center p-1"
                            >
                                <span className="material-symbols-outlined text-sm font-bold">close</span>
                            </button>
                        )}
                    </div>

                    {/* Instagram native focused Cancel CTA button */}
                    {isSearchFocused && (
                        <button 
                            onClick={() => {
                                setIsSearchFocused(false);
                                setSearchQuery("");
                            }}
                            className="text-[11px] font-black text-theme-accent uppercase tracking-wider hover:opacity-70 transition-all cursor-pointer animate-fade-in px-1"
                        >
                            Cancel
                        </button>
                    )}

                    {/* Minimal Inline filter toggle button */}
                    <button 
                        onClick={() => {
                            setShowFilters(!showFilters);
                            setIsSearchFocused(false);
                        }}
                        className={`p-3 px-4 rounded-2xl border border-none transition-all flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider cursor-pointer ${
                            showFilters || mediaFilter !== 'all' || dateFilter !== 'all' || selectedLabels.length > 0 || searchTag
                                ? 'bg-theme-accent/15 text-theme-accent' 
                                : 'bg-stone-100 text-theme-primary/60 hover:bg-stone-200/50'
                        }`}
                    >
                        <span className="material-symbols-outlined text-base" aria-hidden="true">tune</span>
                        <span className="hidden sm:inline">Filters</span><span className="sr-only sm:hidden">Filters</span>
                    </button>
                </div>

                {/* Instagram Search Suggestions dropdown menu overlay */}
                {isSearchFocused && (
                    <div className="absolute top-[105%] left-0 right-0 bg-white border border-theme-primary/10 rounded-2xl p-5 shadow-2xl animate-slide-up flex flex-col gap-5 max-h-[380px] overflow-y-auto no-scrollbar z-[160]">
                        <div className="flex items-center justify-between border-b border-theme-primary/5 pb-2">
                            <span className="text-xs font-black uppercase text-theme-primary/60 tracking-wider">Suggested Searches & Accounts</span>
                            <button 
                                onClick={() => setIsSearchFocused(false)} 
                                className="text-xs font-black text-theme-primary/55 hover:text-theme-primary uppercase"
                            >
                                Hide
                            </button>
                        </div>

                        {searchQuery.trim().length >= 2 && !isJournalOnly && (
                            <div className="space-y-2">
                                <button
                                    onClick={() => { const t = searchQuery.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, ''); setSearchTag(t); setSearchQuery(''); setIsSearchFocused(false); setFeedMode('foryou'); }}
                                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-stone-50 hover:bg-stone-100 text-left"
                                >
                                    <span className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-stone-700" aria-hidden="true"><span className="material-symbols-outlined">tag</span></span>
                                    <span><span className="block font-semibold text-stone-900">Search all posts for #{searchQuery.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '')}</span><span className="block text-xs text-stone-500">Searches every public sighting, not just loaded ones</span></span>
                                </button>
                                {serverUsers.length > 0 && (
                                    <div>
                                        <p className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5">Accounts</p>
                                        {serverUsers.map(u => (
                                            <button key={u.uid} onClick={() => { setIsSearchFocused(false); onViewProfile?.(u.uid); }} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-stone-50 text-left">
                                                {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" /> : <span className="w-10 h-10 rounded-full bg-theme-primary/10 flex items-center justify-center font-bold text-theme-primary" aria-hidden="true">{u.username?.charAt(0).toUpperCase()}</span>}
                                                <span className="min-w-0"><span className="block font-semibold text-stone-900 truncate">{u.username}</span><span className="block text-xs text-stone-500 truncate">{u.bio || `${u.stats?.species || 0} species recorded`}</span></span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Species & Hashtags Suggestions */}
                        {dynamicSuggestions.tags.length > 0 && (
                            <div className="space-y-2">
                                <span className="text-[11px] font-black uppercase tracking-widest text-theme-primary/60 flex items-center gap-1">
                                    <span className="material-symbols-outlined text-xs text-theme-accent">local_offer</span>
                                    Popular Tags
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                    {dynamicSuggestions.tags.map((tag) => (
                                        <button
                                            key={tag}
                                            onClick={() => {
                                                setSearchQuery(tag.startsWith('#') ? tag : `#${tag}`);
                                                setIsSearchFocused(false);
                                            }}
                                            className="px-3 py-1.5 bg-stone-50 hover:bg-theme-accent/5 hover:text-theme-accent border border-theme-primary/5 text-xs font-black uppercase tracking-wider rounded-lg transition-all text-theme-primary/60"
                                        >
                                            {tag}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Creators & Observers list like IG find accounts */}
                        {dynamicSuggestions.creators.length > 0 && !isJournalOnly && (
                            <div className="space-y-2.5">
                                <span className="text-[11px] font-black uppercase tracking-widest text-theme-primary/60 flex items-center gap-1">
                                    <span className="material-symbols-outlined text-xs text-theme-accent">alternate_email</span>
                                    Observers
                                </span>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {dynamicSuggestions.creators.map((name) => (
                                        <button
                                            key={name}
                                            onClick={() => {
                                                setSearchQuery(name);
                                                setIsSearchFocused(false);
                                            }}
                                            className="flex items-center gap-2 p-2 rounded-xl bg-stone-50 hover:bg-stone-100 transition-all text-left text-xs text-theme-primary font-semibold"
                                        >
                                            <div className="w-6 h-6 rounded-full bg-theme-primary/10 flex items-center justify-center text-xs font-black text-theme-primary">
                                                {name.slice(0, 2).toUpperCase()}
                                            </div>
                                            <span className="truncate">@{name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Recent Habitats & Places suggestions */}
                        {dynamicSuggestions.locations.length > 0 && (
                            <div className="space-y-2.5">
                                <span className="text-[11px] font-black uppercase tracking-widest text-theme-primary/60 flex items-center gap-1">
                                    <span className="material-symbols-outlined text-xs text-theme-accent">distance</span>
                                    Recent Habitats
                                </span>
                                <div className="flex flex-wrap gap-2">
                                    {dynamicSuggestions.locations.map((loc) => (
                                        <button
                                            key={loc}
                                            onClick={() => {
                                                setSearchQuery(loc);
                                                setIsSearchFocused(false);
                                            }}
                                            className="text-xs text-theme-primary/70 hover:text-theme-accent font-sans font-medium flex items-center gap-1 bg-stone-50 p-1.5 px-3 rounded-lg hover:bg-stone-100"
                                        >
                                            <span className="material-symbols-outlined text-xs select-none">place</span>
                                            {loc}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Dynamic Collapsible Advanced Filters Drawer */}
                {showFilters && (
                    <div className="p-6 bg-white border border-theme-primary/10 rounded-2xl flex flex-col gap-5 animate-slide-up shadow-md">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                            {/* Format Filter */}
                            <div className="space-y-2.5">
                                <label className="block text-[11px] font-black uppercase tracking-wider text-theme-primary/60">Category Format</label>
                                <div className="grid grid-cols-4 gap-1 bg-stone-100 p-1 rounded-xl">
                                    {(['all', 'image', 'video', 'audio'] as const).map((media) => (
                                        <button
                                            key={media}
                                            onClick={() => setMediaFilter(media)}
                                            className={`py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${
                                                mediaFilter === media 
                                                    ? 'bg-theme-primary text-white font-black shadow-sm' 
                                                    : 'text-theme-primary/50 hover:text-theme-primary'
                                            }`}
                                        >
                                            {media === 'all' ? 'All' : media}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Timeline Filter */}
                            <div className="space-y-2.5">
                                <label className="block text-[11px] font-black uppercase tracking-wider text-theme-primary/60">Timeline Range</label>
                                <div className="grid grid-cols-4 gap-1 bg-stone-100 p-1 rounded-xl">
                                    {(['all', 'today', 'week', 'month'] as const).map((opt) => (
                                        <button
                                            key={opt}
                                            onClick={() => setDateFilter(opt)}
                                            className={`py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${
                                                dateFilter === opt 
                                                    ? 'bg-theme-primary text-white font-black shadow-sm' 
                                                    : 'text-theme-primary/50 hover:text-theme-primary'
                                            }`}
                                        >
                                            {opt === 'all' ? 'All' : opt === 'today' ? 'Today' : opt === 'week' ? '1Wk' : '1Mo'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Ordering Selection */}
                            <div className="space-y-2.5">
                                <label className="block text-[11px] font-black uppercase tracking-wider text-theme-primary/60">Sort Sequence</label>
                                <div className="grid grid-cols-3 gap-1 bg-stone-100 p-1 rounded-xl">
                                    {(['newest', 'likes', 'title'] as const).map((opt) => (
                                        <button
                                            key={opt}
                                            onClick={() => setSortOrder(opt)}
                                            className={`py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${
                                                sortOrder === opt 
                                                    ? 'bg-theme-primary text-white font-black shadow-sm' 
                                                    : 'text-theme-primary/50 hover:text-theme-primary'
                                            }`}
                                        >
                                            {opt === 'newest' ? 'Newest' : opt === 'likes' ? 'Likes' : 'A-Z'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Species taxonomic selection */}
                        {allAvailableLabels.length > 0 && (
                            <div className="space-y-2 pt-2 border-t border-theme-primary/5">
                                <label className="block text-[11px] font-black uppercase tracking-wider text-theme-primary/60">Filter Specific Taxons Native</label>
                                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto pr-2 no-scrollbar">
                                    {allAvailableLabels.map((lbl) => {
                                        const isSelected = selectedLabels.includes(lbl);
                                        return (
                                            <button
                                                key={lbl}
                                                onClick={() => toggleLabelFilter(lbl)}
                                                className={`px-2.5 py-1 text-[11px] font-black uppercase tracking-widest rounded-full border transition-all ${
                                                    isSelected 
                                                        ? 'bg-theme-accent border-theme-accent text-white font-bold' 
                                                        : 'bg-white border-theme-primary/10 text-theme-primary/60 hover:bg-stone-50'
                                                }`}
                                            >
                                                {lbl}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Instagram Horizontal Sticky Category Stories/Reels Navigation Pills */}
            <div className="w-full overflow-x-auto no-scrollbar flex items-center gap-1.5 py-1 -mx-4 px-4 scroll-smooth">
                {[
                    { id: 'all', label: 'All', icon: '✨' },
                    { id: 'fauna', label: 'Animals', icon: '🐦' },
                    { id: 'flora', label: 'Plants', icon: '🌿' },
                    { id: 'fungi', label: 'Fungi', icon: '🍄' },
                    { id: 'audio', label: 'Sounds', icon: '🎙️' },
                    { id: 'video', label: 'Videos', icon: '🎥' },
                    { id: 'popular', label: 'Popular', icon: '🔥' },
                ].map((tab) => {
                    const isActive = activeExploreTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setActiveExploreTab(tab.id as any);
                                hapticFeedback();
                            }}
                            className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-full transition-all shrink-0 flex items-center gap-1.5 border cursor-pointer ${
                                isActive 
                                    ? 'bg-theme-primary text-white border-theme-primary shadow-lg shadow-theme-primary/10 scale-[1.03]' 
                                    : 'bg-stone-50 border-theme-primary/5 hover:border-theme-primary/10 text-theme-primary/60 hover:bg-stone-100'
                            }`}
                        >
                            <span aria-hidden="true">{tab.icon}</span>
                            <span>{tab.label}</span>
                        </button>
                    );
                })}
            </div>

            {searchTag && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-sky-50 border border-sky-100 rounded-2xl">
                    <p className="text-sm text-sky-900">Showing all posts tagged <strong>#{searchTag}</strong></p>
                    <button onClick={() => setSearchTag(null)} className="text-sm font-bold text-sky-900">Clear</button>
                </div>
            )}

            {/* Reset status bar if any dynamic filter keyword is active */}
            {(searchQuery.trim() || activeExploreTab !== 'all' || mediaFilter !== 'all' || dateFilter !== 'all' || selectedLabels.length > 0 || searchTag) && (
                <div className="flex items-center justify-between gap-3 p-3 bg-stone-50 border border-theme-primary/5 rounded-2xl">
                    <div className="text-xs font-black text-theme-primary/60 uppercase tracking-widest flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-theme-accent rounded-full animate-pulse"></span>
                        <span>Filters on{posts.length && !isJournalOnly ? ` · searching ${posts.length} loaded posts` : ''}</span>
                    </div>
                    <button 
                        onClick={resetAllFilters}
                        className="text-[11px] font-black uppercase tracking-wider text-theme-accent hover:opacity-80 transition-all flex items-center gap-1 cursor-pointer"
                    >
                        <span className="material-symbols-outlined text-xs font-bold">restart_alt</span>
                        Clear
                    </button>
                </div>
            )}
        </div>

        <div className="w-full px-4 md:px-12 py-8">
            {isLoading ? (
                <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-2 md:gap-4 pb-56 space-y-2 md:space-y-4">
                    {[...Array(10)].map((_, i) => <SkeletonPost key={i} />)}
                </div>
            ) : error ? (
                <div role="alert" className="py-20 flex flex-col items-center justify-center text-center px-8 max-w-xl mx-auto my-12 animate-fade-in">
                    <span className="material-symbols-outlined text-5xl text-theme-primary/60 mb-6" aria-hidden="true">cloud_off</span>
                    <h3 className="text-xl font-display font-bold text-stone-900 mb-3">The field guide didn't load</h3>
                    <p className="text-stone-600 text-base max-w-sm mb-8 leading-relaxed">
                        {typeof navigator !== 'undefined' && navigator.onLine === false
                            ? "You appear to be offline. Check your connection and try again."
                            : "Something went wrong on our side. Please try again in a moment."}
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-8 py-3.5 bg-stone-900 text-white font-bold text-sm rounded-full shadow-lg active:scale-95 transition-all"
                    >
                        Try again
                    </button>
                </div>
            ) : filteredAndSortedPosts.length === 0 ? (
                <div className="py-24 sm:py-40 flex flex-col items-center justify-center text-center px-8">
                    <span className="material-symbols-outlined text-5xl text-theme-primary/20 mb-6 select-none">search_off</span>
                    {feedMode === 'following' && !searchQuery ? (
                        <>
                            <h3 className="text-lg font-display text-stone-800 mb-2 font-bold">Your following feed is quiet</h3>
                            <p className="text-base text-stone-600 max-w-xs mb-8">Follow explorers whose sightings inspire you. Open any post and tap their name.</p>
                            <button onClick={() => setFeedMode('foryou')} className="px-8 py-3.5 bg-stone-900 text-white font-bold text-sm rounded-full">Discover explorers</button>
                        </>
                    ) : (
                        <>
                            <h3 className="text-lg font-display text-stone-800 mb-2 font-bold">No sightings match</h3>
                            <p className="text-base text-stone-600 max-w-xs mb-8">Try a different word, or clear the filters.</p>
                            <button onClick={resetAllFilters} className="px-8 py-3.5 bg-stone-900 text-white font-bold text-sm rounded-full">Clear filters</button>
                        </>
                    )}
                </div>
            ) : (
                <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-2 md:gap-4 space-y-2 md:space-y-4">
                    {filteredAndSortedPosts.map((post) => (
                        <FeedCard 
                            key={post.id} 
                            post={post} 
                            onPostClick={handlePostClick} 
                            loadedImages={loadedImages} 
                            onImageLoad={onImageLoad} 
                        />
                    ))}
                </div>
            )}
            {!isLoading && !error && filteredAndSortedPosts.length > 0 && (
                <div ref={loadMoreRef} className="py-8 pb-40 flex justify-center text-sm text-stone-500" aria-live="polite">
                    {loadMoreState === 'loading' ? (
                        <span className="flex items-center gap-2"><span className="material-symbols-outlined animate-spin" aria-hidden="true">progress_activity</span>Loading more sightings…</span>
                    ) : loadMoreState === 'error' ? (
                        <button onClick={() => { setLoadMoreState('idle'); loadMore(); }} className="font-semibold text-theme-accent">Couldn't load more. Tap to retry</button>
                    ) : !hasMore && !isJournalOnly ? (
                        <span>You're all caught up 🌿</span>
                    ) : null}
                </div>
            )}
        </div>

        <AnimatePresence>
        {activePost && (
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.2 }}
                onTouchStart={handleSwipeTouchStart}
                onTouchEnd={handleSwipeTouchEnd}
                className="fixed inset-0 z-[150] bg-white md:bg-theme-shadow flex flex-col h-full w-full overflow-hidden"
            >
                <header className="h-16 px-3 flex items-center justify-between bg-white border-b border-theme-primary/10 shrink-0 z-[160] shadow-sm safe-pt box-content">
                    <button onClick={closeDetail} aria-label={`Back to ${isJournalOnly ? 'journal' : (searchTag ? 'search' : backLabel.toLowerCase())}`} className="flex items-center gap-2 transition-all active:scale-95 h-11 pr-3 rounded-full">
                        <span className="material-symbols-outlined text-stone-800 text-2xl" aria-hidden="true">arrow_back</span>
                        <span className="text-sm font-bold text-stone-800">{isJournalOnly ? 'Journal' : (searchTag ? 'Search' : backLabel)}</span>
                    </button>

                    {/* Desktop floating navigation chevrons - replacing top header numbered pagination */}
                    {activePostIndex > 0 && (
                        <button 
                            onClick={() => navigateSequential('prev')}
                            className="fixed left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/90 hover:bg-white text-stone-800 flex items-center justify-center shadow-lg border border-stone-100 z-[180] active:scale-95 transition-all text-xl font-black md:flex hidden"
                            aria-label="Previous post"
                        >
                            <span className="material-symbols-outlined text-3xl font-extrabold text-stone-700">chevron_left</span>
                        </button>
                    )}
                    {activePostIndex !== -1 && activePostIndex < posts.length - 1 && (
                        <button 
                            onClick={() => navigateSequential('next')}
                            className="fixed right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/90 hover:bg-white text-stone-800 flex items-center justify-center shadow-lg border border-stone-100 z-[180] active:scale-95 transition-all text-xl font-black md:flex hidden"
                            aria-label="Next post"
                        >
                            <span className="material-symbols-outlined text-3xl font-extrabold text-stone-700">chevron_right</span>
                        </button>
                    )}

                    <div className="flex items-center gap-1 relative">
                        <button onClick={() => setPostMenuOpen(o => !o)} aria-label="More options" aria-expanded={postMenuOpen} className="w-11 h-11 rounded-full flex items-center justify-center text-stone-700 hover:bg-stone-100">
                            <span className="material-symbols-outlined" aria-hidden="true">more_horiz</span>
                        </button>
                        {postMenuOpen && (
                            <div role="menu" className="absolute right-0 top-12 w-60 bg-white rounded-2xl shadow-2xl border border-stone-100 p-1.5 z-[200] animate-fade-in">
                                {activePost.userId === currentUserMode.userId ? (
                                    <>
                                        {(((activePost.items && activePost.items[activeItemIndex]) || activePost).mediaType !== 'audio') && (
                                            <button role="menuitem" onClick={() => { setPostMenuOpen(false); setIsEditing(true); }} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-stone-50 flex items-center gap-3 text-sm font-semibold"><span className="material-symbols-outlined text-xl" aria-hidden="true">tune</span>{((activePost.items && activePost.items[activeItemIndex]) || activePost).mediaType === 'video' ? 'Rotate video' : 'Edit photo'}</button>
                                        )}
                                        <button role="menuitem" onClick={async () => { setPostMenuOpen(false); const next = !activePost.isPublic; try { await FirebaseService.updatePost(activePost.id, { isPublic: next } as any); setActivePost(p => p ? { ...p, isPublic: next } : p); showToast(next ? 'Now visible in the feed' : 'Now only in your journal'); } catch { showToast('Could not change visibility.'); } }} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-stone-50 flex items-center gap-3 text-sm font-semibold"><span className="material-symbols-outlined text-xl" aria-hidden="true">{activePost.isPublic ? 'lock' : 'public'}</span>{activePost.isPublic ? 'Make journal-only' : 'Share to feed'}</button>
                                        <button role="menuitem" onClick={() => { setPostMenuOpen(false); setPublishingPost(activePost); }} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-stone-50 flex items-center gap-3 text-sm font-semibold"><span className="material-symbols-outlined text-xl" aria-hidden="true">campaign</span>Share to other apps</button>
                                        <button role="menuitem" onClick={() => { setPostMenuOpen(false); handleDeletePost(activePost.id); }} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-red-50 text-red-700 flex items-center gap-3 text-sm font-semibold"><span className="material-symbols-outlined text-xl" aria-hidden="true">delete</span>Delete post</button>
                                    </>
                                ) : (
                                    <>
                                        <button role="menuitem" onClick={() => { setPostMenuOpen(false); handleProfileClick(activePost.userId); }} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-stone-50 flex items-center gap-3 text-sm font-semibold"><span className="material-symbols-outlined text-xl" aria-hidden="true">person</span>View {activePost.userName}</button>
                                        <button role="menuitem" onClick={() => { setPostMenuOpen(false); setReportOpen(true); }} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-red-50 text-red-700 flex items-center gap-3 text-sm font-semibold"><span className="material-symbols-outlined text-xl" aria-hidden="true">flag</span>Report post</button>
                                        <button role="menuitem" onClick={handleBlockAuthor} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-red-50 text-red-700 flex items-center gap-3 text-sm font-semibold"><span className="material-symbols-outlined text-xl" aria-hidden="true">block</span>Block {activePost.userName}</button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </header>

                <motion.div 
                    key={activePost.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.25 }}
                    ref={mainScrollRef}
                    className="flex-1 flex flex-col md:flex-row overflow-hidden bg-white w-full h-full"
                >
                    {(() => {
                        const currentItem = activePost.items && activePost.items.length > 0 ? activePost.items[activeItemIndex] : activePost;
                        const hasMultipleItems = activePost.items && activePost.items.length > 1;
                        
                        return (
                            <>
                                <div
                                    className="flex-1 min-h-0 bg-theme-primary/5 flex flex-col justify-center relative group/media overflow-hidden"
                                    onClick={(e) => { if ((e.target as HTMLElement).closest('button,video,audio')) return; handleDoubleTap(e, activePost); }}
                                >
                                    {showHeartAnimation && (
                                        <span className="pointer-events-none absolute inset-0 z-[190] flex items-center justify-center" aria-hidden="true">
                                            <span className="material-symbols-outlined text-white text-[120px] drop-shadow-2xl animate-heart-burst" style={{ fontVariationSettings: "'FILL' 1" }}>favorite</span>
                                        </span>
                                    )}
                                    {hasMultipleItems ? (
                                        <>
                                            <div 
                                                ref={mediaScrollRef}
                                                onScroll={handleMediaScroll}
                                                className="flex flex-row overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar w-full h-[60dvh] md:h-[65dvh] relative"
                                            >
                                                {activePost.items!.map((item, index) => (
                                                    <div key={index} className="w-full h-full shrink-0 snap-center flex items-center justify-center relative p-4 bg-transparent select-none">
                                                        {item.mediaType === 'video' ? (
                                                            <video 
                                                                src={item.videoUrl} 
                                                                poster={item.thumbnailUrl} 
                                                                controls 
                                                                playsInline 
                                                                preload='metadata' 
                                                                className="w-full h-full md:w-auto md:h-auto md:max-w-full md:max-h-full rounded-none md:rounded-2xl object-contain drop-shadow-none md:drop-shadow-xl"
                                                            />
                                                        ) : item.mediaType === 'audio' ? (
                                                            <div className="flex flex-col items-center justify-center w-full h-full gap-4 p-4 md:p-4 max-w-full max-h-full">
                                                                {item.thumbnailUrl || item.imageUrl ? (
                                                                    <img 
                                                                        src={item.thumbnailUrl || item.imageUrl} 
                                                                        className="w-full h-full md:w-auto md:h-auto md:max-w-full flex-1 min-h-0 object-contain rounded-none md:rounded-2xl drop-shadow-none md:drop-shadow-xl"
                                                                    />
                                                                ) : (
                                                                    <div className="flex-1 min-h-0 aspect-square max-h-full w-full max-w-full bg-gray-900 rounded-2xl flex items-center justify-center drop-shadow-xl">
                                                                        <span className="material-symbols-outlined text-white text-6xl opacity-50">music_note</span>
                                                                    </div>
                                                                )}
                                                                <audio src={item.audioUrl} controls className="w-full max-w-md shrink-0 shadow-lg rounded-full" />
                                                            </div>
                                                        ) : (
                                                            <img 
                                                                src={item.imageUrl || item.thumbnailUrl} 
                                                                alt={item.labels?.[0] ? `${item.labels[0]}${item.behavior ? `: ${item.behavior}` : ''}` : 'Sighting'}
                                                                className="w-full h-full md:w-auto md:h-auto md:max-w-full md:max-h-full object-contain rounded-none md:rounded-2xl drop-shadow-none md:drop-shadow-xl"
                                                            />
                                                        )}
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Left Arrow overlay visible on hover */}
                                            {activeItemIndex > 0 && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); scrollToItem(activeItemIndex - 1); }}
                                                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center opacity-80 md:opacity-0 md:group-hover/media:opacity-100 transition-opacity z-[175] active:scale-95 pointer-events-auto"
                                                >
                                                    <span className="material-symbols-outlined text-xl">chevron_left</span>
                                                </button>
                                            )}

                                            {/* Right Arrow overlay visible on hover */}
                                            {activeItemIndex < (activePost.items?.length || 1) - 1 && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); scrollToItem(activeItemIndex + 1); }}
                                                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center opacity-80 md:opacity-0 md:group-hover/media:opacity-100 transition-opacity z-[175] active:scale-95 pointer-events-auto"
                                                >
                                                    <span className="material-symbols-outlined text-xl">chevron_right</span>
                                                </button>
                                            )}

                                            {/* Subtle Overlay Dots centered near bottom */}
                                            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-0.5 z-[175] px-1 rounded-full bg-black/25 backdrop-blur-sm">
                                                {activePost.items!.map((_, index) => (
                                                    <button
                                                        key={index}
                                                        onClick={() => scrollToItem(index)}
                                                        aria-label={`Show item ${index + 1} of ${activePost.items!.length}`}
                                                        aria-current={index === activeItemIndex}
                                                        className="w-6 h-6 flex items-center justify-center"
                                                    ><span className={`block w-2 h-2 rounded-full transition-all duration-300 ${index === activeItemIndex ? 'bg-white' : 'bg-white/50'}`} /></button>
                                                ))}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center p-4">
                                            {currentItem.mediaType === 'video' ? (
                                                <video 
                                                    src={currentItem.videoUrl} 
                                                    poster={currentItem.thumbnailUrl} 
                                                    controls 
                                                    playsInline 
                                                    preload='metadata' 
                                                    className="w-full h-full md:w-auto md:h-auto md:max-w-full md:max-h-full rounded-none md:rounded-2xl object-contain drop-shadow-none md:drop-shadow-xl"
                                                />
                                            ) : currentItem.mediaType === 'audio' ? (
                                                <div className="flex flex-col items-center justify-center w-full h-full gap-4 p-4 md:p-4 max-w-full max-h-full">
                                                    {currentItem.thumbnailUrl || currentItem.imageUrl ? (
                                                        <img 
                                                            src={currentItem.thumbnailUrl || currentItem.imageUrl} 
                                                            className="w-full h-full md:w-auto md:h-auto md:max-w-full flex-1 min-h-0 object-contain rounded-none md:rounded-2xl drop-shadow-none md:drop-shadow-xl"
                                                        />
                                                    ) : (
                                                        <div className="flex-1 min-h-0 aspect-square max-h-full w-full max-w-full bg-gray-900 rounded-2xl flex items-center justify-center drop-shadow-xl">
                                                            <span className="material-symbols-outlined text-white text-6xl opacity-50">music_note</span>
                                                        </div>
                                                    )}
                                                    <audio src={currentItem.audioUrl} controls className="w-full max-w-md shrink-0 shadow-lg rounded-full" />
                                                </div>
                                            ) : (
                                                <img 
                                                    src={currentItem.imageUrl || currentItem.thumbnailUrl} 
                                                    alt={currentItem.labels?.[0] ? `${currentItem.labels[0]}${currentItem.behavior ? `: ${currentItem.behavior}` : ''}` : 'Sighting'}
                                                    className="w-full h-full md:w-auto md:h-auto md:max-w-full md:max-h-full object-contain rounded-none md:rounded-2xl drop-shadow-none md:drop-shadow-xl"
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="w-full md:w-[400px] shrink-0 max-h-[45vh] md:max-h-none border-t md:border-t-0 md:border-l border-theme-primary/10 bg-white flex flex-col hidden-scrollbar">
                                    <div className="px-4 pt-3 pb-2 md:px-6 flex items-center justify-between shrink-0">
                                        <button className="flex items-center gap-3 group text-left min-w-0" onClick={() => handleProfileClick(activePost.userId)}>
                                            {activePost.userAvatar
                                                ? <img src={activePost.userAvatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                                                : <span className="w-10 h-10 rounded-full bg-theme-primary/10 flex items-center justify-center text-theme-primary font-bold text-sm uppercase" aria-hidden="true">{(activePost.userName || '?').charAt(0)}</span>}
                                            <span className="min-w-0">
                                                <span className="block font-bold text-sm text-stone-900 truncate group-hover:underline">{activePost.userName}</span>
                                                <span className="block text-xs text-stone-500 truncate">{[currentItem.locationArea, timeAgo(activePost.timestamp)].filter(Boolean).join(' · ')}</span>
                                            </span>
                                        </button>
                                    </div>
                                    <div className="px-2 md:px-4 flex items-center shrink-0 border-b border-theme-primary/5 pb-1">
                                        {(() => { const liked = !!activePost.likes?.includes(currentUserMode.userId!); return (
                                            <button onClick={(e) => handleLike(e, activePost)} aria-pressed={liked} aria-label={liked ? 'Unlike' : 'Like'} className={`w-11 h-11 rounded-full flex items-center justify-center transition-transform active:scale-90 ${liked ? 'text-red-600' : 'text-stone-800'}`}>
                                                <span className="material-symbols-outlined text-[28px]" style={liked ? { fontVariationSettings: "'FILL' 1" } : undefined} aria-hidden="true">favorite</span>
                                            </button>
                                        ); })()}
                                        <button onClick={() => setIsCommentsOpen(true)} aria-label="Comments" className="w-11 h-11 rounded-full flex items-center justify-center text-stone-800">
                                            <span className="material-symbols-outlined text-[28px]" aria-hidden="true">chat_bubble</span>
                                        </button>
                                        <button onClick={() => setSharingPost(activePost)} aria-label="Share" className="w-11 h-11 rounded-full flex items-center justify-center text-stone-800">
                                            <span className="material-symbols-outlined text-[28px]" aria-hidden="true">send</span>
                                        </button>
                                        <button onClick={handleSave} aria-pressed={isSaved} aria-label={isSaved ? 'Remove from saved' : 'Save'} className="ml-auto w-11 h-11 rounded-full flex items-center justify-center text-stone-800">
                                            <span className="material-symbols-outlined text-[28px]" style={isSaved ? { fontVariationSettings: "'FILL' 1" } : undefined} aria-hidden="true">bookmark</span>
                                        </button>
                                    </div>
                                    <p className="px-4 md:px-6 pt-2 text-sm font-bold text-stone-900 tabular">{(activePost.likes?.length || 0).toLocaleString()} {(activePost.likes?.length || 0) === 1 ? 'like' : 'likes'}</p>
                                    <div className="p-4 md:p-6 flex-1 overflow-y-auto hidden-scrollbar flex flex-col space-y-6">
                                        {activePost.caption && (
                                            <p className="text-[15px] text-stone-900 leading-relaxed whitespace-pre-line"><button onClick={() => handleProfileClick(activePost.userId)} className="font-bold mr-1.5">{activePost.userName}</button><RichText text={activePost.caption} onMention={openMention} onTag={handleTagClick} /></p>
                                        )}
                                        {activePost.title && <h2 className="text-xl font-display italic font-bold text-theme-primary">{activePost.title}</h2>}

                                        {activePost.description && (
                                            <p className="text-theme-primary/80 font-display font-medium leading-relaxed italic text-base">
                                                {activePost.description}
                                            </p>
                                        )}
                                        
                                        {(currentItem.labels?.length || currentItem.aiInsight) && (
                                            <div className="space-y-4 pt-2 border-t border-theme-primary/10">
                                                {currentItem.labels && currentItem.labels.length > 0 && (
                                                    <div className="space-y-2">
                                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                                            <p className="text-xs font-bold tracking-[0.15em] text-stone-600 uppercase">Identification</p>
                                                            <AiBadge confidence={(currentItem as any).aiConfidence} humanVerified={!!(currentItem as any).humanDelta || !!activePost.humanDelta} />
                                                        </div>
                                                        {isFungiPost(currentItem as any) && <FungiWarning />}
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {currentItem.labels.map((l, i) => (
                                                                <button key={i} onClick={() => handleSpeciesClick(l, currentItem.locationArea)} aria-label={`Learn about ${l}`} className="px-3 py-1.5 bg-theme-accent/10 border border-theme-accent/20 text-theme-primary font-bold text-sm rounded-lg hover:bg-theme-accent/20 transition-colors">
                                                                    {l}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {currentItem.aiInsight && (
                                                    <div className="p-5 bg-insight-bg border border-theme-accent/30 rounded-xl space-y-3">
                                                        <p className="catalog-label text-[11px] font-black tracking-[0.25em] text-theme-accent uppercase flex items-center gap-1.5 border-b border-theme-accent/20 pb-2">
                                                            <span className="material-symbols-outlined text-[11px]" aria-hidden="true">auto_awesome</span>
                                                            Behaviour & ecology (AI)
                                                        </p>
                                                        <div className="space-y-3 mt-2">
                                                            {currentItem.aiInsight.split(/\n+/).filter(Boolean).map((para, idx) => (
                                                                <p key={idx} className="text-[15px] font-serif text-stone-800 leading-relaxed">
                                                                    {para}
                                                                </p>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {activePost.tags && activePost.tags.length > 0 && (
                                            <div className="flex flex-wrap gap-2 pt-2 border-t border-theme-primary/10">
                                                {activePost.tags.map(tag => (
                                                    <button key={tag} onClick={() => handleTagClick(tag)} className="text-sm font-semibold text-sky-800 hover:underline">
                                                        {tag.startsWith('#') ? tag : `#${tag}`}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        <div className="pt-4 border-t border-theme-primary/10 pb-4 md:pb-8">
                                            <button 
                                                onClick={() => setIsCommentsOpen(true)}
                                                className="w-full py-3 px-4 bg-theme-primary/5 hover:bg-theme-primary/10 rounded-xl flex items-center justify-between transition-colors mb-4 md:mb-0"
                                            >
                                                <span className="text-sm font-semibold text-stone-700">{comments.length ? `View all ${comments.length} comment${comments.length === 1 ? '' : 's'}` : 'Add a comment'}</span>
                                                <span className="material-symbols-outlined text-theme-primary/60 text-sm">chevron_right</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </>
                        );
                    })()}
                </motion.div>
    
    <AnimatePresence>
        {isCommentsOpen && (
            <div className="fixed inset-0 z-[200] flex flex-col justify-end p-0 bg-black/60 backdrop-blur-sm font-body">
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0" 
                    onClick={() => setIsCommentsOpen(false)}
                />
                <motion.div 
                    initial={{ y: "100%" }}
                    animate={{ y: 0 }}
                    exit={{ y: "100%" }}
                    transition={{ type: "spring", damping: 25, stiffness: 200 }}
                    drag="y"
                    dragConstraints={{ top: 0 }}
                    dragElastic={0.2}
                    onDragEnd={(e, { offset, velocity }) => {
                        if (offset.y > 100 || velocity.y > 500) {
                            setIsCommentsOpen(false);
                        }
                    }}
                    className="w-full max-w-md mx-auto bg-white rounded-t-[2.5rem] overflow-hidden shadow-2xl flex flex-col h-[75vh] relative z-10 pb-[env(safe-area-inset-bottom)]"
                >
                    <div className="w-full flex justify-center pt-4 pb-2 shrink-0 cursor-grab active:cursor-grabbing">
                        <div className="w-12 h-1.5 bg-theme-primary/30 rounded-full"></div>
                    </div>
                    
                    <div className="px-6 pb-4 flex justify-between items-center shrink-0 border-b border-theme-primary/10">
                        <h3 id="comments-title" className="font-bold text-lg text-stone-900">Comments</h3>
                        <button onClick={() => setIsCommentsOpen(false)} aria-label="Close comments" className="w-11 h-11 rounded-full bg-stone-100 flex items-center justify-center text-stone-700 hover:bg-stone-200">
                            <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {comments.filter(c => !blockedIds.includes(c.userId)).length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-stone-500 text-center">
                                <span className="material-symbols-outlined text-4xl mb-2" aria-hidden="true">forum</span>
                                <p className="font-semibold text-stone-700">No comments yet</p>
                                <p className="text-sm mt-1">Share what you know about this sighting.</p>
                            </div>
                        ) : (
                            comments.filter(c => !blockedIds.includes(c.userId)).map(c => (
                                <div key={c.id} className="flex gap-3 group animate-fade-in">
                                    <button onClick={() => { setIsCommentsOpen(false); handleProfileClick(c.userId); }} aria-label={`View ${c.userName}`} className="shrink-0">
                                        {c.avatarUrl ? <img src={c.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" /> : <span className="w-9 h-9 rounded-full bg-theme-primary/10 flex items-center justify-center text-theme-primary font-bold text-sm uppercase" aria-hidden="true">{(c.userName || '?').charAt(0)}</span>}
                                    </button>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-stone-900 leading-snug"><button onClick={() => { setIsCommentsOpen(false); handleProfileClick(c.userId); }} className="font-bold mr-1.5">{c.userName}</button><RichText className="whitespace-pre-line break-words" text={c.text} onMention={openMention} onTag={handleTagClick} /></p>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-stone-500">
                                            <span>{timeAgo(c.timestamp)}</span>
                                            {isMember && c.userId !== currentUserMode.userId && (
                                                <button onClick={() => { setNewComment(prev => `@${c.userName} ${prev}`.slice(0, 1000)); (document.getElementById('new-comment') as HTMLInputElement | null)?.focus(); }} className="font-semibold hover:text-stone-800">Reply</button>
                                            )}
                                            {(c.userId === currentUserMode.userId || activePost.userId === currentUserMode.userId) && (
                                                <button onClick={() => handleDeleteComment(c.id)} className="font-semibold hover:text-red-700">Delete</button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="p-4 border-t border-theme-primary/10 bg-white shrink-0">
                        <form onSubmit={handleSendComment} className="flex gap-2.5">
                            <label htmlFor="new-comment" className="sr-only">Add a comment</label>
                            <input 
                                id="new-comment"
                                value={newComment} 
                                onChange={e => setNewComment(e.target.value.slice(0, 1000))} 
                                onFocus={() => { if (!isMember) askAccount('Create a free account to join the conversation.'); }}
                                placeholder={`Add a comment for ${activePost.userName}…`}
                                className="flex-1 bg-stone-50 border border-stone-200 rounded-full px-4 py-3 text-base focus:border-theme-accent transition-colors"
                            />
                            <button type="submit" disabled={!newComment.trim() || sendingComment} className="px-5 py-3 text-theme-accent text-base font-bold rounded-full disabled:opacity-40 transition-all active:scale-95">
                                {sendingComment ? 'Posting…' : 'Post'}
                            </button>
                        </form>
                    </div>
                </motion.div>
            </div>
        )}
    </AnimatePresence>

    <AnimatePresence>
        {sharingPost && <ShareStudio post={sharingPost} onClose={() => setSharingPost(null)} />}
    </AnimatePresence>

    <AnimatePresence>
        {publishingPost && (
            <PublisherStudio 
                post={publishingPost} 
                activeItemIndex={activeItemIndex} 
                onClose={() => setPublishingPost(null)} 
            />
        )}
    </AnimatePresence>
                {isEditing && activePost && (() => {
                    const currentItem = activePost.items && activePost.items.length > 0 ? activePost.items[activeItemIndex] : activePost;
                    return (
                        <MediaEditor 
                            type={currentItem.mediaType as any}
                            source={currentItem.mediaType === 'video' ? currentItem.videoUrl! : currentItem.mediaType === 'audio' ? currentItem.audioUrl! : currentItem.imageUrl!}
                            initialRotation={currentItem.rotation || 0}
                            onSave={handleEditSave}
                            onCancel={() => setIsEditing(false)}
                        />
                    );
                })()}
            </motion.div>
        )}
        </AnimatePresence>

        {reportOpen && activePost && (
            <div className="fixed inset-0 z-[260] flex items-end sm:items-center justify-center animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="report-title">
                <div className="absolute inset-0 bg-black/50" onClick={() => setReportOpen(false)} aria-hidden="true" />
                <div className="relative w-full sm:max-w-md bg-white rounded-t-[2rem] sm:rounded-[2rem] p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] animate-slide-up">
                    <h2 id="report-title" className="text-lg font-bold text-stone-900">Why are you reporting this post?</h2>
                    <p className="text-sm text-stone-600 mt-1 mb-4">Your report is anonymous to the author.</p>
                    <div className="flex flex-col gap-1">
                        {[
                            ['sensitive_location', 'Reveals a sensitive species location'],
                            ['wildlife_harm', 'Harming or disturbing wildlife'],
                            ['misidentification', 'Dangerous misidentification'],
                            ['spam', 'Spam or scam'],
                            ['harassment', 'Harassment or hate'],
                            ['nudity_violence', 'Nudity or graphic violence'],
                            ['ip', 'Not their photo / copyright'],
                            ['other', 'Something else'],
                        ].map(([key, label]) => (
                            <button key={key} onClick={() => handleReport(key)} className="text-left px-3 py-3 rounded-xl hover:bg-stone-50 text-[15px] font-medium text-stone-900 flex items-center justify-between">
                                {label}<span className="material-symbols-outlined text-stone-400" aria-hidden="true">chevron_right</span>
                            </button>
                        ))}
                    </div>
                    <button onClick={() => setReportOpen(false)} className="w-full mt-3 py-3 rounded-xl bg-stone-100 font-bold text-stone-800">Cancel</button>
                </div>
            </div>
        )}

        {toast && <div role="status" className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[300] bg-stone-900 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg animate-fade-in">{toast}</div>}

        {showAuthModal && (
            <AuthModal 
                onClose={() => setShowAuthModal(false)} 
                onSuccess={() => setShowAuthModal(false)}
            />
        )}
    </div>
  );
};

export default Community;
