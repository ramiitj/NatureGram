
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { CommunityPost, UserMode, Comment } from '../types';
import ShareStudio from './ShareStudio';
import PublisherStudio from './PublisherStudio';
import MediaEditor from './MediaEditor';
import SkeletonPost from './SkeletonPost';
import AuthModal from './AuthModal';
import FeedCard from './community/FeedCard';
import SpeciesInfoModal from './community/SpeciesInfoModal';
import DeleteConfirmModal from './community/DeleteConfirmModal';
import CommentsDrawer from './community/CommentsDrawer';
import { AnimatePresence, motion } from 'motion/react';
import { hapticFeedback } from '../utils';

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
    onLogoClick
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

  // Rich Search Feature States
  const [searchQuery, setSearchQuery] = useState("");
  const [mediaFilter, setMediaFilter] = useState<'all' | 'image' | 'video' | 'audio'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'likes' | 'title'>('newest');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [activeExploreTab, setActiveExploreTab] = useState<'all' | 'flora' | 'fauna' | 'fungi' | 'audio' | 'video' | 'popular'>('all');

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
  }, [posts, searchQuery, activeExploreTab, mediaFilter, dateFilter, sortOrder, selectedLabels]);

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
      if (!hasMore || isLoading || isJournalOnly) return;
      try {
          const { posts: newPosts, lastVisible: newLastVisible } = await FirebaseService.getMorePosts(lastVisible, searchTag);
          setPosts(prev => [...prev, ...newPosts]);
          setLastVisible(newLastVisible);
          setHasMore(newLastVisible !== null);
      } catch (err) {
          console.error("Failed to load more posts:", err);
      }
  }, [hasMore, isLoading, lastVisible, searchTag, isJournalOnly]);

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
  const [speciesData, setSpeciesData] = useState<{extract: string, thumbnail: string, loading: boolean} | null>(null);

  const handleSpeciesClick = async (label: string, locationArea?: string) => {
    setSelectedSpecies({name: label, location: locationArea || "Unknown Habitat", id: label});
    setSpeciesData({extract: "", thumbnail: "", loading: true});
    try {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(label.split(' ')[0])}`);
        const data = await res.json();
        setSpeciesData({
            extract: data.extract || "No specific encyclopedia data tracked for this taxonomy.",
            thumbnail: data.thumbnail?.source || "",
            loading: false
        });
    } catch(e) {
        setSpeciesData({extract: "Could not fetch biological details.", thumbnail: "", loading: false});
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
    if (isJournalOnly) return;
    
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
  }, [searchTag, isJournalOnly]);

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

  const handleLike = async (e: React.MouseEvent, post: CommunityPost) => {
      e.stopPropagation();
      if (currentUserMode.isAnonymous) {
          setShowAuthModal(true);
          return;
      }
      if (!currentUserMode.userId) return;
      hapticFeedback(10);
      const isLiked = post.likes?.includes(currentUserMode.userId);
      await FirebaseService.toggleLike(post.id, currentUserMode.userId, !!isLiked);
  };

  const handleDoubleTap = (e: React.MouseEvent | React.TouchEvent, post: CommunityPost) => {
      const now = Date.now();
      const DOUBLE_TAP_DELAY = 300;
      if (now - lastTap < DOUBLE_TAP_DELAY) {
          hapticFeedback([50, 50, 50]);
          if (currentUserMode.isAnonymous) {
              setShowAuthModal(true);
              return;
          }
          handleLike(e as any, post);
          setShowHeartAnimation(true);
          setTimeout(() => setShowHeartAnimation(false), 800);
      }
      setLastTap(now);
  };

  const handleSendComment = async (e: React.FormEvent) => {
      e.preventDefault();
      if (currentUserMode.isAnonymous) {
          setShowAuthModal(true);
          return;
      }
      if (!newComment.trim() || !activePost || !currentUserMode.userId) return;
      await FirebaseService.addComment(activePost.id, currentUserMode.userId, newComment);
      setNewComment("");
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
      const cleanTag = tag.startsWith('#') ? tag.slice(1) : tag;
      setSearchTag(cleanTag);
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
            <SpeciesInfoModal
                species={selectedSpecies}
                data={speciesData}
                onClose={() => setSelectedSpecies(null)}
            />
        )}

        {/* Custom Confirmation Modal */}
        {confirmDeleteId && (
            <DeleteConfirmModal
                onConfirm={executeDelete}
                onCancel={() => setConfirmDeleteId(null)}
            />
        )}

        {/* Instagram/Explore Inspired Search Header */}
        <div className="w-full px-4 md:px-12 pt-10 pb-6 flex flex-col gap-5 animate-fade-in border-b border-theme-primary/10 select-none relative z-50">
            {/* Header branding & stats */}
            <div className="flex items-center justify-between gap-4">
                <div 
                    onClick={() => {
                        if (onLogoClick && !isJournalOnly) {
                            onLogoClick();
                        }
                    }}
                    className={onLogoClick && !isJournalOnly ? "cursor-pointer hover:opacity-80 active:scale-95 transition-all outline-none" : ""}
                >
                    <h2 className="text-2xl md:text-3xl font-display font-black italic text-theme-primary tracking-tight">
                        {isJournalOnly ? "My Journal" : "NatureGram"}
                    </h2>
                    <p className="text-[9px] md:text-[10px] font-black text-theme-primary/30 uppercase tracking-widest mt-0.5">
                        {isJournalOnly ? "Personal species catalog" : "Living field guide"}
                    </p>
                </div>

                {/* Drafts Drawer Toggle Button */}
                <div className="flex items-center gap-3">
                    {onViewDrafts && (
                        <button 
                            onClick={onViewDrafts} 
                            className="relative w-10 h-10 rounded-full bg-stone-100 border border-theme-primary/5 hover:bg-stone-200/50 flex items-center justify-center text-theme-accent active:scale-95 transition-all"
                            title="Active drafts"
                        >
                            <span className="material-symbols-outlined text-lg">inventory</span>
                            {activeDraftsCount > 0 ? (
                                <span className="absolute -top-1 -right-1 w-4 h-4 bg-theme-accent rounded-full border border-white flex items-center justify-center text-[8px] font-bold text-white animate-pulse">
                                    {activeDraftsCount}
                                </span>
                            ) : null}
                        </button>
                    )}
                </div>
            </div>

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
                        <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-theme-primary/30 text-lg font-bold select-none">
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
                            placeholder={isJournalOnly ? "Search your journal..." : "Search species, bios, creators..."}
                            className="w-full pl-11 pr-11 py-3 bg-stone-100 hover:bg-stone-200/50 focus:bg-white text-sm text-theme-primary placeholder-theme-primary/40 rounded-2xl border-none outline-none focus:ring-2 focus:ring-theme-accent/20 transition-all font-sans font-medium"
                        />
                        {searchQuery && (
                            <button 
                                onClick={() => setSearchQuery("")}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-theme-primary/30 hover:text-theme-primary transition-colors flex items-center justify-center p-1"
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
                        className={`p-3 px-4 rounded-2xl border border-none transition-all flex items-center gap-1.5 font-bold text-[9px] uppercase tracking-wider cursor-pointer ${
                            showFilters || mediaFilter !== 'all' || dateFilter !== 'all' || selectedLabels.length > 0 || searchTag
                                ? 'bg-theme-accent/15 text-theme-accent' 
                                : 'bg-stone-100 text-theme-primary/60 hover:bg-stone-200/50'
                        }`}
                    >
                        <span className="material-symbols-outlined text-base">tune</span>
                        <span className="hidden sm:inline">Refine</span>
                    </button>
                </div>

                {/* Instagram Search Suggestions dropdown menu overlay */}
                {isSearchFocused && (
                    <div className="absolute top-[105%] left-0 right-0 bg-white border border-theme-primary/10 rounded-2xl p-5 shadow-2xl animate-slide-up flex flex-col gap-5 max-h-[380px] overflow-y-auto no-scrollbar z-[160]">
                        <div className="flex items-center justify-between border-b border-theme-primary/5 pb-2">
                            <span className="text-[9px] font-black uppercase text-theme-primary/40 tracking-wider">Suggested Searches & Accounts</span>
                            <button 
                                onClick={() => setIsSearchFocused(false)} 
                                className="text-[9px] font-black text-theme-primary/30 hover:text-theme-primary uppercase"
                            >
                                Hide
                            </button>
                        </div>

                        {/* Species & Hashtags Suggestions */}
                        {dynamicSuggestions.tags.length > 0 && (
                            <div className="space-y-2">
                                <span className="text-[8px] font-black uppercase tracking-widest text-theme-primary/40 flex items-center gap-1">
                                    <span className="material-symbols-outlined text-[10px] text-theme-accent">local_offer</span>
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
                                            className="px-3 py-1.5 bg-stone-50 hover:bg-theme-accent/5 hover:text-theme-accent border border-theme-primary/5 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all text-theme-primary/60"
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
                                <span className="text-[8px] font-black uppercase tracking-widest text-theme-primary/40 flex items-center gap-1">
                                    <span className="material-symbols-outlined text-[10px] text-theme-accent">alternate_email</span>
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
                                            <div className="w-6 h-6 rounded-full bg-theme-primary/10 flex items-center justify-center text-[10px] font-black text-theme-primary">
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
                                <span className="text-[8px] font-black uppercase tracking-widest text-theme-primary/40 flex items-center gap-1">
                                    <span className="material-symbols-outlined text-[10px] text-theme-accent">distance</span>
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
                                            className="text-[10px] text-theme-primary/70 hover:text-theme-accent font-sans font-medium flex items-center gap-1 bg-stone-50 p-1.5 px-3 rounded-lg hover:bg-stone-100"
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
                                <label className="block text-[8px] font-black uppercase tracking-wider text-theme-primary/40">Category Format</label>
                                <div className="grid grid-cols-4 gap-1 bg-stone-100 p-1 rounded-xl">
                                    {(['all', 'image', 'video', 'audio'] as const).map((media) => (
                                        <button
                                            key={media}
                                            onClick={() => setMediaFilter(media)}
                                            className={`py-1.5 text-[8px] font-black uppercase tracking-widest rounded-lg transition-all ${
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
                                <label className="block text-[8px] font-black uppercase tracking-wider text-theme-primary/40">Timeline Range</label>
                                <div className="grid grid-cols-4 gap-1 bg-stone-100 p-1 rounded-xl">
                                    {(['all', 'today', 'week', 'month'] as const).map((opt) => (
                                        <button
                                            key={opt}
                                            onClick={() => setDateFilter(opt)}
                                            className={`py-1.5 text-[8px] font-black uppercase tracking-widest rounded-lg transition-all ${
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
                                <label className="block text-[8px] font-black uppercase tracking-wider text-theme-primary/40">Sort Sequence</label>
                                <div className="grid grid-cols-3 gap-1 bg-stone-100 p-1 rounded-xl">
                                    {(['newest', 'likes', 'title'] as const).map((opt) => (
                                        <button
                                            key={opt}
                                            onClick={() => setSortOrder(opt)}
                                            className={`py-1.5 text-[8px] font-black uppercase tracking-widest rounded-lg transition-all ${
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
                                <label className="block text-[8px] font-black uppercase tracking-wider text-theme-primary/40">Filter Specific Taxons Native</label>
                                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto pr-2 no-scrollbar">
                                    {allAvailableLabels.map((lbl) => {
                                        const isSelected = selectedLabels.includes(lbl);
                                        return (
                                            <button
                                                key={lbl}
                                                onClick={() => toggleLabelFilter(lbl)}
                                                className={`px-2.5 py-1 text-[8px] font-black uppercase tracking-widest rounded-full border transition-all ${
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
                    { id: 'all', label: 'All Sighting', icon: '✨' },
                    { id: 'flora', label: 'Flora', icon: '🌿' },
                    { id: 'fauna', label: 'Fauna', icon: '🐦' },
                    { id: 'fungi', label: 'Fungi / Spores', icon: '🍄' },
                    { id: 'audio', label: 'Audio Reels', icon: '🎙️' },
                    { id: 'video', label: 'Clip Reels', icon: '🎥' },
                    { id: 'popular', label: 'Top Voted', icon: '🔥' },
                ].map((tab) => {
                    const isActive = activeExploreTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setActiveExploreTab(tab.id as any);
                                hapticFeedback();
                            }}
                            className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-all shrink-0 flex items-center gap-1.5 border cursor-pointer ${
                                isActive 
                                    ? 'bg-theme-primary text-white border-theme-primary shadow-lg shadow-theme-primary/10 scale-[1.03]' 
                                    : 'bg-stone-50 border-theme-primary/5 hover:border-theme-primary/10 text-theme-primary/60 hover:bg-stone-100'
                            }`}
                        >
                            <span>{tab.icon}</span>
                            <span>{tab.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* Reset status bar if any dynamic filter keyword is active */}
            {(searchQuery.trim() || activeExploreTab !== 'all' || mediaFilter !== 'all' || dateFilter !== 'all' || selectedLabels.length > 0 || searchTag) && (
                <div className="flex items-center justify-between gap-3 p-3 bg-stone-50 border border-theme-primary/5 rounded-2xl">
                    <div className="text-[9px] font-black text-theme-primary/40 uppercase tracking-widest flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-theme-accent rounded-full animate-pulse"></span>
                        <span>Active Search Filters</span>
                    </div>
                    <button 
                        onClick={resetAllFilters}
                        className="text-[8px] font-black uppercase tracking-wider text-theme-accent hover:opacity-80 transition-all flex items-center gap-1 cursor-pointer"
                    >
                        <span className="material-symbols-outlined text-[10px] font-bold">restart_alt</span>
                        Reset Filters
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
                <div className="py-20 flex flex-col items-center justify-center text-center px-8 bg-red-50/50 rounded-3xl border border-red-100 max-w-xl mx-auto my-12 animate-fade-in shadow-sm">
                    <span className="material-symbols-outlined text-5xl text-red-500 mb-6 font-black animate-pulse">cloud_off</span>
                    <h3 className="text-xl font-display font-medium text-stone-900 mb-3">Database Connection Alert</h3>
                    <p className="text-stone-600/80 text-sm max-w-sm mb-6 leading-relaxed">
                        We encountered an issue while loading the field guide. This can happen if the selected Firestore database is still in a cold start state or requires initializing rules.
                    </p>
                    <div className="bg-white/90 border border-stone-200 p-4 rounded-xl font-mono text-left text-xs text-stone-600 overflow-x-auto w-full max-w-md max-h-32 mb-8 shadow-inner select-all no-scrollbar">
                        {error}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
                        <button 
                            onClick={() => window.location.reload()} 
                            className="px-6 py-3.5 bg-stone-900 text-white font-black text-[10px] uppercase tracking-widest rounded-full shadow-lg active:scale-95 transition-all"
                        >
                            Retry Request
                        </button>
                        {localStorage.getItem('firestore_db_override') ? (
                            <button 
                                onClick={() => {
                                    localStorage.removeItem('firestore_db_override');
                                    window.location.reload();
                                }} 
                                className="px-6 py-3.5 bg-orange-600 text-white font-black text-[10px] uppercase tracking-widest rounded-full shadow-lg active:scale-95 transition-all"
                            >
                                Reset Config to File ID
                            </button>
                        ) : (
                            <button 
                                onClick={() => {
                                    localStorage.setItem('firestore_db_override', '(default)');
                                    window.location.reload();
                                }} 
                                className="px-6 py-3.5 bg-theme-primary text-white font-black text-[10px] uppercase tracking-widest rounded-full shadow-lg active:scale-95 transition-all"
                            >
                                Force Default Database
                            </button>
                        )}
                    </div>
                </div>
            ) : filteredAndSortedPosts.length === 0 ? (
                <div className="py-24 sm:py-40 flex flex-col items-center justify-center text-center px-8">
                    <span className="material-symbols-outlined text-5xl text-theme-primary/20 mb-6 select-none">search_off</span>
                    <h3 className="text-lg font-display italic text-theme-primary/60 mb-1 font-bold">No Matching Specimens</h3>
                    <p className="text-[10px] uppercase tracking-wider text-theme-primary/30 max-w-xs mb-8">Refining your query terms, timeline filters, or media constraints might match observations.</p>
                    <button onClick={resetAllFilters} className="px-8 py-3.5 bg-theme-primary text-white font-black text-[9px] uppercase tracking-widest rounded-full shadow-lg hover:shadow-xl active:scale-95 transition-all cursor-pointer">
                        Clear All Filters
                    </button>
                </div>
            ) : (
                <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-2 md:gap-4 pb-56 space-y-2 md:space-y-4">
                    {filteredAndSortedPosts.map((post) => (
                        <FeedCard 
                            key={post.id} 
                            post={post} 
                            onPostClick={handlePostClick} 
                            loadedImages={loadedImages} 
                            onImageLoad={onImageLoad} 
                        />
                    ))}
                    <div ref={loadMoreRef} className="h-10" />
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
                <header className="h-16 px-6 flex items-center justify-between bg-white border-b border-theme-primary/10 shrink-0 z-[160] shadow-sm">
                    <button onClick={closeDetail} className="flex items-center gap-3 transition-all active:scale-95 group">
                        <span className="material-symbols-outlined text-theme-primary text-2xl font-black">arrow_back</span>
                        <span className="text-[11px] font-black text-theme-primary uppercase tracking-[0.3em] border-b-2 border-theme-accent pb-0.5">
                            {isJournalOnly ? "MY JOURNAL" : (searchTag ? "SEARCH" : (backLabel === "Archive" ? "MY LOGS" : "FEED"))}
                        </span>
                    </button>

                    {/* Desktop floating navigation chevrons - replacing top header numbered pagination */}
                    {activePostIndex > 0 && (
                        <button 
                            onClick={() => navigateSequential('prev')}
                            className="fixed left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/90 hover:bg-white text-stone-800 flex items-center justify-center shadow-lg border border-stone-100 z-[180] active:scale-95 transition-all text-xl font-black md:flex hidden"
                            title="Previous specimen"
                        >
                            <span className="material-symbols-outlined text-3xl font-extrabold text-stone-700">chevron_left</span>
                        </button>
                    )}
                    {activePostIndex !== -1 && activePostIndex < posts.length - 1 && (
                        <button 
                            onClick={() => navigateSequential('next')}
                            className="fixed right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/90 hover:bg-white text-stone-800 flex items-center justify-center shadow-lg border border-stone-100 z-[180] active:scale-95 transition-all text-xl font-black md:flex hidden"
                            title="Next specimen"
                        >
                            <span className="material-symbols-outlined text-3xl font-extrabold text-stone-700">chevron_right</span>
                        </button>
                    )}

                    <div className="flex items-center gap-4">
                        {activePost.userId === currentUserMode.userId && (
                            <>
                                <button 
                                    onClick={() => setPublishingPost(activePost)} 
                                    className="w-10 h-10 rounded-full bg-emerald-50 hover:bg-emerald-100 flex items-center justify-center text-emerald-700 transition-colors cursor-pointer"
                                    title="Launch Publisher Studio"
                                >
                                    <span className="material-symbols-outlined text-xl">campaign</span>
                                </button>
                                <button onClick={() => setIsEditing(true)} className="w-10 h-10 rounded-full bg-theme-accent/10 flex items-center justify-center text-theme-accent hover:bg-theme-accent/20 transition-colors">
                                    <span className="material-symbols-outlined text-xl">edit</span>
                                </button>
                                <button onClick={() => handleDeletePost(activePost.id)} className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-red-600 hover:bg-red-100 transition-colors">
                                    <span className="material-symbols-outlined text-xl">delete</span>
                                </button>
                            </>
                        )}
                        <button onClick={() => setSharingPost(activePost)} className="w-10 h-10 rounded-full bg-theme-primary/5 flex items-center justify-center text-theme-accent">
                            <span className="material-symbols-outlined text-xl">share</span>
                        </button>
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
                                <div className="flex-1 min-h-0 bg-theme-primary/5 flex flex-col justify-center relative group/media overflow-hidden">
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
                                                                className="w-full h-full md:w-auto md:h-auto md:max-w-full md:max-h-full object-contain rounded-none md:rounded-2xl cursor-pointer drop-shadow-none md:drop-shadow-xl"
                                                                onClick={() => window.open(item.imageUrl || item.thumbnailUrl, '_blank')}
                                                            />
                                                        )}
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Left Arrow overlay visible on hover */}
                                            {activeItemIndex > 0 && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); scrollToItem(activeItemIndex - 1); }}
                                                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover/media:opacity-100 transition-opacity z-[175] active:scale-95 pointer-events-auto"
                                                >
                                                    <span className="material-symbols-outlined text-xl">chevron_left</span>
                                                </button>
                                            )}

                                            {/* Right Arrow overlay visible on hover */}
                                            {activeItemIndex < (activePost.items?.length || 1) - 1 && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); scrollToItem(activeItemIndex + 1); }}
                                                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover/media:opacity-100 transition-opacity z-[175] active:scale-95 pointer-events-auto"
                                                >
                                                    <span className="material-symbols-outlined text-xl">chevron_right</span>
                                                </button>
                                            )}

                                            {/* Subtle Overlay Dots centered near bottom */}
                                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-[175] py-1 px-2.5 rounded-full bg-black/20 backdrop-blur-sm">
                                                {activePost.items!.map((_, index) => (
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
                                                    className="w-full h-full md:w-auto md:h-auto md:max-w-full md:max-h-full object-contain rounded-none md:rounded-2xl cursor-pointer drop-shadow-none md:drop-shadow-xl"
                                                    onClick={() => window.open(currentItem.imageUrl || currentItem.thumbnailUrl, '_blank')}
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="w-full md:w-[400px] shrink-0 max-h-[45vh] md:max-h-none border-t md:border-t-0 md:border-l border-theme-primary/10 bg-white flex flex-col hidden-scrollbar">
                                    <div className="p-4 md:p-6 flex items-center justify-between shrink-0 border-b border-theme-primary/5">
                                        <div className="flex items-center gap-3 cursor-pointer group" onClick={() => handleProfileClick(activePost.userId)}>
                                            <div className="w-9 h-9 rounded-full bg-theme-primary/10 flex items-center justify-center text-theme-primary font-black text-[10px] uppercase border border-theme-primary/20 group-hover:border-theme-accent transition-colors">
                                                {activePost.userName.charAt(0)}
                                            </div>
                                            <div>
                                                <p className="font-black text-xs text-theme-primary tracking-tight leading-none mb-0.5 group-hover:text-theme-accent transition-colors">{activePost.userName}</p>
                                                <p className="catalog-label text-[7px] opacity-40 lowercase tracking-[0.1em] font-bold">
                                                    {currentItem.locationArea || "Wilderness"}
                                                </p>
                                            </div>
                                        </div>
                                        <button onClick={(e) => handleLike(e, activePost)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all ${activePost.likes?.includes(currentUserMode.userId!) ? 'bg-theme-accent border-theme-accent text-white shadow-lg' : 'border-theme-primary/10 text-theme-accent'}`}>
                                            <span className={`material-symbols-outlined text-[13px] ${activePost.likes?.includes(currentUserMode.userId!) ? 'fill-current' : ''}`}>favorite</span>
                                            <span className="text-[10px] font-black tracking-tighter">{activePost.likes?.length || 0}</span>
                                        </button>
                                    </div>
                                    
                                    <div className="p-4 md:p-6 flex-1 overflow-y-auto hidden-scrollbar flex flex-col space-y-6">
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
                                                        <p className="catalog-label opacity-60 text-[8px] font-black tracking-[0.2em] text-theme-primary uppercase">Taxonomy</p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {currentItem.labels.map((l, i) => (
                                                                <span key={i} onClick={() => handleSpeciesClick(l, currentItem.locationArea)} className="cursor-pointer px-3 py-1.5 bg-theme-accent/10 border border-theme-accent/20 text-theme-primary font-black text-[9px] uppercase tracking-widest rounded-sm hover:bg-theme-accent/20 transition-colors">
                                                                    {l}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {currentItem.aiInsight && (
                                                    <div className="p-5 bg-insight-bg border border-theme-accent/30 rounded-xl space-y-3">
                                                        <p className="catalog-label text-[8px] font-black tracking-[0.25em] text-theme-accent uppercase flex items-center gap-1.5 border-b border-theme-accent/20 pb-2">
                                                            <span className="material-symbols-outlined text-[11px]">auto_awesome</span>
                                                            Ecologic Analysis
                                                        </p>
                                                        <div className="space-y-3 mt-2">
                                                            {currentItem.aiInsight.split(/\n+/).filter(Boolean).map((para, idx) => (
                                                                <p key={idx} className="text-[13px] font-serif text-theme-primary/90 leading-relaxed text-justify">
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
                                                    <span key={tag} onClick={() => handleTagClick(tag)} className="cursor-pointer px-3 py-1.5 bg-theme-accent/10 border border-theme-accent/20 text-theme-primary font-black italic text-[9px] uppercase tracking-widest rounded-sm hover:bg-theme-accent/30 transition-colors">
                                                        {tag.startsWith('#') ? tag : `#${tag}`}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        <div className="pt-4 border-t border-theme-primary/10 pb-4 md:pb-8">
                                            <button 
                                                onClick={() => setIsCommentsOpen(true)}
                                                className="w-full py-3 px-4 bg-theme-primary/5 hover:bg-theme-primary/10 rounded-xl flex items-center justify-between transition-colors mb-4 md:mb-0"
                                            >
                                                <span className="text-xs font-bold text-theme-primary">View Field Notes ({comments.length})</span>
                                                <span className="material-symbols-outlined text-theme-primary/40 text-sm">chevron_right</span>
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
            <CommentsDrawer
                comments={comments}
                newComment={newComment}
                onNewCommentChange={setNewComment}
                onSendComment={handleSendComment}
                onClose={() => setIsCommentsOpen(false)}
                onProfileClick={handleProfileClick}
            />
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
