
import { openExternal, timeAgo, likeTotal, looksLikeSpam } from '../utils';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import PlayableVideo, { PlayableAudio, resolvePoster } from './PlayableVideo';
import { FirebaseService } from '../services/firebaseService';
import { getNaturalistExtra, getThemePeriod } from '../constants/naturalistExtras';
import { isFungiPost, FungiWarning } from './AiBadge';
import RichText from './RichText';
import CommunityId from './CommunityId';
import { UserProfileData, NaturalistPersona } from '../types';
import { rankForYou } from '../services/ranking';
import { track } from '../services/analytics';
import { CommunityPost, UserMode, Comment } from '../types';
const ShareStudio = React.lazy(() => import('./ShareStudio'));
const PublisherStudio = React.lazy(() => import('./PublisherStudio'));
import MediaEditor from './MediaEditor';
import SkeletonPost, { PressingLoader } from './SkeletonPost';
import Glyph from './Glyph';
import { PlateStamp } from './SpecimenPlate';
import { groupOf, seasonOf, GROUP_GLYPH, LifeGroup, toMs } from '../services/lifeList';
import AuthModal from './AuthModal';
import { WonderIcon, WonderBurst, wonderLabel, fieldMoment, observedBehaviour, insightBeyond, SoundScape } from './Wonder';
import { hapticFeedback } from '../utils';

/** Tags worth showing a reader: not the app's own (#fieldguide, #naturegram) and not the species name already in the title. */
const SYSTEM_TAGS = new Set(['fieldguide', 'naturegram', 'nature', 'wildlife']);
const visibleTags = (post: CommunityPost): string[] => {
    const species = (post.labels?.[0] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return (post.tags || []).filter(t => {
        const k = t.replace(/^#/, '').toLowerCase();
        return k && !SYSTEM_TAGS.has(k) && k.replace(/[^a-z0-9]/g, '') !== species;
    });
};

const FeedCard: React.FC<{
    post: CommunityPost;
    onPostClick: (post: CommunityPost) => void;
    loadedImages: Record<string, boolean>;
    onImageLoad: (id: string) => void;
}> = ({ post, onPostClick, loadedImages, onImageLoad }) => {
    const hasThumb = !!(post.thumbnailUrl || post.imageUrl);
    const isLoaded = post.mediaType === 'audio' || !hasThumb ? true : loadedImages[post.id];
    const label = post.labels?.[0] || post.title || 'Sighting';
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
    // Video sightings without a still: use the frame the server made when it converted the video
    const [poster, setPoster] = useState<string | null>(null);
    useEffect(() => {
        if (post.mediaType !== 'video' || post.thumbnailUrl || post.imageUrl || !isHovered) return;
        let live = true;
        (videoUrl ? Promise.resolve(videoUrl) : FirebaseService.getFullPost(post.id).then(f => f?.videoUrl || f?.items?.[0]?.videoUrl))
          .then(u => resolvePoster(u)).then(p => { if (live && p) setPoster(p); });
        return () => { live = false; };
    }, [post.id, post.mediaType, post.thumbnailUrl, post.imageUrl, isHovered, videoUrl]);

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
                        {post.thumbnailUrl || post.imageUrl || poster ? (
                            <img src={post.thumbnailUrl || post.imageUrl || poster!} className="w-full h-full object-cover opacity-80 font-display" alt={`Video: ${label}`} loading="lazy" onLoad={() => onImageLoad(post.id)} onError={() => onImageLoad(post.id)} />
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
                        srcSet={post.thumbSmallUrl ? `${post.thumbSmallUrl} 400w, ${post.thumbnailUrl || post.imageUrl} 800w` : undefined}
                        sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
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
                <h3 className="text-sm font-display italic font-semibold text-theme-primary leading-tight truncate group-hover:text-theme-accent transition-colors">
                    {label}
                </h3>
                <div className="flex items-center gap-1 mt-1 text-[11px] text-stone-500 min-w-0">
                    {post.locationArea
                        ? <><span className="material-symbols-outlined text-[13px] shrink-0" aria-hidden="true">location_on</span><span className="truncate">{post.locationArea}</span></>
                        : <span className="truncate">{post.userName || 'Explorer'}</span>}
                    {likeTotal(post) > 0 && (
                        <span className="ml-auto flex items-center gap-0.5 shrink-0 text-theme-accent" aria-label={wonderLabel(likeTotal(post))}>
                            <WonderIcon active className="text-[13px]" />
                            <span className="font-semibold tabular">{likeTotal(post)}</span>
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

/** A sighting's video. Files that carry only sound (some recordings are saved as video) get a picture to listen by instead of a blank frame. */
const SightingVideo: React.FC<{ src?: string; poster?: string | null; noDownload: boolean; label?: string | null }> = ({ src, poster, noDownload, label }) => {
    const [soundOnly, setSoundOnly] = useState(false);
    const [playing, setPlaying] = useState(false);
    return (
        <div className={soundOnly ? 'flex flex-col items-center justify-center w-full h-full gap-4 max-w-md mx-auto' : 'contents'}>
            {soundOnly && <SoundScape label={label} playing={playing} className="flex-1 min-h-0" />}
            <PlayableVideo
                controlsList={noDownload ? 'nodownload' : undefined}
                src={src}
                poster={soundOnly ? undefined : (poster || undefined)}
                controls
                playsInline
                preload='metadata'
                onLoadedMetadata={(e) => { if (e.currentTarget.videoWidth === 0) setSoundOnly(true); }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                className={soundOnly ? 'w-full h-12 shrink-0 rounded-full' : 'w-full h-full md:w-auto md:h-auto md:max-w-full md:max-h-full rounded-none md:rounded-2xl object-contain drop-shadow-none md:drop-shadow-xl'}
            />
        </div>
    );
};

/** A sound sighting: its habitat photo if there is one, otherwise a picture to listen by. */
const SightingSound: React.FC<{ src?: string; image?: string | null; noDownload: boolean; label?: string | null }> = ({ src, image, noDownload, label }) => {
    const [playing, setPlaying] = useState(false);
    return (
        <div className="flex flex-col items-center justify-center w-full h-full gap-4 p-4 md:p-4 max-w-full max-h-full">
            {image ? (
                <img src={image} alt={label ? `Where the ${label} was heard` : 'Where the sound was recorded'} className="w-full h-full md:w-auto md:h-auto md:max-w-full flex-1 min-h-0 object-contain rounded-none md:rounded-2xl drop-shadow-none md:drop-shadow-xl" />
            ) : (
                <SoundScape label={label} playing={playing} className="flex-1 min-h-0 max-w-md" />
            )}
            <PlayableAudio src={src} controls controlsList={noDownload ? 'nodownload' : undefined} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="w-full max-w-md shrink-0 shadow-lg rounded-full" />
        </div>
    );
};

interface CommunityProps {
  currentUserMode: UserMode;
  selectedPostId?: string | null;
  onPostClose?: () => void;
  onPostOpen?: (postId?: string) => void;
  backLabel?: string;
  onViewProfile?: (userId: string) => void;
  isJournalOnly?: boolean;
  activeDraftsCount?: number;
  onViewDrafts?: () => void;
  onLogoClick?: () => void;
  onRequireAccount?: (reason: string, then?: () => void) => void;
  dailyTheme?: any;
  onOpenActivity?: () => void;
  onOpenMessages?: () => void;
  unreadActivity?: number;
  unreadMessages?: number;
  /** Render only the post view and its sheets (used by the field notebook to open an entry) */
  detailOnly?: boolean;
  /** A post to open as soon as this mounts */
  initialPost?: CommunityPost | null;
  /** Extra controls placed beside the header actions */
  headerActions?: React.ReactNode;
}

const Community: React.FC<CommunityProps> = ({ 
    currentUserMode, 
    selectedPostId, 
    onPostClose, 
    onPostOpen, 
    backLabel = "Wild",
    onViewProfile,
    isJournalOnly = false,
    activeDraftsCount = 0,
    onViewDrafts,
    onLogoClick,
    onRequireAccount,
    dailyTheme,
    onOpenActivity,
    onOpenMessages,
    unreadActivity = 0,
    unreadMessages = 0,
    detailOnly = false,
    initialPost = null,
    headerActions
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
  /** Start of the current naturalist's fortnight (same arithmetic as getThemePeriod) */
  const fortnightStartMs = React.useMemo(() => {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now.getTime() - yearStart.getTime()) / 86_400_000);
    const startDay = Math.ceil(Math.floor(dayOfYear / 15.21) * 15.21);
    return new Date(now.getFullYear(), 0, startDay).getTime();
  }, []);
  /** Kinds of life present in what's loaded, so the filter never offers an empty choice */
  const groupsPresent = React.useMemo(() => {
    const seen = new Map<LifeGroup, number>();
    posts.forEach(p => { const g = groupOf(p); seen.set(g, (seen.get(g) || 0) + 1); });
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  }, [posts]);
  // Re-read the hour each time the feed mounts; no need to tick live.
  const moment = React.useMemo(() => fieldMoment(), []);
  const [challenge, setChallenge] = useState<{ explorers: number; mine: boolean; capped: boolean } | null>(null);
  useEffect(() => {
      if (isJournalOnly || !themeExtra.challengeTag) return;
      let alive = true;
      FirebaseService.getChallengeProgress(themeExtra.challengeTag).then(r => { if (alive) setChallenge(r); }).catch(() => {});
      return () => { alive = false; };
  }, [isJournalOnly, themeExtra.challengeTag, currentUserMode.userId]);

  useEffect(() => {
    if (isMember) FirebaseService.getBlockedIds().then(setBlockedIds);
  }, [isMember]);

  // Persona-based AI curation (from main): reorder the first page once per load, never per keystroke
  const [userPersona, setUserPersona] = useState<NaturalistPersona | null>(null);
  const curatedForRef = useRef<string>('');
  useEffect(() => {
    if (!isMember || !currentUserMode.userId) { setUserPersona(null); return; }
    FirebaseService.getUserProfile(currentUserMode.userId).then(p => setUserPersona(p?.naturalistPersona || null)).catch(() => {});
  }, [isMember, currentUserMode.userId]);

  // "Fresh sightings" rail: explorers you follow who posted in the last 72 hours
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [freshRail, setFreshRail] = useState<{ userId: string; userName: string; avatar?: string | null; post: CommunityPost; count: number }[]>([]);
  useEffect(() => {
    if (!isMember || isJournalOnly || !currentUserMode.userId) { setFreshRail([]); return; }
    let active = true;
    (async () => {
      const ids = await FirebaseService.getFollowingIds(currentUserMode.userId!);
      if (active) setFollowingIds(new Set(ids));
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
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'fortnight' | 'month' | 'season'>('all');
  const [selectedGroups, setSelectedGroups] = useState<LifeGroup[]>([]);
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

  // Search suggestions drawn from the sightings already loaded
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

        // 2. Category pills
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

        // 4. When it was seen: today, this naturalist's fortnight, this month or this season
        if (dateFilter !== 'all') {
          const ms = toMs(post.timestamp) || (post.timestamp ? new Date(post.timestamp).getTime() : 0);
          if (!ms) return false;
          const now = new Date();
          if (dateFilter === 'today' && ms < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) return false;
          if (dateFilter === 'fortnight' && ms < fortnightStartMs) return false;
          if (dateFilter === 'month' && ms < Date.now() - 30 * 86_400_000) return false;
          if (dateFilter === 'season') {
            const lat = post.rawLocation?.lat;
            const bare = (t: number) => seasonOf(t, lat).replace(/^early /, '');
            if (bare(ms) !== bare(Date.now()) || ms < Date.now() - 120 * 86_400_000) return false;
          }
        }

        // 5. Kind of life
        if (selectedGroups.length > 0 && !selectedGroups.includes(groupOf(post))) return false;

        // 6. Particular species
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
          const likesA = likeTotal(a);
          const likesB = likeTotal(b);
          return likesB - likesA;
        } else if (querySortOrder === 'title') {
          const titleA = a.title || a.labels?.[0] || 'Specimen';
          const titleB = b.title || b.labels?.[0] || 'Specimen';
          return titleA.localeCompare(titleB);
        }
        return 0;
      });
  }, [posts, searchQuery, activeExploreTab, mediaFilter, dateFilter, sortOrder, selectedLabels, selectedGroups, blockedIds]);

  // "For you" is ranked when no search/filter/sort override is active; otherwise explicit ordering wins
  const displayPosts = React.useMemo(() => {
    const ranked = !isJournalOnly && feedMode === 'foryou' && !searchTag && !searchQuery.trim()
      && activeExploreTab === 'all' && sortOrder === 'newest' && mediaFilter === 'all' && dateFilter === 'all' && selectedLabels.length === 0 && selectedGroups.length === 0;
    if (!ranked) return filteredAndSortedPosts;
    // AI-curated picks (persona) stay first; the rest is ranked transparently
    const curated = filteredAndSortedPosts.filter(p => p.curatorNote);
    const rest = filteredAndSortedPosts.filter(p => !p.curatorNote);
    return [...curated, ...rankForYou(rest, { followingIds, persona: userPersona, challengeTag: themeExtra.challengeTag, myUid: currentUserMode.userId })];
  }, [filteredAndSortedPosts, isJournalOnly, feedMode, searchTag, searchQuery, activeExploreTab, sortOrder, mediaFilter, dateFilter, selectedLabels, selectedGroups, followingIds, userPersona, themeExtra.challengeTag, currentUserMode.userId]);

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
    setSelectedGroups([]);
    setSearchTag(null);
    setActiveExploreTab('all');
    setIsSearchFocused(false);
  };
  
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const activePostIndex = activePost ? displayPosts.findIndex(p => p.id === activePost.id) : -1;
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
  const [wonderBurst, setWonderBurst] = useState<{ x: number; y: number; key: number } | null>(null);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetDrag = useRef<{ y: number; t: number; on: boolean }>({ y: 0, t: 0, on: false });
  
  // Species field-guide page
  const [selectedSpecies, setSelectedSpecies] = useState<{name: string, location: string, id: string} | null>(null);
  const [speciesData, setSpeciesData] = useState<{extract: string, thumbnail: string, loading: boolean, url?: string} | null>(null);

  /** What the loaded sightings say about the open species: who has seen it, when, and what it is confused with. */
  const speciesPage = React.useMemo(() => {
    const name = (selectedSpecies?.name || '').trim();
    const key = name.toLowerCase();
    const empty = { explorers: 0, mine: 0, months: '', scientific: '', lookAlikes: [] as { name: string; scientific?: string; evidence?: string }[], group: 'Other life' as LifeGroup };
    if (!key) return empty;
    const pool = new Map<string, CommunityPost>();
    [...posts, ...(activePost ? [activePost] : [])].forEach(p => pool.set(p.id, p));
    const labelsOf = (p: CommunityPost) => [...(p.labels || []), ...((p.items || []).flatMap(i => i.labels || []))].map(l => (l || '').trim().toLowerCase());
    const matching = [...pool.values()].filter(p => labelsOf(p).includes(key));
    const idsOf = (p: CommunityPost) => [...(((p as any).aiIdentifications || []) as any[]), ...((p.items || []).flatMap(i => i.aiIdentifications || []))].filter(Boolean);
    const users = new Set(matching.map(p => p.userId).filter(Boolean));
    const mine = matching.filter(p => p.userId && p.userId === currentUserMode.userId).length;
    // Months it was recorded, as the shortest run around the calendar that covers them ("Oct–Mar")
    const monthsSet = new Set(matching.map(p => toMs(p.timestamp)).filter(Boolean).map(ms => new Date(ms).getMonth()));
    const mName = (m: number) => new Date(2020, m, 1).toLocaleDateString(undefined, { month: 'short' });
    let months = '';
    const ms = [...monthsSet].sort((a, b) => a - b);
    if (ms.length === 1) months = mName(ms[0]);
    else if (ms.length > 1) {
      let gapAt = 0, gap = -1;
      ms.forEach((m, i) => { const next = ms[(i + 1) % ms.length]; const d = (next - m + 12) % 12; if (d > gap) { gap = d; gapAt = i; } });
      const start = ms[(gapAt + 1) % ms.length], end = ms[gapAt];
      const span = ((end - start + 12) % 12) + 1;
      months = span <= ms.length + 2 ? `${mName(start)}–${mName(end)}` : ms.map(mName).join(', ');
    }
    let scientific = '';
    const look = new Map<string, { name: string; scientific?: string; evidence?: string }>();
    matching.forEach(p => idsOf(p).forEach((i: any) => {
      const cn = (i.commonName || '').trim();
      if (!cn) return;
      if (cn.toLowerCase() === key) { if (!scientific && i.scientificName) scientific = i.scientificName; return; }
      if (!look.has(cn.toLowerCase())) look.set(cn.toLowerCase(), { name: cn, scientific: i.scientificName || undefined, evidence: i.evidence || undefined });
    }));
    if (!scientific) {
      const binomial = matching.map(p => p.labels?.[1]).find(l => l && /^[A-Z][a-z]+ [a-z]+/.test(l));
      if (binomial) scientific = binomial;
    }
    return { explorers: users.size, mine, months, scientific, lookAlikes: [...look.values()].slice(0, 3), group: groupOf(matching[0] || { labels: [name] }) };
  }, [selectedSpecies?.name, posts, activePost, currentUserMode.userId]);

  const handleSpeciesClick = async (label: string, locationArea?: string) => {
    setSelectedSpecies({name: label, location: locationArea || '', id: label});
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
            extract: found?.extract || `No encyclopedia entry for "${clean}" yet. The name may cover a group rather than a single species.`,
            thumbnail: found?.thumbnail?.source || "",
            loading: false,
            url: found?.content_urls?.desktop?.page || '',
        });
    } catch(e) {
        setSpeciesData({extract: "The encyclopedia can't be reached right now. Try again in a little while.", thumbnail: "", loading: false});
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

  useEffect(() => {
    if (!userPersona || isJournalOnly || feedMode !== 'foryou' || searchTag || posts.length === 0) return;
    const key = `${posts[0]?.id}|${userPersona.archetype}|${(userPersona.taxaInterests || []).join(',')}`;
    if (curatedForRef.current === key) return;
    curatedForRef.current = key;
    const firstPage = posts.slice(0, 15);
    // Curator notes are added in place: the feed never reshuffles under the explorer's thumb
    import('../services/genAiService').then(({ GenAiService }) => GenAiService.curateAgenticFeed(userPersona, firstPage)).then(curated => {
      const byId = new Map(curated.map(p => [p.id, p]));
      setPosts(prev => prev.map(p => {
        const c: any = byId.get(p.id);
        return c && c.curatorNote ? { ...p, curatorNote: c.curatorNote } as any : p;
      }));
    }).catch(() => {});
  }, [userPersona, posts, isJournalOnly, feedMode, searchTag]);

  // Logo / Feed tab re-tap: back to the top of the main feed
  useEffect(() => {
    const onTop = () => {
      (document.getElementById('main-scroll') || document.getElementById('community-scroll-container'))?.scrollTo({ top: 0, behavior: 'smooth' });
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
            onPostOpen?.(post.id);
        } else if (!isLoading && fetchedPostId !== selectedPostId) {
            setFetchedPostId(selectedPostId);
            FirebaseService.getPost(selectedPostId).then(fetchedPost => {
                if (fetchedPost) {
                    setActivePost(fetchedPost);
                    setActiveItemIndex(0);
                    onPostOpen?.(fetchedPost.id);
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

  // Real back-button support: an open post gets its own URL (/post/:id); Back closes it
  const historyPushedRef = useRef(false);
  const returnPathRef = useRef<string>('/feed');
  useEffect(() => {
      if (!activePost) return;
      const postPath = `/post/${encodeURIComponent(activePost.id)}`;
      if (!historyPushedRef.current) {
          if (!window.location.pathname.startsWith('/post/')) {
              returnPathRef.current = window.location.pathname + window.location.search;
              window.history.pushState({ post: activePost.id }, '', postPath);
          }
          historyPushedRef.current = true;
      } else if (window.location.pathname !== postPath) {
          window.history.replaceState({ post: activePost.id }, '', postPath);
      }
  }, [activePost?.id]);
  useEffect(() => {
      const onPop = () => {
          if (historyPushedRef.current && !window.location.pathname.startsWith('/post/')) {
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
    onPostOpen?.(post.id);
    try {
      const fullPost = await FirebaseService.getFullPost(post.id);
      if (fullPost) setActivePost(fullPost);
    } catch (e) {
      console.warn('Could not load full post:', e);
    }
  };

  // Opened from elsewhere (the field notebook): show that post straight away
  useEffect(() => {
    if (initialPost) handlePostClick(initialPost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Likes I made via scalable like documents (legacy likes live in post.likes)
  const [myLikes, setMyLikes] = useState<Set<string>>(new Set());
  useEffect(() => {
      if (!activePost || !isMember || myLikes.has(activePost.id)) return;
      FirebaseService.hasLiked(activePost.id).then(liked => {
          if (liked) setMyLikes(prev => new Set(prev).add(activePost.id));
      });
  }, [activePost?.id, isMember]);
  const isLikedByMe = (p: CommunityPost) => !!currentUserMode.userId && (myLikes.has(p.id) || !!p.likes?.includes(currentUserMode.userId));

  const applyLikeLocally = (post: CommunityPost, uid: string, like: boolean, legacy: boolean) => {
      const update = (p: CommunityPost) => {
          if (p.id !== post.id) return p;
          if (!like && legacy) return { ...p, likes: (p.likes || []).filter(x => x !== uid) };
          return { ...p, likeCount: Math.max(0, (p.likeCount || 0) + (like ? 1 : -1)) };
      };
      setPosts(prev => prev.map(update));
      setActivePost(prev => prev ? update(prev) : prev);
      setMyLikes(prev => { const n = new Set(prev); if (like) n.add(post.id); else n.delete(post.id); return n; });
  };

  const setLike = async (post: CommunityPost, like: boolean) => {
      if (!isMember) {
          askAccount('Create a free account to marvel at sightings and cheer on other explorers.', () => setLike(post, like));
          return;
      }
      const uid = currentUserMode.userId!;
      const legacy = !!post.likes?.includes(uid);
      const isLiked = legacy || myLikes.has(post.id);
      if (isLiked === like) return;
      hapticFeedback(10);
      const snapshot = { posts, active: activePost, mine: myLikes };
      applyLikeLocally(post, uid, like, legacy);
      track(like ? 'like' : 'unlike', { media: post.mediaType });
      try {
          await FirebaseService.toggleLike(post.id, uid, isLiked, legacy);
      } catch (err) {
          console.error('Like failed', err);
          setPosts(snapshot.posts); setActivePost(snapshot.active); setMyLikes(snapshot.mine);
          showToast('Could not save your like. Please try again.');
      }
  };

  const handleLike = (e: React.MouseEvent, post: CommunityPost) => {
      e.stopPropagation();
      setLike(post, !isLikedByMe(post));
  };

  const handleDoubleTap = (e: React.MouseEvent | React.TouchEvent, post: CommunityPost) => {
      const now = Date.now();
      if (now - lastTap < 300) {
          hapticFeedback([20, 30, 20]);
          // Fireflies rise from wherever the explorer tapped
          const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const pt = 'clientX' in e ? e : (e as React.TouchEvent).changedTouches?.[0];
          const key = now;
          setWonderBurst({ x: pt ? pt.clientX - box.left : box.width / 2, y: pt ? pt.clientY - box.top : box.height / 2, key });
          window.setTimeout(() => setWonderBurst(b => b && b.key === key ? null : b), 1700);
          setLike(post, true);
          setLastTap(0);
          return;
      }
      setLastTap(now);
  };

  const handleSave = async () => {
      if (!activePost) return;
      if (!isMember) { askAccount('Create a free account to keep sightings you want to come back to.', handleSave); return; }
      const next = !isSaved;
      setIsSaved(next);
      try {
          await FirebaseService.toggleSave(activePost.id, next, activePost);
          track(next ? 'save' : 'unsave');
          showToast(next ? 'Kept in your collection' : 'Removed from your collection');
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
      } catch (err: any) {
          const msg = String(err?.message || '');
          showToast(/^(Field notes can't|You've already)/.test(msg) ? msg : 'Your field note could not be added. Please try again.');
      } finally {
          setSendingComment(false);
      }
  };

  // Standing beside names: how many species each field-note author (and the poster) has on their list.
  // Shown for everyone once every author's count has loaded, so no name looks more or less trusted by accident.
  const [speciesCounts, setSpeciesCounts] = useState<Record<string, number | null>>({});
  useEffect(() => {
      const ids = [...new Set([...(comments || []).map(c => c.userId), activePost?.userId].filter(Boolean) as string[])].filter(id => !(id in speciesCounts));
      if (!ids.length) return;
      let alive = true;
      Promise.all(ids.slice(0, 30).map(id => FirebaseService.getUserProfile(id).then(p => {
          const st: any = (p as any)?.stats;
          const n = st && typeof st.species === 'number' ? st.species : null;
          return [id, n] as const;
      }).catch(() => [id, null] as const)))
          .then(rows => { if (alive) setSpeciesCounts(prev => ({ ...prev, ...Object.fromEntries(rows) })); });
      return () => { alive = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, activePost?.userId]);
  const countsReady = (uids: string[]) => uids.every(u => typeof speciesCounts[u] === 'number');
  const speciesLine = (uid?: string) => { const n = uid ? speciesCounts[uid] : null; return typeof n === 'number' ? `${n} species` : ''; };

  // Who has put a name to this sighting: their notes count as observations
  const [identifierIds, setIdentifierIds] = useState<Set<string>>(new Set());
  useEffect(() => {
      if (!isCommentsOpen || !activePost?.isPublic) { setIdentifierIds(new Set()); return; }
      let alive = true;
      FirebaseService.getIdentifications(activePost.id).then(ids => { if (alive) setIdentifierIds(new Set(ids.map(i => i.id))); }).catch(() => {});
      return () => { alive = false; };
  }, [isCommentsOpen, activePost?.id, activePost?.isPublic]);

  /** Field notes readers see: blocked authors and promotional spam are hidden. The post's author still sees spam, flagged, so they can delete it. */
  const isPostOwner = !!activePost && activePost.userId === currentUserMode.userId;
  const visibleComments = comments.filter(c => !blockedIds.includes(c.userId) && (!looksLikeSpam(c.text) || isPostOwner || c.userId === currentUserMode.userId));
  /** A note that adds to the record (field marks, behaviour, a longer description, or from the poster or an identifier) rather than chatter. */
  const FIELD_MARK = /\b(wing|wings|tail|beak|bill|crest|crown|throat|breast|belly|eye|eyes|ring|stripe|stripes|striped|bar|barred|spot|spots|spotted|patch|band|banded|plumage|feather|legs?|antenna|antennae|thorax|abdomen|leaf|leaves|petal|petals|stem|bark|cap|gills?|stipe|spore|spores|ridges?|veins?|call|song|calls|sings|nest|nesting|perched|feeding|foraging|juvenile|female|male|adult|immature|instar|larva|size|cm|mm|length|habitat|flowering|fruiting|underside|upperside|margin|lobed|serrated|compare|distinguish|differs?|rather than|not a)\b/i;
  const isObservation = (c: Comment) => !looksLikeSpam(c.text) && (
      (!!activePost && c.userId === activePost.userId && c.text.trim().length >= 25)
      || identifierIds.has(c.userId)
      || c.text.trim().length >= 140
      || (c.text.trim().length >= 30 && FIELD_MARK.test(c.text)));
  const observationNotes = visibleComments.filter(isObservation);
  const chatterNotes = visibleComments.filter(c => !isObservation(c));
  const showSpeciesCounts = countsReady([...new Set(visibleComments.map(c => c.userId))]);

  const renderNote = (c: Comment) => activePost && (
                                <div key={c.id} className="flex gap-3 group animate-fade-in motion-reduce:animate-none">
                                    <button onClick={() => { setIsCommentsOpen(false); handleProfileClick(c.userId); }} aria-label={`View ${c.userName}`} className="shrink-0">
                                        {c.avatarUrl ? <img src={c.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" /> : <span className="w-9 h-9 rounded-full bg-theme-primary/10 flex items-center justify-center text-theme-primary font-bold text-sm" aria-hidden="true">{(c.userName || '?').charAt(0).toUpperCase()}</span>}
                                    </button>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-stone-900 leading-snug"><button onClick={() => { setIsCommentsOpen(false); handleProfileClick(c.userId); }} className="font-bold mr-1.5">{c.userName}</button><RichText className="whitespace-pre-line break-words" text={c.text} onMention={openMention} onTag={handleTagClick} /></p>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-stone-500 flex-wrap">
                                            <span>{[showSpeciesCounts ? speciesLine(c.userId) : '', timeAgo(c.timestamp)].filter(Boolean).join(', ')}</span>
                                            {looksLikeSpam(c.text) && isPostOwner && <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200 font-semibold">Looks like spam, hidden from others</span>}
                                            {isMember && c.userId !== currentUserMode.userId && (
                                                <button onClick={() => { setNewComment(prev => `@${c.userName} ${prev}`.slice(0, 1000)); (document.getElementById('new-comment') as HTMLInputElement | null)?.focus(); }} className="font-semibold hover:text-stone-800">Reply</button>
                                            )}
                                            {(c.userId === currentUserMode.userId || activePost.userId === currentUserMode.userId) && (
                                                <button onClick={() => handleDeleteComment(c.id)} className="font-semibold hover:text-red-700">Delete</button>
                                            )}
                                        </div>
                                    </div>
                                </div>
  );

  const handleDeleteComment = async (commentId: string) => {
      if (!activePost || !window.confirm('Delete this field note?')) return;
      try {
          await FirebaseService.deleteComment(activePost.id, commentId);
      } catch { showToast('Could not delete the field note.'); }
  };

  const handleProfileClick = (userId: string) => {
      onViewProfile?.(userId);
  };

  const navigateSequential = (direction: 'next' | 'prev') => {
    if (!activePost) return;
    const currentIndex = displayPosts.findIndex(p => p.id === activePost.id);
    if (currentIndex === -1) return;
    
    let nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex >= 0 && nextIndex < displayPosts.length) {
        setActivePost(displayPosts[nextIndex]);
        setActiveItemIndex(0);
        if (contentContainerRef.current) contentContainerRef.current.scrollTop = 0;
        if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
    }
  };

  const closeDetail = () => {
    if (historyPushedRef.current || window.location.pathname.startsWith('/post/')) {
        historyPushedRef.current = false;
        const back = returnPathRef.current && !returnPathRef.current.startsWith('/post/') ? returnPathRef.current : (isJournalOnly ? '/journal' : '/feed');
        window.history.replaceState({}, '', back);
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
    <div id="community-scroll-container" className="w-full relative">
        {/* Field-guide page for a species */}
        {selectedSpecies && (() => {
            const g = speciesPage.group;
            return (
            <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center sm:p-6 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="species-title">
                <div className="absolute inset-0 bg-theme-shadow/70 backdrop-blur-sm" onClick={() => setSelectedSpecies(null)} aria-hidden="true"></div>
                <div className="relative w-full max-w-lg bg-[#fbf7ef] rounded-t-[1.5rem] sm:rounded-[4px] overflow-hidden shadow-2xl animate-slide-up flex flex-col max-h-[88vh] sm:max-h-[82vh]">
                    <div className="m-2 sm:m-3 border border-[#d8ccb6] outline outline-1 outline-offset-[3px] outline-[#e8dfcd] flex flex-col min-h-0 flex-1">
                        <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3 border-b border-[#e3d8c4]">
                            <div className="flex items-start gap-3 min-w-0">
                                <span className="w-10 h-10 rounded-full border border-[#d8ccb6] text-theme-accent flex items-center justify-center shrink-0">
                                    <Glyph name={GROUP_GLYPH[g]} size={22} />
                                </span>
                                <div className="min-w-0">
                                    <h3 id="species-title" className="text-2xl font-display italic font-medium text-[#2f2a22] leading-tight">{selectedSpecies.name}</h3>
                                    {speciesPage.scientific && <p className="font-display italic text-sm text-[#8a7a60] mt-0.5">{speciesPage.scientific}</p>}
                                    <p className="text-xs text-stone-500 mt-1">{g}</p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedSpecies(null)} aria-label="Close" className="w-10 h-10 -mr-2 -mt-1 rounded-full flex items-center justify-center text-stone-500 hover:text-stone-800 hover:bg-[#efe7d6] transition-colors shrink-0">
                                <span className="material-symbols-outlined text-2xl" aria-hidden="true">close</span>
                            </button>
                        </div>

                        <div className="px-5 py-5 overflow-y-auto hidden-scrollbar flex-1 space-y-5">
                            <dl className="grid grid-cols-2 gap-3">
                                <div className="rounded-[3px] bg-white/70 border border-[#e8dfcd] px-3 py-2.5">
                                    <dt className="text-xs text-stone-500">Seen by</dt>
                                    <dd className="font-display text-lg text-[#2f2a22]">{speciesPage.explorers} {speciesPage.explorers === 1 ? 'explorer' : 'explorers'}</dd>
                                </div>
                                <div className="rounded-[3px] bg-white/70 border border-[#e8dfcd] px-3 py-2.5">
                                    <dt className="text-xs text-stone-500">Your sightings</dt>
                                    <dd className="font-display text-lg text-[#2f2a22]">{isMember ? speciesPage.mine : '–'}</dd>
                                </div>
                            </dl>
                            {speciesPage.months && (
                                <p className="text-sm text-stone-700 flex items-center gap-2">
                                    <Glyph name="sun" size={16} className="text-theme-accent" />
                                    Recorded here in {speciesPage.months}
                                </p>
                            )}

                            {speciesData?.loading ? (
                                <PressingLoader label={`Looking up ${selectedSpecies.name}`} className="py-8" />
                            ) : (
                                <>
                                    {speciesData?.thumbnail && (
                                        <figure className="bg-white p-1.5 border border-[#e8dfcd] shadow-[0_1px_2px_rgba(60,40,20,0.12)]">
                                            <img src={speciesData.thumbnail} className="w-full aspect-[16/10] object-cover sepia-[.06]" alt={selectedSpecies.name} />
                                        </figure>
                                    )}
                                    {speciesData?.extract && (
                                        <p className="text-[16px] font-display text-stone-800 leading-relaxed">{speciesData.extract}</p>
                                    )}
                                    <p className="text-[11px] text-stone-500 leading-snug">
                                        {speciesData?.url
                                            ? <>From Wikipedia, under CC BY-SA. <a href={speciesData.url} target="_blank" rel="noopener noreferrer" className="underline">Read the full article</a>.</>
                                            : 'Encyclopedia text from Wikipedia when available.'}
                                    </p>
                                </>
                            )}

                            {speciesPage.lookAlikes.length > 0 && (
                                <section aria-labelledby="lookalikes" className="pt-4 border-t border-[#e3d8c4]">
                                    <h4 id="lookalikes" className="font-display text-base text-[#2f2a22]">Look-alikes</h4>
                                    <p className="text-xs text-stone-500 mb-2">Other names the guide weighed for this sighting</p>
                                    <ul className="space-y-1.5" role="list">
                                        {speciesPage.lookAlikes.map(l => (
                                            <li key={l.name}>
                                                <button onClick={() => handleSpeciesClick(l.name, selectedSpecies.location)} className="text-left w-full">
                                                    <span className="font-display italic text-theme-primary hover:underline">{l.name}</span>
                                                    {l.scientific && <span className="font-display italic text-xs text-stone-500"> {l.scientific}</span>}
                                                    {l.evidence && <span className="block text-xs text-stone-600 leading-snug">{l.evidence}</span>}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            );
        })()}

        {/* Custom Confirmation Modal */}
        {confirmDeleteId && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 animate-fade-in">
                <div className="absolute inset-0 bg-theme-shadow/80 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)}></div>
                <div className="relative w-full max-w-sm bg-white rounded-[2.5rem] p-8 shadow-2xl animate-slide-up border border-theme-primary/10">
                    <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mb-6 mx-auto">
                        <span className="material-symbols-outlined text-3xl">delete_forever</span>
                    </div>
                    <h3 className="text-2xl font-display font-semibold text-theme-primary text-center mb-3">Delete this sighting?</h3>
                    <p className="text-sm text-theme-primary/60 text-center leading-relaxed mb-8">
                        It will be removed from the feed and your journal. This can't be undone.
                    </p>
                    <div className="flex flex-col gap-3">
                        <button 
                            onClick={executeDelete}
                            className="w-full py-4 bg-red-600 text-white font-semibold text-sm rounded-full shadow-lg shadow-red-500/20 active:scale-95 transition-all"
                        >
                            Delete sighting
                        </button>
                        <button 
                            onClick={() => setConfirmDeleteId(null)}
                            className="w-full py-4 bg-theme-primary/5 text-theme-primary/70 font-semibold text-sm rounded-full active:scale-95 transition-all"
                        >
                            Keep it
                        </button>
                    </div>
                </div>
            </div>
        )}

        {!detailOnly && (<>
        {/* Field guide header */}
        <div className="w-full px-4 md:px-12 pt-10 pb-6 flex flex-col gap-5 animate-fade-in border-b border-theme-primary/10 select-none relative z-50">
            <div className="flex items-start justify-between gap-4">
                <button
                    type="button"
                    onClick={() => onLogoClick?.()}
                    aria-label={isJournalOnly ? 'Scroll to top of journal' : 'NatureGram home'}
                    className="text-left hover:opacity-80 active:scale-95 transition-all rounded-lg min-w-0"
                >
                    <h2 className="text-2xl md:text-3xl font-display font-semibold text-theme-primary">
                        {isJournalOnly ? "My Journal" : "NatureGram"}
                    </h2>
                    {!isJournalOnly && (
                        <p className="text-sm text-theme-primary/70 mt-1 flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[17px] text-theme-accent" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">{moment.icon}</span>
                            <span>{moment.name}: {moment.hint}</span>
                        </p>
                    )}
                </button>

                <div className="flex items-center gap-0.5 shrink-0">
                    {headerActions}
                    {!isJournalOnly && onOpenActivity && (
                        <button onClick={onOpenActivity} aria-label={unreadActivity ? `Activity, ${unreadActivity} new` : 'Activity'} className="relative w-11 h-11 rounded-full flex items-center justify-center text-theme-primary hover:bg-theme-primary/5">
                            <Glyph name="tracks" size={24} />
                            {unreadActivity > 0 && <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-theme-accent ring-2 ring-day-bg" aria-hidden="true" />}
                        </button>
                    )}
                    {!isJournalOnly && onOpenMessages && (
                        <button onClick={onOpenMessages} aria-label={unreadMessages ? `Letters, ${unreadMessages} unread` : 'Letters'} className="relative w-11 h-11 rounded-full flex items-center justify-center text-theme-primary hover:bg-theme-primary/5">
                            <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">{unreadMessages > 0 ? 'mark_email_unread' : 'mail'}</span>
                            {unreadMessages > 0 && <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-theme-accent ring-2 ring-day-bg" aria-hidden="true" />}
                        </button>
                    )}
                    {onViewDrafts && activeDraftsCount > 0 && (
                        <button 
                            onClick={onViewDrafts} 
                            className="relative w-11 h-11 rounded-full hover:bg-theme-primary/5 flex items-center justify-center text-theme-primary active:scale-95 transition-all"
                            aria-label={activeDraftsCount > 0 ? `Unfinished pages, ${activeDraftsCount}` : 'Unfinished pages'}
                        >
                            <Glyph name="satchel" size={24} />
                            {activeDraftsCount > 0 ? (
                                <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-theme-accent rounded-full ring-2 ring-day-bg flex items-center justify-center text-[11px] font-bold text-white">
                                    {activeDraftsCount}
                                </span>
                            ) : null}
                        </button>
                    )}
                </div>
            </div>

            {!isJournalOnly && (
                <div className="flex items-center gap-6" role="tablist" aria-label="What to show">
                    {([['foryou', 'Wander'], ['following', 'Fellow explorers']] as const).map(([key, label]) => (
                        <button
                            key={key}
                            role="tab"
                            aria-selected={feedMode === key}
                            onClick={() => {
                                if (key === 'following' && !isMember) { askAccount('Create a free account to follow explorers and gather their sightings here.'); return; }
                                setFeedMode(key);
                            }}
                            className={`relative py-2 text-[15px] font-medium transition-colors ${feedMode === key ? 'text-theme-primary' : 'text-theme-primary/50 hover:text-theme-primary/80'}`}
                        >
                            {label}
                            <span className={`absolute left-0 -bottom-0.5 h-[2px] rounded-full bg-theme-accent transition-all duration-500 ${feedMode === key ? 'w-full opacity-100' : 'w-0 opacity-0'}`} aria-hidden="true" />
                        </button>
                    ))}
                </div>
            )}

            {freshRail.length > 0 && feedMode === 'foryou' && (
                <section aria-label="Fresh sightings from explorers you follow">
                    <p className="text-sm font-medium text-theme-primary/70 mb-2">Fresh tracks</p>
                    <ul className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1" role="list">
                        {freshRail.map(r => (
                            <li key={r.userId} className="shrink-0">
                                <button onClick={() => handlePostClick(r.post)} className="group flex flex-col items-start gap-1.5 w-[84px] text-left" aria-label={`${r.post.labels?.[0] || 'New sighting'} from ${r.userName}${r.count > 1 ? `, ${r.count} new sightings` : ''}`}>
                                    <span className="relative block w-[84px] h-[100px] rounded-xl overflow-hidden bg-theme-primary/10 border border-theme-primary/10">
                                        {(r.post.thumbnailUrl || r.post.imageUrl)
                                            ? <img src={(r.post.thumbSmallUrl || r.post.thumbnailUrl || r.post.imageUrl)!} alt="" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                                            : <span className="w-full h-full flex items-center justify-center text-theme-primary/60"><span className="material-symbols-outlined" aria-hidden="true">{r.post.mediaType === 'audio' ? 'graphic_eq' : 'park'}</span></span>}
                                        {r.count > 1 && <span className="absolute top-1.5 right-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-black/45 backdrop-blur text-white text-[11px] font-semibold flex items-center justify-center tabular">{r.count}</span>}
                                    </span>
                                    <span className="text-xs font-display italic font-semibold text-theme-primary truncate w-full leading-tight">{r.post.labels?.[0] || 'New sighting'}</span>
                                    <span className="text-[11px] text-stone-500 truncate w-full -mt-1">{r.userName}</span>
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
                    aria-label={`${dailyTheme.naturalist}'s challenge: ${themeExtra.challenge} See sightings tagged ${themeExtra.challengeTag}.`}
                    className="w-full text-left rounded-2xl px-4 py-3 border border-theme-primary/15 hover:bg-theme-primary/5 flex items-start gap-3 transition-colors"
                >
                    <span className="material-symbols-outlined text-[22px] text-theme-accent shrink-0 mt-px" style={{ fontVariationSettings: challenge?.mine ? "'FILL' 1" : "'wght' 300" }} aria-hidden="true">{challenge?.mine ? 'verified' : 'flag'}</span>
                    <span className="flex-1 min-w-0">
                        <span className="block text-[15px] text-theme-primary leading-snug">{themeExtra.challenge}</span>
                        <span className="block text-xs text-stone-500 mt-1">
                            {[`${dailyTheme.naturalist}'s challenge`, `${themePeriod.daysRemaining} days left`, challenge?.mine ? 'you answered' : challenge?.explorers ? `${challenge.capped ? '60+' : challenge.explorers} answered` : null].filter(Boolean).join(' · ')}
                        </span>
                    </span>
                </button>
            )}

            {/* Search, with a cancel state while focused */}
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

                    {/* Cancel while focused */}
                    {isSearchFocused && (
                        <button 
                            onClick={() => {
                                setIsSearchFocused(false);
                                setSearchQuery("");
                            }}
                            className="text-sm font-medium text-theme-accent hover:opacity-70 transition-all cursor-pointer animate-fade-in px-1"
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
                        className={`p-3 px-4 rounded-2xl border border-none transition-all flex items-center gap-1.5 font-medium text-sm cursor-pointer ${
                            showFilters || mediaFilter !== 'all' || dateFilter !== 'all' || selectedLabels.length > 0 || selectedGroups.length > 0 || searchTag
                                ? 'bg-theme-accent/15 text-theme-accent' 
                                : 'bg-stone-100 text-theme-primary/60 hover:bg-stone-200/50'
                        }`}
                    >
                        <span className="material-symbols-outlined text-base" aria-hidden="true">tune</span>
                        <span className="hidden sm:inline">Filters</span><span className="sr-only sm:hidden">Filters</span>
                    </button>
                </div>

                {/* Search suggestions */}
                {isSearchFocused && (
                    <div className="absolute top-[105%] left-0 right-0 bg-white border border-theme-primary/10 rounded-2xl p-5 shadow-2xl animate-slide-up flex flex-col gap-5 max-h-[380px] overflow-y-auto no-scrollbar z-[160]">
                        <div className="flex items-center justify-between border-b border-theme-primary/5 pb-2">
                            <span className="text-sm font-display text-theme-primary/75">Where to look</span>
                            <button 
                                onClick={() => setIsSearchFocused(false)} 
                                className="text-xs font-semibold text-theme-primary/55 hover:text-theme-primary"
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
                                        <p className="text-sm font-display text-stone-600 mb-1.5">Explorers</p>
                                        {serverUsers.map(u => (
                                            <button key={u.uid} onClick={() => { setIsSearchFocused(false); onViewProfile?.(u.uid); }} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-stone-50 text-left">
                                                {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" /> : <span className="w-10 h-10 rounded-full bg-theme-primary/10 flex items-center justify-center font-bold text-theme-primary" aria-hidden="true">{u.username?.charAt(0).toUpperCase()}</span>}
                                                <span className="min-w-0"><span className="block font-semibold text-stone-900 truncate">{u.username}</span><span className="block text-xs text-stone-500 truncate">{u.bio || `${u.stats?.observations || 0} sightings shared`}</span></span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Species & Hashtags Suggestions */}
                        {dynamicSuggestions.tags.length > 0 && (
                            <div className="space-y-2">
                                <span className="text-sm font-medium text-theme-primary/70 flex items-center gap-1">
                                    <span className="material-symbols-outlined text-xs text-theme-accent">local_offer</span>
                                    Popular tags
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                    {dynamicSuggestions.tags.map((tag) => (
                                        <button
                                            key={tag}
                                            onClick={() => {
                                                setSearchQuery(tag.startsWith('#') ? tag : `#${tag}`);
                                                setIsSearchFocused(false);
                                            }}
                                            className="px-3 py-1.5 bg-stone-50 hover:bg-theme-accent/5 hover:text-theme-accent border border-theme-primary/5 text-sm rounded-lg transition-all text-theme-primary/75"
                                        >
                                            {tag}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Explorers seen in loaded sightings */}
                        {dynamicSuggestions.creators.length > 0 && !isJournalOnly && (
                            <div className="space-y-2.5">
                                <span className="text-sm font-medium text-theme-primary/70 flex items-center gap-1">
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
                                            <div className="w-6 h-6 rounded-full bg-theme-primary/10 flex items-center justify-center text-xs font-semibold text-theme-primary">
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
                                <span className="text-sm font-medium text-theme-primary/70 flex items-center gap-1">
                                    <span className="material-symbols-outlined text-xs text-theme-accent">distance</span>
                                    Recent habitats
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

                {/* Filters drawer */}
                {showFilters && (() => {
                    const seg = (on: boolean) => `px-3 py-1.5 text-sm rounded-full border transition-colors ${on ? 'bg-theme-primary border-theme-primary text-white' : 'border-theme-primary/15 text-theme-primary/75 hover:bg-theme-primary/5'}`;
                    const naturalistShort = (themePeriod.theme?.naturalist || '').split(' ').slice(-1)[0];
                    return (
                    <div className="p-5 bg-white border border-theme-primary/10 rounded-2xl flex flex-col gap-5 animate-slide-up shadow-md">
                        {groupsPresent.length > 0 && (
                            <fieldset className="space-y-2">
                                <legend className="text-sm font-display text-theme-primary mb-2">Kind of life</legend>
                                <div className="flex flex-wrap gap-1.5">
                                    {groupsPresent.map(g => {
                                        const on = selectedGroups.includes(g);
                                        return (
                                            <button key={g} type="button" aria-pressed={on} onClick={() => setSelectedGroups(prev => on ? prev.filter(x => x !== g) : [...prev, g])} className={`${seg(on)} flex items-center gap-1.5`}>
                                                <Glyph name={GROUP_GLYPH[g]} size={15} />{g}
                                            </button>
                                        );
                                    })}
                                </div>
                            </fieldset>
                        )}

                        <fieldset className="space-y-2">
                            <legend className="text-sm font-display text-theme-primary mb-2">Season</legend>
                            <div className="flex flex-wrap gap-1.5">
                                {([
                                    ['all', 'Any time', ''],
                                    ['today', 'Today', ''],
                                    ['fortnight', 'This fortnight', naturalistShort ? `Since ${naturalistShort}'s fortnight began` : ''],
                                    ['month', 'This month', ''],
                                    ['season', 'This season', ''],
                                ] as const).map(([key, label, hint]) => (
                                    <button key={key} type="button" aria-pressed={dateFilter === key} title={hint || undefined} onClick={() => setDateFilter(key)} className={seg(dateFilter === key)}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                            {dateFilter === 'fortnight' && naturalistShort && <p className="text-xs text-stone-500">Since {themePeriod.theme.naturalist}'s fortnight began, {themePeriod.daysRemaining} days left.</p>}
                        </fieldset>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            <fieldset className="space-y-2">
                                <legend className="text-sm font-display text-theme-primary mb-2">Kind of record</legend>
                                <div className="flex flex-wrap gap-1.5">
                                    {([['all', 'Any'], ['image', 'Photos'], ['video', 'Videos'], ['audio', 'Sounds']] as const).map(([media, label]) => (
                                        <button key={media} type="button" aria-pressed={mediaFilter === media} onClick={() => setMediaFilter(media)} className={seg(mediaFilter === media)}>{label}</button>
                                    ))}
                                </div>
                            </fieldset>
                            <fieldset className="space-y-2">
                                <legend className="text-sm font-display text-theme-primary mb-2">Order</legend>
                                <div className="flex flex-wrap gap-1.5">
                                    {([['newest', 'Newest first'], ['likes', 'Most marvelled'], ['title', 'A to Z']] as const).map(([opt, label]) => (
                                        <button key={opt} type="button" aria-pressed={sortOrder === opt} onClick={() => setSortOrder(opt)} className={seg(sortOrder === opt)}>{label}</button>
                                    ))}
                                </div>
                            </fieldset>
                        </div>

                        {allAvailableLabels.length > 0 && (
                            <fieldset className="space-y-2 pt-4 border-t border-theme-primary/5">
                                <legend className="text-sm font-display text-theme-primary mb-2">A particular species</legend>
                                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-2 no-scrollbar">
                                    {allAvailableLabels.map((lbl) => {
                                        const isSelected = selectedLabels.includes(lbl);
                                        return (
                                            <button key={lbl} type="button" aria-pressed={isSelected} onClick={() => toggleLabelFilter(lbl)} className={`${seg(isSelected)} italic`}>
                                                {lbl}
                                            </button>
                                        );
                                    })}
                                </div>
                            </fieldset>
                        )}
                    </div>
                    );
                })()}
            </div>

            {/* Category pills */}
            <div className="w-full overflow-x-auto no-scrollbar flex items-center gap-1.5 py-1 -mx-4 px-4 scroll-smooth">
                {[
                    { id: 'all', label: 'All' },
                    { id: 'fauna', label: 'Animals' },
                    { id: 'flora', label: 'Plants' },
                    { id: 'fungi', label: 'Fungi' },
                    { id: 'audio', label: 'Sounds' },
                    { id: 'video', label: 'Videos' },
                    { id: 'popular', label: 'Most marvelled' },
                ].map((tab) => {
                    const isActive = activeExploreTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setActiveExploreTab(tab.id as any);
                                hapticFeedback();
                            }}
                            aria-pressed={isActive}
                            className={`px-3.5 py-1.5 text-sm font-medium rounded-full transition-colors shrink-0 border cursor-pointer ${
                                isActive 
                                    ? 'bg-theme-primary text-white border-theme-primary' 
                                    : 'border-theme-primary/15 text-theme-primary/75 hover:bg-theme-primary/5'
                            }`}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {searchTag && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-stone-50 border border-theme-primary/10 rounded-2xl">
                    <p className="text-sm text-stone-700 flex items-center gap-2"><Glyph name="tag" size={16} className="text-theme-accent" />Every sighting tagged <strong className="text-theme-primary">#{searchTag}</strong></p>
                    <button onClick={() => setSearchTag(null)} className="text-sm font-semibold text-theme-accent">Clear</button>
                </div>
            )}

            {/* Reset status bar if any dynamic filter keyword is active */}
            {(searchQuery.trim() || activeExploreTab !== 'all' || mediaFilter !== 'all' || dateFilter !== 'all' || selectedLabels.length > 0 || selectedGroups.length > 0 || searchTag) && (
                <div className="flex items-center justify-between gap-3 p-3 bg-stone-50 border border-theme-primary/5 rounded-2xl">
                    <div className="text-xs font-semibold text-theme-primary/60 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-theme-accent rounded-full animate-pulse"></span>
                        <span>Filters on{posts.length && !isJournalOnly ? ` · searching ${posts.length} loaded posts` : ''}</span>
                    </div>
                    <button 
                        onClick={resetAllFilters}
                        className="text-sm font-semibold text-theme-accent hover:opacity-80 transition-all flex items-center gap-1 cursor-pointer"
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
                    {[...Array(10)].map((_, i) => <SkeletonPost key={i} tall={i % 3 === 0} />)}
                </div>
            ) : error ? (
                <div role="alert" className="py-20 flex flex-col items-center justify-center text-center px-8 max-w-xl mx-auto my-12 animate-fade-in">
                    <span className="material-symbols-outlined text-5xl text-theme-primary/60 mb-6" aria-hidden="true">cloud_off</span>
                    <h3 className="text-xl font-display font-semibold text-stone-900 mb-3">The field guide didn't load</h3>
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
                    <span className="material-symbols-outlined text-5xl text-theme-primary/25 mb-6 select-none" style={{ fontVariationSettings: "'wght' 200" }} aria-hidden="true">{feedMode === 'following' && !searchQuery ? 'nature_people' : isJournalOnly && !searchQuery && !searchTag ? 'fingerprint' : 'travel_explore'}</span>
                    {feedMode === 'following' && !searchQuery ? (
                        <>
                            <h3 className="text-xl font-display text-stone-800 mb-2 font-semibold">No fellow explorers yet</h3>
                            <p className="text-base text-stone-600 max-w-xs mb-8">Follow explorers from their sightings.</p>
                            <button onClick={() => setFeedMode('foryou')} className="px-8 py-3.5 bg-theme-primary text-white font-bold text-sm rounded-full">Wander</button>
                        </>
                    ) : isJournalOnly && !searchQuery && !searchTag ? (
                        <>
                            <h3 className="text-xl font-display text-stone-800 mb-2 font-semibold">Your journal starts outside</h3>
                            <p className="text-base text-stone-600 max-w-xs">Your sightings will gather here.</p>
                        </>
                    ) : (
                        <>
                            <h3 className="text-xl font-display text-stone-800 mb-2 font-semibold">Nothing found here yet</h3>
                            <p className="text-base text-stone-600 max-w-xs mb-8">Try another word.</p>
                            <button onClick={resetAllFilters} className="px-8 py-3.5 bg-theme-primary text-white font-bold text-sm rounded-full">Clear filters</button>
                        </>
                    )}
                </div>
            ) : (
                <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-2 md:gap-4 space-y-2 md:space-y-4">
                    {displayPosts.map((post) => (
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
                        <PressingLoader size={28} label="Finding more sightings" />
                    ) : loadMoreState === 'error' ? (
                        <button onClick={() => { setLoadMoreState('idle'); loadMore(); }} className="font-semibold text-theme-accent">Couldn't load more. Tap to retry</button>
                    ) : !hasMore && !isJournalOnly ? (
                        <span className="font-display text-base text-theme-primary/70">That's every sighting for now. The next one is outside.</span>
                    ) : null}
                </div>
            )}
        </div>
        </>)}

        <>
        {activePost && (
            <div 
                onTouchStart={handleSwipeTouchStart}
                onTouchEnd={handleSwipeTouchEnd}
                className="animate-in fade-in slide-in-from-bottom-4 duration-200 fixed inset-0 z-[150] bg-white md:bg-theme-shadow flex flex-col h-full w-full overflow-hidden"
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
                            className="fixed left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/90 hover:bg-white text-stone-800 flex items-center justify-center shadow-lg border border-stone-100 z-[180] active:scale-95 transition-all text-xl md:flex hidden"
                            aria-label="Previous post"
                        >
                            <span className="material-symbols-outlined text-3xl text-stone-700" aria-hidden="true">chevron_left</span>
                        </button>
                    )}
                    {activePostIndex !== -1 && activePostIndex < displayPosts.length - 1 && (
                        <button 
                            onClick={() => navigateSequential('next')}
                            className="fixed right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/90 hover:bg-white text-stone-800 flex items-center justify-center shadow-lg border border-stone-100 z-[180] active:scale-95 transition-all text-xl md:flex hidden"
                            aria-label="Next post"
                        >
                            <span className="material-symbols-outlined text-3xl text-stone-700" aria-hidden="true">chevron_right</span>
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
                                        <button role="menuitem" onClick={async () => { setPostMenuOpen(false); const next = !activePost.isPublic; try { await FirebaseService.updatePost(activePost.id, { isPublic: next } as any); setActivePost(p => p ? { ...p, isPublic: next } : p); showToast(next ? 'Now visible in the feed' : 'Now only in your journal'); } catch (err: any) { showToast(err?.message || 'Could not change visibility.'); } }} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-stone-50 flex items-center gap-3 text-sm font-semibold"><span className="material-symbols-outlined text-xl" aria-hidden="true">{activePost.isPublic ? 'lock' : 'public'}</span>{activePost.isPublic ? 'Make journal-only' : 'Share to feed'}</button>
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

                <div 
                    key={activePost.id}
                    ref={mainScrollRef}
                    className="animate-in fade-in slide-in-from-right-4 duration-200 flex-1 flex flex-col md:flex-row [@media(orientation:landscape)_and_(max-height:500px)]:flex-row overflow-hidden bg-white w-full h-full"
                >
                    {(() => {
                        const currentItem = activePost.items && activePost.items.length > 0 ? activePost.items[activeItemIndex] : activePost;
                        const hasMultipleItems = activePost.items && activePost.items.length > 1;
                        
                        return (
                            <>
                                <div
                                    className="flex-1 min-h-0 bg-theme-primary/5 flex flex-col justify-center relative group/media overflow-hidden"
                                    onClick={(e) => { if ((e.target as HTMLElement).closest('button,video,audio')) return; handleDoubleTap(e, activePost); }}
                                    onContextMenu={(e) => { if (activePost.userId !== currentUserMode.userId) e.preventDefault(); }}
                                >
                                    {wonderBurst && <WonderBurst key={wonderBurst.key} x={wonderBurst.x} y={wonderBurst.y} />}
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
                                                            <SightingVideo src={item.videoUrl} poster={item.thumbnailUrl || item.imageUrl} noDownload={activePost.userId !== currentUserMode.userId} label={item.labels?.[0]} />
                                                        ) : item.mediaType === 'audio' ? (
                                                            <SightingSound src={item.audioUrl} image={item.thumbnailUrl || item.imageUrl} noDownload={activePost.userId !== currentUserMode.userId} label={item.labels?.[0]} />
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
                                                <SightingVideo src={currentItem.videoUrl} poster={currentItem.thumbnailUrl || currentItem.imageUrl} noDownload={activePost.userId !== currentUserMode.userId} label={currentItem.labels?.[0]} />
                                            ) : currentItem.mediaType === 'audio' ? (
                                                <SightingSound src={currentItem.audioUrl} image={currentItem.thumbnailUrl || currentItem.imageUrl} noDownload={activePost.userId !== currentUserMode.userId} label={currentItem.labels?.[0]} />
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

                                <div className="w-full md:w-[400px] [@media(orientation:landscape)_and_(max-height:500px)]:w-[48%] [@media(orientation:landscape)_and_(max-height:500px)]:max-h-none [@media(orientation:landscape)_and_(max-height:500px)]:border-t-0 [@media(orientation:landscape)_and_(max-height:500px)]:border-l shrink-0 max-h-[45vh] md:max-h-none border-t md:border-t-0 md:border-l border-theme-primary/10 bg-white flex flex-col hidden-scrollbar">
                                    <div className="px-4 pt-3 pb-3 md:px-6 flex items-center justify-between gap-3 shrink-0 border-b border-theme-primary/5">
                                        <button className="flex items-center gap-3 group text-left min-w-0" onClick={() => handleProfileClick(activePost.userId)}>
                                            {activePost.userAvatar
                                                ? <img src={activePost.userAvatar} alt="" className="w-10 h-10 rounded-full object-cover border border-theme-primary/15" />
                                                : <span className="w-10 h-10 rounded-full bg-theme-primary/10 border border-theme-primary/15 flex items-center justify-center text-theme-primary font-bold text-sm" aria-hidden="true">{(activePost.userName || '?').charAt(0).toUpperCase()}</span>}
                                            <span className="min-w-0">
                                                <span className="block font-bold text-sm text-theme-primary truncate group-hover:text-theme-accent transition-colors">{activePost.userName}{speciesLine(activePost.userId) && <span className="font-normal text-stone-500"> · {speciesLine(activePost.userId)}</span>}</span>
                                                <span className="block text-xs text-stone-500 truncate">{[(currentItem.locationArea || '').trim() || 'Somewhere wild', timeAgo(activePost.timestamp)].filter(Boolean).join(', ')}</span>
                                            </span>
                                        </button>
                                        {(() => { const liked = isLikedByMe(activePost); const n = likeTotal(activePost); return (
                                            <button
                                                onClick={(e) => handleLike(e, activePost)}
                                                aria-pressed={liked}
                                                aria-label={liked ? `You marvelled at this. ${wonderLabel(n)}` : `Marvel at this sighting. ${wonderLabel(n)}`}
                                                className={`shrink-0 flex items-center gap-1.5 h-10 pl-3 pr-3.5 rounded-full border transition-all duration-300 active:scale-95 ${liked ? 'bg-theme-accent border-theme-accent text-white shadow-md shadow-theme-accent/30' : 'border-theme-primary/15 text-theme-accent hover:bg-theme-accent/5'}`}
                                            >
                                                <WonderIcon active={liked} className="text-[20px]" />
                                                <span className="text-sm font-semibold tabular">{n > 0 ? n.toLocaleString() : 'Marvel'}</span>
                                            </button>
                                        ); })()}
                                    </div>
                                    <div className="p-4 md:p-6 flex-1 overflow-y-auto hidden-scrollbar flex flex-col space-y-6">
                                        {activePost.curatorNote && (
                                            <p className="text-sm text-stone-600 bg-stone-50 rounded-xl px-3 py-2 flex gap-2"><Glyph name="guide" size={16} className="text-theme-accent mt-0.5" /><span><strong className="text-stone-800">Why you're seeing this:</strong> {activePost.curatorNote}</span></p>
                                        )}
                                        {(() => {
                                            const species = currentItem.labels?.[0];
                                            const behaviour = observedBehaviour(currentItem.behavior);
                                            const alsoSeen = (currentItem.labels || []).slice(1);
                                            const insight = currentItem.aiInsight ? (insightBeyond(currentItem.aiInsight, behaviour).length ? insightBeyond(currentItem.aiInsight, behaviour) : currentItem.aiInsight.split(/\n+/).filter(Boolean)) : [];
                                            return (
                                                <>
                                                    <div>
                                                        {species ? (
                                                            <button onClick={() => handleSpeciesClick(species, currentItem.locationArea)} className="text-left" aria-label={`About ${species}`}>
                                                                <h2 className="text-[28px] font-display italic font-medium text-theme-primary leading-tight hover:underline decoration-theme-accent/40 underline-offset-4">{species}</h2>
                                                            </button>
                                                        ) : activePost.title ? (
                                                            <h2 className="text-[26px] font-display font-medium text-theme-primary leading-tight">{activePost.title}</h2>
                                                        ) : null}
                                                        {behaviour && <p className="text-base text-stone-700 mt-1.5 leading-snug">{behaviour}</p>}
                                                        {alsoSeen.length > 0 && (
                                                            <p className="text-sm text-stone-600 mt-1">Also in view: {alsoSeen.map((l, i) => (
                                                                <React.Fragment key={l}>{i > 0 && ', '}<button onClick={() => handleSpeciesClick(l, currentItem.locationArea)} className="italic text-theme-primary hover:underline">{l}</button></React.Fragment>
                                                            ))}</p>
                                                        )}
                                                    </div>

                                                    {isFungiPost(currentItem as any) && <FungiWarning />}

                                                    {activePost.caption && (
                                                        <figure className="border-l-2 border-theme-accent/40 pl-4">
                                                            <blockquote className="text-[15px] text-stone-800 leading-relaxed whitespace-pre-line"><RichText text={activePost.caption} onMention={openMention} onTag={handleTagClick} /></blockquote>
                                                            <figcaption className="text-xs text-stone-500 mt-1.5">{activePost.userName}</figcaption>
                                                        </figure>
                                                    )}

                                                    {insight.length > 0 && (
                                                        <section aria-labelledby={`why-${activePost.id}`} className="pt-5 border-t border-theme-primary/10">
                                                            <h3 id={`why-${activePost.id}`} className="text-sm font-semibold text-theme-accent mb-2">Why it does this</h3>
                                                            <div className="space-y-3">
                                                                {insight.map((para, idx) => (
                                                                    <p key={idx} className="text-[17px] font-display text-stone-800 leading-[1.6]">{para}</p>
                                                                ))}
                                                            </div>
                                                        </section>
                                                    )}

                                                    {(activePost.items?.length || 0) > 1 && activePost.description && (
                                                        <p className="text-[15px] text-stone-700 leading-relaxed">{activePost.description}</p>
                                                    )}
                                                </>
                                            );
                                        })()}

                                        {activePost.isPublic && (
                                            <CommunityId
                                                key={activePost.id}
                                                postId={activePost.id}
                                                authorId={activePost.userId}
                                                primaryLabel={activePost.labels?.[0]}
                                                currentUserId={currentUserMode.userId}
                                                isMember={isMember}
                                                onRequireAccount={(r) => askAccount(r)}
                                            />
                                        )}

                                        {visibleTags(activePost).length > 0 && (
                                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                                                {visibleTags(activePost).map(tag => (
                                                    <button key={tag} onClick={() => handleTagClick(tag)} className="text-sm text-theme-accent hover:underline min-h-[32px]">
                                                        {tag.startsWith('#') ? tag : `#${tag}`}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        <div className="pt-4 border-t border-theme-primary/10 pb-4 md:pb-8 space-y-3">
                                            <button 
                                                onClick={() => setIsCommentsOpen(true)}
                                                className="w-full py-3 px-4 bg-theme-primary/5 hover:bg-theme-primary/10 rounded-xl flex items-center gap-3 transition-colors text-left"
                                            >
                                                <span className="material-symbols-outlined text-theme-accent text-xl" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">history_edu</span>
                                                <span className="flex-1 text-sm font-semibold text-theme-primary">{visibleComments.length ? `${visibleComments.length} field note${visibleComments.length === 1 ? '' : 's'}` : 'Add a field note'}</span>
                                                <span className="material-symbols-outlined text-theme-primary/60 text-sm" aria-hidden="true">chevron_right</span>
                                            </button>
                                            <div className="flex gap-2">
                                                <button onClick={handleSave} aria-pressed={isSaved} className={`flex-1 h-11 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${isSaved ? 'border-theme-accent/40 bg-theme-accent/10 text-theme-primary' : 'border-theme-primary/15 text-theme-primary/80 hover:bg-theme-primary/5'}`}>
                                                    <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: isSaved ? "'FILL' 1" : "'wght' 300" }} aria-hidden="true">filter_vintage</span>
                                                    {isSaved ? 'Kept' : 'Keep'}
                                                </button>
                                                <button onClick={() => setSharingPost(activePost)} className="flex-1 h-11 rounded-xl border border-theme-primary/15 text-theme-primary/80 hover:bg-theme-primary/5 text-sm font-semibold flex items-center justify-center gap-2">
                                                    <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">share</span>
                                                    Share
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        );
                    })()}
                </div>
    
    <>
        {isCommentsOpen && (
            <div className="fixed inset-0 z-[200] flex flex-col justify-end p-0 bg-black/60 backdrop-blur-sm font-body">
                <div 
                    className="absolute inset-0 animate-in fade-in duration-200" 
                    onClick={() => setIsCommentsOpen(false)}
                />
                <div 
                    ref={sheetRef}
                    onTouchStart={(e) => { sheetDrag.current = { y: e.touches[0].clientY, t: Date.now(), on: !!(e.target as HTMLElement).closest('[data-sheet-handle]') }; }}
                    onTouchMove={(e) => { const d = e.touches[0].clientY - sheetDrag.current.y; if (sheetDrag.current.on && d > 0 && sheetRef.current) sheetRef.current.style.transform = `translateY(${d}px)`; }}
                    onTouchEnd={(e) => { if (!sheetDrag.current.on) return; const d = e.changedTouches[0].clientY - sheetDrag.current.y; const v = d / Math.max(1, Date.now() - sheetDrag.current.t); if (sheetRef.current) sheetRef.current.style.transform = ''; if (d > 100 || v > 0.5) setIsCommentsOpen(false); }}
                    className="animate-in slide-in-from-bottom duration-300 transition-transform w-full max-w-md mx-auto bg-white rounded-t-[2.5rem] overflow-hidden shadow-2xl flex flex-col h-[75vh] relative z-10 pb-[env(safe-area-inset-bottom)]"
                >
                    <div data-sheet-handle className="w-full flex justify-center pt-4 pb-2 shrink-0 cursor-grab active:cursor-grabbing">
                        <div className="w-12 h-1.5 bg-theme-primary/30 rounded-full"></div>
                    </div>
                    
                    <div className="px-6 pb-4 flex justify-between items-center shrink-0 border-b border-theme-primary/10">
                        <h3 id="comments-title" className="font-display font-semibold text-xl text-theme-primary">Field notes</h3>
                        <button onClick={() => setIsCommentsOpen(false)} aria-label="Close field notes" className="w-11 h-11 rounded-full bg-stone-100 flex items-center justify-center text-stone-700 hover:bg-stone-200">
                            <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {visibleComments.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-stone-500 text-center">
                                <span className="material-symbols-outlined text-4xl mb-2 text-theme-accent/60" aria-hidden="true">history_edu</span>
                                <p className="font-display text-lg text-stone-800">No field notes yet</p>
                            </div>
                        ) : (
                            <>
                                {observationNotes.length > 0 && (
                                    <section aria-labelledby="notes-obs" className="space-y-5">
                                        <h4 id="notes-obs" className="text-sm font-display text-theme-primary flex items-center gap-1.5"><Glyph name="feather" size={15} className="text-theme-accent" />Observations</h4>
                                        {observationNotes.map(c => renderNote(c))}
                                    </section>
                                )}
                                {chatterNotes.length > 0 && (
                                    <section aria-label="Conversation" className={`space-y-5 ${observationNotes.length ? 'pt-5 border-t border-theme-primary/10' : ''}`}>
                                        {observationNotes.length > 0 && <h4 className="text-sm font-display text-stone-500">Conversation</h4>}
                                        {chatterNotes.map(c => renderNote(c))}
                                    </section>
                                )}
                            </>
                        )}
                    </div>

                    <div className="p-4 border-t border-theme-primary/10 bg-white shrink-0">
                        <form onSubmit={handleSendComment} className="flex gap-2.5">
                            <label htmlFor="new-comment" className="sr-only">Add a field note</label>
                            <input 
                                id="new-comment"
                                value={newComment} 
                                onChange={e => setNewComment(e.target.value.slice(0, 1000))} 
                                onFocus={() => { if (!isMember) askAccount('Create a free account to join the conversation.'); }}
                                placeholder="What did you notice?"
                                className="flex-1 bg-stone-50 border border-stone-200 rounded-full px-4 py-3 text-base focus:border-theme-accent transition-colors"
                            />
                            <button type="submit" disabled={!newComment.trim() || sendingComment} className="px-5 py-3 text-theme-accent text-base font-bold rounded-full disabled:opacity-40 transition-all active:scale-95">
                                {sendingComment ? 'Adding…' : 'Add'}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        )}
    </>

    <>
        {sharingPost && <React.Suspense fallback={null}><ShareStudio post={sharingPost} onClose={() => setSharingPost(null)} /></React.Suspense>}
    </>

    <>
        {publishingPost && (
            <React.Suspense fallback={null}><PublisherStudio 
                post={publishingPost} 
                activeItemIndex={activeItemIndex} 
                onClose={() => setPublishingPost(null)} 
            /></React.Suspense>
        )}
    </>
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
            </div>
        )}
        </>

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
