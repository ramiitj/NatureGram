
import { openExternal, timeAgo, likeTotal, looksLikeSpam } from '../utils';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import PlayableVideo, { PlayableAudio, resolvePoster } from './PlayableVideo';
import { FirebaseService, peekFirstTiles, releaseFirstTiles } from '../services/firebaseService';
import { getNaturalistExtra, getThemePeriod } from '../constants/naturalistExtras';
import { isFungiPost, FungiWarning } from './AiBadge';
import RichText from './RichText';
import CommunityId from './CommunityId';
import { NaturalistPersona } from '../types';
import { rankForYou } from '../services/ranking';
import { track } from '../services/analytics';
import { markFirstTile, registerTile, unregisterTile, scheduleBlankCount, setFirstSource } from '../services/feedMetrics';
import { CommunityPost, UserMode, Comment } from '../types';
const ShareSheet = React.lazy(() => import('./ShareSheet'));
import SearchPanel from './SearchPanel';
import KindChips from './KindChips';
import MediaEditor from './MediaEditor';
import SkeletonPost, { PressingLoader } from './SkeletonPost';
import Glyph from './Glyph';
import { wasOverlayPop, useBackToClose, overlayOpen } from '../services/overlayStack';
import { apiUrl } from '../services/apiOrigin';
import { watchTeen } from '../services/guardian';
import { getShareUrl } from '../utils';
import ReportSheet, { ReportTarget } from './ReportSheet';
import BrandMark from './BrandMark';
import FirstHint from './FirstHint';
import { PlateStamp } from './SpecimenPlate';
import { groupOf, seasonOf, GROUP_GLYPH, LifeGroup, toMs, namesOf, reconciledStats } from '../services/lifeList';
import { speciesPath } from '../services/speciesSlug';
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

// ------------------------------------------------------------------ feed tiles
// A tile paints at once at its exact shape: its main colour (or the naturalist's gradient), then the
// blurred preview, then the picture fading in over it. Nothing is ever a black box. Clips get one
// small corner mark; sound-only recordings are drawn as sounds. See docs/CLARITY_PLAN.md, section A.

/** Tile widths as the grid lays them out, for choosing between the 400 px and 800 px pictures. */
const TILE_SIZES = '(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw';
// Cream paper first, with only a breath of the fortnight's colour, so an unloaded grid reads as pages, not a tinted wash
// Calm cream while a picture is on its way: the paper itself, never a tint
const THEME_WASH = '#f3efe7';

/** A tile's main colour is dark enough for white words on it. */
const darkTint = (tint?: string | null) => {
    if (!tint || !/^#[0-9a-f]{6}$/i.test(tint)) return false;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(tint.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18;
};

const isSoundTile = (post: CommunityPost) =>
    post.soundOnly === true || (post.mediaType === 'audio' && !(post.thumbSmallUrl || post.thumbnailUrl || post.imageUrl));

/** Its own shape when known (kept between 1:2 and 2:1); otherwise 4:5 photos, 9:16 clips, 1:1 sounds. */
const tileAspect = (post: CommunityPost): number => {
    if (isSoundTile(post)) return 1;
    const w = Number(post.w), h = Number(post.h);
    if (w > 0 && h > 0) return Math.min(2, Math.max(0.5, w / h));
    return post.mediaType === 'video' ? 9 / 16 : 4 / 5;
};

const PLACEHOLDER_NAME = /^(unknown|nature|unidentified|observation|captured|uploaded|sighting)\b/i;
/** The names to show for a sighting: the common name first, the Latin beneath (namesOf), never a placeholder. */
const tileNames = (post: CommunityPost): { name: string; latin: string | null; unnamed: boolean } => {
    const n = namesOf(post);
    const name = (n.common || '').trim();
    if (!name || PLACEHOLDER_NAME.test(name)) return { name: 'Unnamed sighting', latin: null, unnamed: true };
    return { name, latin: n.latin && n.latin.toLowerCase() !== name.toLowerCase() ? n.latin : null, unnamed: false };
};
/** Usernames made up at sign-up ("Explorer-ZJSz") read as "an explorer". */
const AUTO_NAME = /^explorer[-_][a-z0-9]{3,6}$/i;
const explorerName = (name?: string | null, capital = false): string => {
    const n = (name || '').trim();
    if (!n || AUTO_NAME.test(n)) return capital ? 'An explorer' : 'an explorer';
    return n;
};

/** The scroller the feed lives in, so "near the viewport" means near what the explorer can scroll to. */
const scrollRootOf = (el: Element | null): Element | null => el?.closest('#main-scroll') || null;

// Moving previews: never more than one, only when the device can afford it and nobody asked for stillness
const previewsAllowed = (): boolean => {
    if (typeof window === 'undefined') return false;
    try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch { /* ignore */ }
    const c: any = (navigator as any).connection;
    if (c && (c.saveData || /(^|-)2g$/.test(String(c.effectiveType || '')))) return false;
    return true;
};
const previewTurn = { current: null as string | null, waiting: [] as string[], listeners: new Set<() => void>() };
const notifyPreview = () => previewTurn.listeners.forEach(l => l());
const claimPreview = (id: string) => {
    if (!previewTurn.waiting.includes(id)) previewTurn.waiting.push(id);
    if (!previewTurn.current) { previewTurn.current = id; notifyPreview(); }
};
const releasePreview = (id: string) => {
    previewTurn.waiting = previewTurn.waiting.filter(x => x !== id);
    if (previewTurn.current === id) { previewTurn.current = previewTurn.waiting[0] || null; notifyPreview(); }
};
const usePreviewTurn = (id: string) => {
    const [mine, setMine] = useState(previewTurn.current === id);
    useEffect(() => {
        const l = () => setMine(previewTurn.current === id);
        previewTurn.listeners.add(l);
        return () => { previewTurn.listeners.delete(l); releasePreview(id); };
    }, [id]);
    return mine;
};

/** A sound drawn as one: the waveform the post page's SoundScape uses, sized for a tile. */
const SoundTile: React.FC<{ seed: string }> = ({ seed }) => {
    const offset = Array.from(seed).reduce((n, c) => n + c.charCodeAt(0), 0) % 7;
    const bars = Array.from({ length: 18 }, (_, i) => 22 + Math.round(70 * Math.abs(Math.sin((i + offset) * 0.62) * Math.cos((i + offset) * 0.21))));
    return (
        <div className="absolute inset-0 bg-gradient-to-b from-stone-700 to-stone-900 flex items-center justify-center" aria-hidden="true">
            <div className="flex items-center justify-center gap-[3px] h-2/5 w-3/4">
                {bars.map((h, i) => <span key={i} className="w-[3px] rounded-full bg-white/70" style={{ height: `${h}%` }} />)}
            </div>
        </div>
    );
};

const FeedCard: React.FC<{
    post: CommunityPost;
    onPostClick: (post: CommunityPost) => void;
    /** The first tiles: fetched at once and first */
    priority?: boolean;
    /** Teen viewers: no marvel counts */
    hideCounts?: boolean;
}> = ({ post, onPostClick, priority = false, hideCounts = false }) => {
    const { name: label, latin } = tileNames(post);
    const by = explorerName(post.userName);
    const sound = isSoundTile(post);
    const isVideo = post.mediaType === 'video' && !post.soundOnly;
    const cardRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const [near, setNear] = useState(priority);
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const [legacyPoster, setLegacyPoster] = useState<string | null>(null);

    // Near the viewport (600 px ahead): load the picture, and look up a still for older clips
    useEffect(() => {
        if (near) return;
        const el = cardRef.current;
        if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return; }
        const io = new IntersectionObserver((entries) => {
            if (entries.some(e => e.isIntersecting)) { setNear(true); io.disconnect(); }
        }, { root: scrollRootOf(el), rootMargin: '600px 0px' });
        io.observe(el);
        return () => io.disconnect();
    }, [near]);

    const big = post.thumbnailUrl || post.imageUrl || post.posterUrl || legacyPoster || '';
    const small = post.thumbSmallUrl || '';
    const src = sound ? '' : (big || small);
    const srcSet = !sound && small && big && small !== big ? `${small} 400w, ${big} 800w` : undefined;
    const lqip = !sound && post.lqip && post.lqip.startsWith('data:image/') ? post.lqip : null;

    // Older clips have no still on their post: the one the server made is in media_variants
    useEffect(() => {
        if (!near || !isVideo || post.thumbnailUrl || post.imageUrl || post.posterUrl || post.thumbSmallUrl) return;
        let live = true;
        (post.videoUrl ? Promise.resolve(post.videoUrl) : FirebaseService.getFullPost(post.id).then(f => f?.videoUrl || f?.items?.[0]?.videoUrl))
            .then(u => resolvePoster(u)).then(p => { if (live && p) setLegacyPoster(p); }).catch(() => {});
        return () => { live = false; };
    }, [near, isVideo, post.id, post.videoUrl, post.thumbnailUrl, post.imageUrl, post.posterUrl, post.thumbSmallUrl]);

    // A picture already in the cache is shown without the fade
    useEffect(() => {
        const img = imgRef.current;
        if (img && img.complete && img.naturalWidth > 0) { setLoaded(true); markFirstTile('image'); }
    }, [src, near]);

    // Blank-tile count: anything to show at all (a picture, a still, a preview or the sound drawing)
    const hasSource = sound || !!lqip || (!!src && !failed);
    useEffect(() => { if (near) registerTile(post.id, hasSource); else unregisterTile(post.id); }, [post.id, hasSource, near]);
    useEffect(() => () => unregisterTile(post.id), [post.id]);

    // One gentle moving preview at a time, while the clip is at least 60% visible
    const canPreview = isVideo && !!post.videoUrl && previewsAllowed();
    const myTurn = usePreviewTurn(post.id);
    const [playing, setPlaying] = useState(false);
    useEffect(() => {
        const el = cardRef.current;
        if (!canPreview || !el || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver((entries) => {
            const e = entries[entries.length - 1];
            if (e.isIntersecting && e.intersectionRatio >= 0.6) claimPreview(post.id); else releasePreview(post.id);
        }, { root: scrollRootOf(el), threshold: [0, 0.6, 1] });
        io.observe(el);
        return () => { io.disconnect(); releasePreview(post.id); };
    }, [canPreview, post.id]);
    useEffect(() => { if (!myTurn) setPlaying(false); }, [myTurn]);
    const startPreview = useCallback((v: HTMLVideoElement | null) => { if (v) { v.muted = true; v.play().catch(() => {}); } }, []);

    const open = () => { releasePreview(post.id); onPostClick(post); };
    const showFallback = !sound && (!src || failed) && !lqip;
    const where = /^(uploaded|captured)?\s*field station$/i.test(String(post.locationArea || '').trim()) ? '' : post.locationArea;

    return (
        <div
            ref={cardRef}
            role="button"
            tabIndex={0}
            aria-label={`${label}${latin ? ` (${latin})` : ''} by ${by}${isVideo ? ', clip' : sound ? ', sound' : ''}`}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
            onClick={open}
            data-feed-tile={post.id}
            className="relative group cursor-pointer"
        >
            <div
                className="relative overflow-hidden rounded-md"
                style={{ aspectRatio: String(tileAspect(post)), background: post.tint && /^#[0-9a-f]{6}$/i.test(post.tint) ? post.tint : THEME_WASH }}
            >
                {sound ? <SoundTile seed={post.id} /> : (
                    <>
                        {lqip && (
                            <img
                                src={lqip}
                                alt=""
                                aria-hidden="true"
                                decoding="sync"
                                onLoad={() => markFirstTile('lqip')}
                                className={`absolute inset-0 w-full h-full object-cover scale-110 blur-lg transition-opacity duration-500 ${loaded ? 'opacity-0' : 'opacity-100'}`}
                            />
                        )}
                        {src && !failed && (near || priority) && (
                            <img
                                ref={imgRef}
                                src={src}
                                srcSet={srcSet}
                                sizes={srcSet ? TILE_SIZES : undefined}
                                alt={isVideo ? `Clip: ${label}` : label}
                                loading={priority ? 'eager' : 'lazy'}
                                fetchPriority={priority ? 'high' : 'auto'}
                                decoding="async"
                                onLoad={() => { setLoaded(true); markFirstTile('image'); }}
                                onError={() => setFailed(true)}
                                className={`absolute inset-0 w-full h-full object-cover transition-[opacity,transform] duration-700 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                            />
                        )}
                        {showFallback && (
                            // No picture yet (or none at all): a calm card with what it is, never a blank square
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center" aria-hidden="true">
                                <Glyph name={isVideo ? 'video' : GROUP_GLYPH[groupOf(post)]} size={28} strokeWidth={1.2} className={darkTint(post.tint) ? 'text-white/85' : 'text-stone-500'} />
                                <span className={`font-display italic text-sm leading-snug line-clamp-2 ${darkTint(post.tint) ? 'text-white' : 'text-stone-700'}`}>{label}</span>
                            </div>
                        )}
                        {canPreview && myTurn && (
                            <PlayableVideo
                                ref={startPreview}
                                src={post.videoUrl}
                                streamUrl={(post as any).streamUrl}
                                muted
                                loop
                                playsInline
                                autoPlay
                                preload="metadata"
                                aria-hidden="true"
                                tabIndex={-1}
                                onPlaying={() => setPlaying(true)}
                                // Loops the first three seconds: a glimpse, not the whole clip
                                onTimeUpdate={(e) => { if (e.currentTarget.currentTime > 3) e.currentTarget.currentTime = 0; }}
                                className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-500 ${playing ? 'opacity-100' : 'opacity-0'}`}
                            />
                        )}
                    </>
                )}
                {post.items && post.items.length > 1 && (
                    <span className="absolute top-2 right-2 z-20 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]" aria-hidden="true">
                        <Glyph name="stack" size={14} />
                    </span>
                )}
                {(isVideo || sound || post.audioUrl) && (
                    <span className="absolute bottom-2 right-2 z-20 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]" aria-hidden="true">
                        {isVideo
                            ? <Glyph name="play" size={14} filled />
                            : <Glyph name="sound" size={14} />}
                    </span>
                )}
            </div>

            <div className="mt-2.5">
                <h3 className="font-display italic text-base text-stone-900 leading-snug truncate">
                    {label}
                </h3>
                {latin && <p className="font-display italic text-xs text-stone-500 leading-snug truncate">{latin}</p>}
                <div className="flex items-center gap-1 mt-0.5 text-xs leading-[1.5] text-stone-500 min-w-0">
                    <span className="truncate">{where || explorerName(post.userName, true)}</span>
                    {!hideCounts && likeTotal(post) > 0 && (
                        <span className="ml-auto flex items-center gap-1 shrink-0" aria-label={wonderLabel(likeTotal(post))}>
                            <WonderIcon className="text-[12px]" />
                            <span className="tabular">{likeTotal(post)}</span>
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

/** Columns by breakpoint, as the old CSS columns had them (2, 3, 4, 5). */
const columnsFor = (w: number) => (w >= 1280 ? 5 : w >= 1024 ? 4 : w >= 768 ? 3 : 2);
const useColumnCount = () => {
    const [n, setN] = useState(() => (typeof window === 'undefined' ? 2 : columnsFor(window.innerWidth)));
    useEffect(() => {
        const on = () => setN(columnsFor(window.innerWidth));
        window.addEventListener('resize', on);
        return () => window.removeEventListener('resize', on);
    }, []);
    return n;
};
/** Gaps between columns and between tiles, in px (gap-4 / md:gap-6, gap-6 / md:gap-8 as before). */
const gapsFor = (n: number) => (n >= 3 ? { x: 24, y: 32 } : { x: 16, y: 24 });

/** The grid while the first page is on its way: the same columns and gaps, so nothing jumps. */
const SkeletonGrid: React.FC = () => {
    const n = useColumnCount();
    const g = gapsFor(n);
    return (
        <div className="flex items-start pb-56" style={{ gap: g.x }} aria-hidden="true">
            {Array.from({ length: n }, (_, c) => (
                <div key={c} className="flex-1 min-w-0 flex flex-col" style={{ gap: g.y }}>
                    {Array.from({ length: 4 }, (_, i) => <SkeletonPost key={i} tall={(c + i) % 3 === 0} />)}
                </div>
            ))}
        </div>
    );
};

/**
 * The feed grid. Tiles go to the shortest column, by their known shape, in order: the first tiles
 * sit across the top row, and tiles added later never move the ones already shown (CSS columns
 * reshuffled everything whenever a page arrived).
 *
 * Each tile is placed at an exact position, and the tiles sit in the page in the order they were
 * placed, which is top to bottom across the rows. So Tab, a screen reader and the eye all read the
 * grid row by row, not down one column and then the next.
 */
const FeedGrid: React.FC<{ posts: CommunityPost[]; onPostClick: (post: CommunityPost) => void; hideCounts?: boolean; label?: string }> = ({ posts, onPostClick, hideCounts, label = 'Sightings' }) => {
    const n = useColumnCount();
    const g = gapsFor(n);
    const boxRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    // Measured heights of each tile (picture plus the words beneath), by post id
    const heights = useRef(new Map<string, number>());
    const [, setVersion] = useState(0);
    const observerRef = useRef<ResizeObserver | null>(null);
    const frame = useRef<number | null>(null);

    React.useLayoutEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        setWidth(el.clientWidth);
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const observer = () => {
        if (observerRef.current || typeof ResizeObserver === 'undefined') return observerRef.current;
        observerRef.current = new ResizeObserver((entries) => {
            let changed = false;
            entries.forEach(e => {
                const id = (e.target as HTMLElement).dataset.tileId;
                const h = Math.round((e.target as HTMLElement).offsetHeight);
                if (id && h > 0 && heights.current.get(id) !== h) { heights.current.set(id, h); changed = true; }
            });
            if (changed && frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; setVersion(v => v + 1); });
        });
        return observerRef.current;
    };
    useEffect(() => () => { observerRef.current?.disconnect(); observerRef.current = null; if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
    const measure = useCallback((el: HTMLDivElement | null) => {
        if (el) observer()?.observe(el);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Which column each tile belongs to: decided by shape alone, so later pages never change it
    const columns = React.useMemo(() => {
        const heightsByShape = new Array(n).fill(0);
        return posts.map(post => {
            let c = 0;
            for (let i = 1; i < n; i++) if (heightsByShape[i] < heightsByShape[c] - 0.001) c = i;
            heightsByShape[c] += 1 / tileAspect(post) + 0.32; // the name and place beneath
            return c;
        });
    }, [posts, n]);

    const colW = width > 0 ? (width - g.x * (n - 1)) / n : 0;
    const tops: number[] = [];
    const colBottom = new Array(n).fill(0);
    posts.forEach((post, i) => {
        const c = columns[i];
        tops.push(colBottom[c]);
        const est = colW / tileAspect(post) + 72;
        colBottom[c] += (heights.current.get(post.id) ?? est) + g.y;
    });
    const total = Math.max(0, ...colBottom) - g.y;

    useEffect(() => { if (posts.length) scheduleBlankCount(); }, [posts.length]);
    return (
        <div ref={boxRef} role="list" aria-label={label} className="relative w-full" style={{ height: colW ? Math.max(0, total) : undefined }}>
            {colW > 0 && posts.map((post, index) => (
                <div
                    key={post.id}
                    ref={measure}
                    data-tile-id={post.id}
                    role="listitem"
                    className="absolute"
                    style={{ width: colW, left: columns[index] * (colW + g.x), top: tops[index] }}
                >
                    <FeedCard post={post} onPostClick={onPostClick} priority={index < 2} hideCounts={hideCounts} />
                </div>
            ))}
        </div>
    );
};

/** A sighting's video. Files that carry only sound (some recordings are saved as video) get a picture to listen by instead of a blank frame. */
const SightingVideo: React.FC<{ src?: string; streamUrl?: string | null; poster?: string | null; noDownload: boolean; label?: string | null }> = ({ src, streamUrl, poster, noDownload, label }) => {
    const [soundOnly, setSoundOnly] = useState(false);
    const [playing, setPlaying] = useState(false);
    return (
        <div className={soundOnly ? 'flex flex-col items-center justify-center w-full h-full gap-4 max-w-md mx-auto' : 'contents'}>
            {soundOnly && <SoundScape label={label} playing={playing} className="flex-1 min-h-0" />}
            <PlayableVideo
                controlsList={noDownload ? 'nodownload' : undefined}
                src={src}
                streamUrl={streamUrl}
                poster={soundOnly ? undefined : (poster || undefined)}
                controls
                playsInline
                preload='metadata'
                onLoadedMetadata={(e) => { if (e.currentTarget.videoWidth === 0) setSoundOnly(true); }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                className={soundOnly ? 'w-full h-12 shrink-0 rounded-full' : 'w-full h-full md:w-auto md:h-auto md:max-w-full md:max-h-full rounded-none md:rounded-xl object-contain'}
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
                <img src={image} alt={label ? `Where the ${label} was heard` : 'Where the sound was recorded'} className="w-full h-full md:w-auto md:h-auto md:max-w-full flex-1 min-h-0 object-contain rounded-none md:rounded-md" />
            ) : (
                <SoundScape label={label} playing={playing} className="flex-1 min-h-0 max-w-md" />
            )}
            <PlayableAudio src={src} controls controlsList={noDownload ? 'nodownload' : undefined} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="w-full max-w-md shrink-0 rounded-full" />
        </div>
    );
};

/**
 * Where the name came from and how sure anyone is: the guide (AI) or the explorer, whether it still
 * needs confirming, and how many explorers agree. Plain words, one quiet line.
 */
const Provenance: React.FC<{ item: any; post: CommunityPost; agree: number }> = ({ item, post, agree }) => {
    const p: any = post;
    const proposed: string[] = item?.aiProposedLabels || p.aiProposedLabels || [];
    const first = String(item?.labels?.[0] || p.labels?.[0] || '').trim().toLowerCase();
    const source: 'guide' | 'explorer' | null = item?.nameSource || p.nameSource
        || (proposed.length ? (String(proposed[0] || '').trim().toLowerCase() === first && !(item?.humanDelta ?? p.humanDelta) ? 'guide' : 'explorer') : null);
    const conf = item?.aiConfidence ?? p.aiConfidence;
    const idConf = String((item?.aiIdentifications || p.aiIdentifications || [])[0]?.confidence || '').toLowerCase();
    const low = (typeof conf === 'number' && conf < 0.6) || conf === 'low' || idConf === 'low';
    const confirmed = agree >= 2;
    const unconfirmed = !confirmed && (item?.needsExpertReview === true || p.needsExpertReview === true || low);
    const bits: { text: string; glyph: React.ComponentProps<typeof Glyph>['name'] }[] = [];
    if (source === 'guide') bits.push({ text: 'Suggested by the guide (AI)', glyph: 'guide' });
    if (source === 'explorer') bits.push({ text: 'Named by the explorer', glyph: 'feather' });
    if (confirmed) bits.push({ text: `Confirmed by ${agree} explorers`, glyph: 'stamp' });
    else if (unconfirmed) bits.push({ text: 'Not confirmed yet', glyph: 'help' });
    if (!bits.length) return null;
    return (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
            {bits.map(b => (
                <span key={b.text} className="inline-flex items-center gap-1.5"><Glyph name={b.glyph} size={14} className="text-stone-500" />{b.text}</span>
            ))}
        </p>
    );
};

/** The guide's "Why it does this", two sentences at first, the rest a tap away. */
const WhyItDoes: React.FC<{ paragraphs: string[] }> = ({ paragraphs }) => {
    const [open, setOpen] = useState(false);
    const sentences = paragraphs.join(' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    const long = sentences.length > 2;
    const cls = 'ng-quote not-italic text-[18px] leading-[1.6] ng-measure';
    return (
        <div className="space-y-3">
            {!long || open
                ? paragraphs.map((para, idx) => <p key={idx} className={cls}>{para}</p>)
                : <p className={cls}>{sentences.slice(0, 2).join(' ')}</p>}
            {long && (
                <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="ng-link-quiet min-h-[44px]">
                    {open ? 'Show less' : 'Read more'}
                </button>
            )}
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
  /** Opens the naturalist-of-the-fortnight page (from the challenge card) */
  onOpenNaturalist?: () => void;
  /** Opens Explore (places, kinds of life, the fortnight's challenge) */
  onOpenExplore?: () => void;
  /** Journal grid only. The journal draws the header: a string is its search (this header, chips and
   *  filters are hidden); null keeps the search, chips and filters here but drops the title row. */
  journalQuery?: string | null;
  /** Opens a new letter with this sighting attached (App opens Letters with attachPostId) */
  onSendAsLetter?: (postId: string) => void;
  /** Hide marvel counts. Defaults to on for teen explorers (services/guardian.ts) */
  hideCounts?: boolean;
}

/** Sightings asked for at a time on Following */
const FOLLOW_PAGE = 30;

/** Header ways on (Activity, Explore, Letters, Drafts): an icon with its name beneath, 44 px or more */
const HEADER_ACTION = 'relative inline-flex flex-col items-center justify-center gap-1 min-w-[48px] min-h-[52px] px-1 rounded-xl text-stone-700 transition-colors hover:text-stone-900 hover:bg-stone-900/[0.04]';
const HEADER_LABEL = 'text-[11px] leading-none font-medium text-stone-600';

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
    headerActions,
    onOpenNaturalist,
    onOpenExplore,
    journalQuery,
    onSendAsLetter,
    hideCounts: hideCountsProp
}) => {
  // The first tiles arrive inside the page itself (server/media.js): paint them before any request
  const [bootPosts] = useState<CommunityPost[]>(() => {
    const boot = !isJournalOnly && !detailOnly ? peekFirstTiles() : [];
    // Before any tile mounts, so the first-tile metric knows where its data came from
    setFirstSource(boot.length ? 'inline' : 'network');
    return boot;
  });
  const [posts, setPosts] = useState<CommunityPost[]>(bootPosts);
  // Tiles already on screen keep their places when the full first page arrives
  const pinnedIdsRef = useRef<string[]>(bootPosts.map(p => p.id));
  // Teen explorers see no marvel counts (unless the caller decides otherwise)
  const [teenViewer, setTeenViewer] = useState(false);
  useEffect(() => watchTeen(s => setTeenViewer(s.teen)), []);
  const hideCounts = hideCountsProp ?? teenViewer;
  const sendAsLetter = onSendAsLetter && !currentUserMode?.isAnonymous
      ? (post: CommunityPost) => onSendAsLetter(post.id)
      : onOpenMessages && !currentUserMode?.isAnonymous ? (post: CommunityPost) => {
          // Older callers without onSendAsLetter: carry the public link over to paste into a letter
          try { navigator.clipboard?.writeText(getShareUrl(post.id)); } catch { /* ignore */ }
          onOpenMessages();
      } : undefined;
  const [lastVisible, setLastVisible] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [activePost, setActivePost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isLoading, setIsLoading] = useState(bootPosts.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [searchTag, setSearchTag] = useState<string | null>(null);
  /** One confirm sheet for every step that can't be undone (delete a sighting or a field note, block) */
  const [confirmAsk, setConfirmAsk] = useState<{ title: string; body: string; action: string; glyph: 'trash' | 'block'; run: () => void; cancel?: () => void } | null>(null);
  const confirmedRef = useRef(false);
  const { close: closeConfirm } = useBackToClose(!!confirmAsk, () => {
      const ask = confirmAsk;
      setConfirmAsk(null);
      if (confirmedRef.current) { confirmedRef.current = false; ask?.run(); } else ask?.cancel?.();
  });
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [feedMode, setFeedMode] = useState<'foryou' | 'following'>('foryou');
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [loadMoreState, setLoadMoreState] = useState<'idle' | 'loading' | 'error'>('idle');
  /** Following: whom the explorer follows (null until known) and how long a list has been asked for */
  const [followIdList, setFollowIdList] = useState<string[] | null>(null);
  const [followLimit, setFollowLimit] = useState(FOLLOW_PAGE);
  const [isSaved, setIsSaved] = useState(false);
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  /** What is being reported; the field-notes sheet steps aside while it is open, and comes back after */
  const [reportTarget, setReportTarget] = useState<(ReportTarget & { what: string; backToNotes?: boolean }) | null>(null);
  const [retryKey, setRetryKey] = useState(0);
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
  /** Kinds of life present in what's loaded, so the chip row never offers an empty choice */
  const groupsPresent = React.useMemo(() => new Set(posts.map(p => groupOf(p))), [posts]);
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
  // The journal grid takes its search from the journal's own header
  useEffect(() => { if (typeof journalQuery === 'string') setSearchQuery(journalQuery); }, [journalQuery]);
  const [mediaFilter, setMediaFilter] = useState<'all' | 'image' | 'video' | 'audio'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'fortnight' | 'month' | 'season'>('all');
  /** One kind of life at a time, from the chip row */
  const [selectedGroup, setSelectedGroup] = useState<LifeGroup | null>(null);
  const [sortOrder, setSortOrder] = useState<'newest' | 'likes'>('newest');
  const [showFilters, setShowFilters] = useState(false);
  /** The feed's search field is in use: the one search (SearchPanel) takes the place of the grid */
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchOpen = !isJournalOnly && (isSearchFocused || !!searchQuery.trim());
  const closeSearch = () => { setIsSearchFocused(false); setSearchQuery(''); };
  const openMention = async (username: string) => {
    const u = await FirebaseService.findUserByUsername(username);
    if (u) { setIsCommentsOpen(false); onViewProfile?.(u.uid); }
    else showToast(`@${username} isn't on NatureGram yet`);
  };

  // Words to offer in the search before anything is typed: the species most seen in what's loaded
  const searchSuggestions = React.useMemo(() => {
    const seen = new Map<string, number>();
    posts.forEach(p => { const l = String(namesOf(p).common || '').trim(); if (l && !/^(unknown|nature|unidentified|captured|uploaded)/i.test(l)) seen.set(l, (seen.get(l) || 0) + 1); });
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l]) => l);
  }, [posts]);

  // Filters what's loaded in memory: the kind of life, media, season and order. Words are searched on
  // the server by SearchPanel; only the journal (the explorer's own sightings) is searched here.
  const filteredAndSortedPosts = React.useMemo(() => {
    return posts
      .filter(post => {
        if (blockedIds.includes(post.userId)) return false;
        // 1. The journal's own search (titles, labels, descriptions, places, insights)
        if (isJournalOnly && searchQuery.trim()) {
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

        // 2. Kind of life (the chip row)
        if (selectedGroup && groupOf(post) !== selectedGroup) return false;

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

        return true;
      })
      .sort((a, b) => {
        if (sortOrder === 'likes') return likeTotal(b) - likeTotal(a);
        const tA = a.timestamp?.seconds || (a.timestamp ? new Date(a.timestamp).getTime() : 0);
        const tB = b.timestamp?.seconds || (b.timestamp ? new Date(b.timestamp).getTime() : 0);
        return tB - tA;
      });
  }, [posts, searchQuery, isJournalOnly, mediaFilter, dateFilter, sortOrder, selectedGroup, blockedIds]);

  /** Filters behind the Filters button that are set (the chip row is shown on its own) */
  const drawerFiltersOn = mediaFilter !== 'all' || dateFilter !== 'all' || sortOrder !== 'newest';
  const anyFilterOn = drawerFiltersOn || !!selectedGroup || !!searchTag || (isJournalOnly && !!searchQuery.trim());

  // "For you" is ranked when no filter or order is chosen; otherwise explicit ordering wins.
  // Only sightings that have just arrived are ranked, and they go after the ones already shown:
  // a new page never reshuffles tiles on screen.
  const rankedOrderRef = useRef<string[]>([]);
  const displayPosts = React.useMemo(() => {
    const ranked = !isJournalOnly && feedMode === 'foryou' && !searchTag && !anyFilterOn;
    if (!ranked) return filteredAndSortedPosts;
    const byId = new Map(filteredAndSortedPosts.map(p => [p.id, p]));
    // Tiles painted from the page keep their places first
    let order = rankedOrderRef.current.filter(id => byId.has(id));
    if (!order.length) order = pinnedIdsRef.current.filter(id => byId.has(id));
    const placed = new Set(order);
    const fresh = filteredAndSortedPosts.filter(p => !placed.has(p.id));
    if (fresh.length) {
      // AI-curated picks (persona) lead the new arrivals; the rest is ranked transparently
      const curated = fresh.filter(p => p.curatorNote);
      const rest = fresh.filter(p => !p.curatorNote);
      order = [...order, ...curated.map(p => p.id), ...rankForYou(rest, { followingIds, persona: userPersona, challengeTag: themeExtra.challengeTag, myUid: currentUserMode.userId }).map(p => p.id)];
    }
    rankedOrderRef.current = order;
    return order.map(id => byId.get(id)!).filter(Boolean);
  }, [filteredAndSortedPosts, isJournalOnly, feedMode, searchTag, anyFilterOn, followingIds, userPersona, themeExtra.challengeTag, currentUserMode.userId]);

  // Clear every filter (and the journal's own search)
  const resetAllFilters = () => {
    setSearchQuery("");
    setMediaFilter('all');
    setDateFilter('all');
    setSortOrder('newest');
    setSelectedGroup(null);
    setSearchTag(null);
    setIsSearchFocused(false);
  };

  // The bottom of the feed: worth knowing how often explorers get there
  const endTrackedRef = useRef('');
  useEffect(() => {
    if (isJournalOnly || isLoading || hasMore || posts.length === 0) return;
    const key = `${feedMode}|${searchTag || ''}`;
    if (endTrackedRef.current === key) return;
    endTrackedRef.current = key;
    track('feed_end_reached', { feed: feedMode, count: posts.length, filtered: anyFilterOn });
  }, [hasMore, isLoading, isJournalOnly, posts.length, feedMode, searchTag, anyFilterOn]);

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

  const loadMore = useCallback(async () => {
      if (!hasMore || isLoading || isJournalOnly || loadMoreState === 'loading') return;
      setLoadMoreState('loading');
      if (feedMode === 'following') {
          // Following has no cursor: ask for a longer list and keep what is already on screen in place
          try {
              const want = followLimit + FOLLOW_PAGE;
              const feed = await FirebaseService.getFollowingFeed(followIdList || [], want);
              setPosts(prev => { const seen = new Set(prev.map(p => p.id)); return [...prev, ...feed.filter(p => !seen.has(p.id))]; });
              setFollowLimit(want);
              setHasMore(feed.length >= want);
              setLoadMoreState('idle');
          } catch { setLoadMoreState('error'); }
          return;
      }
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
  }, [hasMore, isLoading, lastVisible, searchTag, isJournalOnly, feedMode, loadMoreState, followLimit, followIdList]);

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
  const { close: closeNotes } = useBackToClose(isCommentsOpen, () => setIsCommentsOpen(false));
  const { close: closeMenu } = useBackToClose(postMenuOpen, () => setPostMenuOpen(false));
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetDrag = useRef<{ y: number; t: number; on: boolean }>({ y: 0, t: 0, on: false });

  // Species field-guide page
  const [selectedSpecies, setSelectedSpecies] = useState<{name: string, location: string, id: string} | null>(null);
  const [speciesData, setSpeciesData] = useState<{extract: string, loading: boolean, url?: string, failed?: boolean} | null>(null);
  const { close: closeSpecies } = useBackToClose(!!selectedSpecies, () => setSelectedSpecies(null));

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
    setSpeciesData({extract: "", loading: true});
    const clean = label.replace(/\(.*?\)/g, '').trim();
    try {
        // Our server asks Wikipedia (and remembers the answer), so the explorer's phone never contacts it
        const res = await fetch(apiUrl(`/api/species/summary?name=${encodeURIComponent(clean)}`));
        const found = res.ok ? await res.json() : null;
        if (!res.ok || found?.unavailable) throw new Error('unavailable');
        setSpeciesData({
            extract: found?.extract || `The encyclopedia has nothing on "${clean}" yet. The name may cover a group rather than a single species.`,
            loading: false,
            url: found?.url || '',
        });
    } catch(e) {
        setSpeciesData({extract: "The encyclopedia can't be reached right now. Try again in a little while.", loading: false, failed: true});
    }
  };

  const handleDeletePost = (postId: string) => {
      setConfirmAsk({
          title: 'Delete this sighting?',
          body: "It will be removed from the feed and your journal. This can't be undone.",
          action: 'Delete sighting',
          glyph: 'trash',
          run: () => executeDelete(postId),
      });
  };

  const executeDelete = async (postId: string) => {
      try {
          // Optimistic update
          setPosts(prev => prev.filter(p => p.id !== postId));

          await FirebaseService.deletePost(postId);
          if (activePost?.id === postId) {
              closeDetail();
          }
      } catch (e) {
          console.error("Failed to delete post", e);
          showToast("Could not delete the sighting. Please try again.");
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
    setPosts([]);
    setFollowLimit(FOLLOW_PAGE);
    (async () => {
      try {
        const ids = currentUserMode.userId ? await FirebaseService.getFollowingIds(currentUserMode.userId) : [];
        const feed = await FirebaseService.getFollowingFeed(ids, FOLLOW_PAGE);
        if (!active) return;
        setFollowIdList(ids);
        setPosts(feed);
        setHasMore(feed.length >= FOLLOW_PAGE);
      } catch (e: any) {
        if (active) setError(e?.message || 'failed');
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [feedMode, isJournalOnly, currentUserMode.userId, retryKey]);

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
    let live = true;
    // First visit with tiles from the page: they stay on screen while the full first page loads
    const fromPage = !searchTag && peekFirstTiles().length > 0 && pinnedIdsRef.current.length > 0;

    rankedOrderRef.current = [];
    if (!fromPage) {
      window.scrollTo(0, 0);
      const container = document.getElementById('community-scroll-container');
      if (container) container.scrollTop = 0;
      pinnedIdsRef.current = [];
      setIsLoading(true);
      setPosts([]);
    } else {
      // No "load more" until the real first page (and its cursor) is here
      setLoadMoreState('loading');
    }
    setLastVisible(null);
    setHasMore(true);
    setError(null);

    FirebaseService.getMorePosts(null, searchTag).then(({ posts: newPosts, lastVisible: newLastVisible }) => {
        if (!live) return;
        releaseFirstTiles();
        setPosts(newPosts);
        setLastVisible(newLastVisible);
        setHasMore(newLastVisible !== null);
        setIsLoading(false);
        if (fromPage) setLoadMoreState('idle');
    }).catch(err => {
        if (!live) return;
        console.error("Failed to load initial posts:", err);
        if (fromPage) {
          // Keep the tiles from the page; the explorer can retry for more
          setLoadMoreState('error');
          return;
        }
        let msg = err.message || String(err);
        try {
            const parsed = JSON.parse(msg);
            if (parsed && parsed.error) msg = parsed.error;
        } catch (e) {}
        setError(msg);
        setIsLoading(false);
    });
    return () => { live = false; };
  }, [searchTag, isJournalOnly, feedMode, retryKey]);

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
      if (activePost && isMember) FirebaseService.isSaved(activePost.id).then(setIsSaved);
      else setIsSaved(false);
  }, [activePost?.id, isMember]);

  // Follow the author from the post (hidden on your own sightings)
  const [followsAuthor, setFollowsAuthor] = useState<boolean | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  useEffect(() => {
      setFollowsAuthor(null);
      const uid = activePost?.userId;
      if (!uid || !isMember || uid === currentUserMode.userId) return;
      if (followingIds.has(uid)) { setFollowsAuthor(true); return; }
      let alive = true;
      FirebaseService.isFollowing(uid).then(f => { if (alive) setFollowsAuthor(f); }).catch(() => { if (alive) setFollowsAuthor(false); });
      return () => { alive = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePost?.userId, isMember, currentUserMode.userId]);
  const toggleFollowAuthor = async () => {
      const post = activePost;
      if (!post || followBusy) return;
      if (!isMember) { askAccount('Create a free account to follow explorers and gather their sightings in Following.', () => toggleFollowAuthor()); return; }
      const next = !followsAuthor;
      setFollowBusy(true);
      setFollowsAuthor(next);
      try {
          if (next) await FirebaseService.followUser(post.userId); else await FirebaseService.unfollowUser(post.userId);
          setFollowingIds(prev => { const n = new Set(prev); if (next) n.add(post.userId); else n.delete(post.userId); return n; });
          track(next ? 'follow' : 'unfollow', { surface: 'post' });
      } catch (err: any) {
          setFollowsAuthor(!next);
          showToast(String(err?.message || '').length < 90 && err?.message ? err.message : 'Could not update. Please try again.');
      } finally { setFollowBusy(false); }
  };

  // How many explorers agree with the name, read from the identifications kept with the sighting
  const [agreeCount, setAgreeCount] = useState(0);
  useEffect(() => {
      setAgreeCount(0);
      if (!activePost?.id || !activePost.isPublic) return;
      const stored = Number((activePost as any).idAgreeCount);
      if ((activePost as any).communityVerified === true && stored >= 2) { setAgreeCount(stored); return; }
      let alive = true;
      const primary = String(activePost.labels?.[0] || '').trim().toLowerCase();
      FirebaseService.getIdentifications(activePost.id).then(ids => {
          if (!alive) return;
          setAgreeCount(ids.filter(i => i.agree === true || String(i.name || '').trim().toLowerCase() === primary).length);
      }).catch(() => {});
      return () => { alive = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePost?.id, activePost?.isPublic]);

  // Escape closes the open sighting, when no window is open on top of it (those close first)
  useEffect(() => {
      if (!activePost) return;
      const onKey = (e: KeyboardEvent) => {
          if (e.key !== 'Escape' || e.defaultPrevented || overlayOpen() || isEditing) return;
          const t = e.target as HTMLElement | null;
          if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
          closeDetail();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
  });

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
      const onPop = (e: PopStateEvent) => {
          if (wasOverlayPop(e)) return; // Back closed a window on top of the post, nothing more
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
          showToast('Could not save your marvel. Please try again.');
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
          showToast('Could not update your kept sightings.');
      }
  };

  /** Open the report sheet. From the field notes, it takes the sheet's place and hands back after. */
  const openReport = (target: ReportTarget, what: string) => {
      setPostMenuOpen(false);
      if (!isMember) { askAccount('Create a free account to report content.'); return; }
      if (target.kind === 'post' && activePost?.reports?.includes(currentUserMode.userId!)) { showToast('You already reported this sighting. Thank you.'); return; }
      const backToNotes = isCommentsOpen;
      if (backToNotes) setIsCommentsOpen(false);
      setReportTarget({ ...target, what, backToNotes });
  };
  const onReportSent = () => {
      const t = reportTarget;
      if (t?.kind === 'post') setActivePost(prev => prev ? { ...prev, reports: [...(prev.reports || []), currentUserMode.userId!] } : prev);
  };
  const onReportClosed = () => {
      const back = reportTarget?.backToNotes;
      setReportTarget(null);
      if (back && activePost) setIsCommentsOpen(true);
  };

  const handleMuteAuthor = async () => {
      if (!activePost) return;
      setPostMenuOpen(false);
      if (!isMember) { askAccount('Create a free account to mute explorers.'); return; }
      try {
          await FirebaseService.muteUser(activePost.userId);
          setBlockedIds(prev => [...prev, activePost.userId]);
          closeDetail();
          showToast(`${activePost.userName} muted. They won't know, and you can unmute from their field page.`);
      } catch { showToast('Could not mute. Please try again.'); }
  };

  const handleBlockAuthor = () => {
      if (!activePost) return;
      setPostMenuOpen(false);
      if (!isMember) { askAccount('Create a free account to block explorers.'); return; }
      const who = explorerName(activePost.userName, true);
      const uid = activePost.userId;
      setConfirmAsk({
          title: `Block ${who}?`,
          body: "You won't see their sightings or field notes, and they can't write to you. You can unblock them from their field page.",
          action: 'Block',
          glyph: 'block',
          run: async () => {
              try {
                  await FirebaseService.blockUser(uid);
                  setBlockedIds(prev => [...prev, uid]);
                  closeDetail();
                  showToast(`${who} blocked`);
              } catch { showToast('Could not block. Please try again.'); }
          },
      });
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
  // Only counts the server has reconciled (stats.reconciledAt) are shown: no count rather than a wrong one.
  const [speciesCounts, setSpeciesCounts] = useState<Record<string, number | null>>({});
  useEffect(() => {
      const ids = [...new Set([...(comments || []).map(c => c.userId), activePost?.userId].filter(Boolean) as string[])].filter(id => !(id in speciesCounts));
      if (!ids.length) return;
      let alive = true;
      Promise.all(ids.slice(0, 30).map(id => FirebaseService.getUserProfile(id).then(p => {
          const n = reconciledStats(p)?.species ?? null;
          return [id, n] as const;
      }).catch(() => [id, null] as const)))
          .then(rows => { if (alive) setSpeciesCounts(prev => ({ ...prev, ...Object.fromEntries(rows) })); });
      return () => { alive = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, activePost?.userId]);
  const countsReady = (uids: string[]) => uids.every(u => typeof speciesCounts[u] === 'number');
  const speciesLine = (uid?: string) => { const n = uid ? speciesCounts[uid] : null; return typeof n === 'number' ? `${n} species` : ''; };

  // Who has put a name to this sighting: their notes carry a small "ID" tag
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
  const showSpeciesCounts = countsReady([...new Set(visibleComments.map(c => c.userId))]);

  const renderNote = (c: Comment) => activePost && (
                                <div key={c.id} className="flex gap-4 group animate-fade-in motion-reduce:animate-none">
                                    <button onClick={() => { setIsCommentsOpen(false); handleProfileClick(c.userId); }} aria-label={`View ${c.userName}`} className="shrink-0">
                                        {c.avatarUrl ? <img src={c.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" /> : <span className="w-9 h-9 rounded-full bg-[#f3efe7] flex items-center justify-center text-stone-700 font-display text-base" aria-hidden="true">{(c.userName || '?').charAt(0).toUpperCase()}</span>}
                                    </button>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[15px] text-stone-800 leading-[1.55]"><button onClick={() => { setIsCommentsOpen(false); handleProfileClick(c.userId); }} className="font-medium text-stone-900 mr-1.5">{c.userName}</button>{identifierIds.has(c.userId) && <span className="inline-block align-[1px] mr-1.5 px-1.5 py-px rounded-[3px] border border-stone-300 text-[11px] font-medium text-stone-600" title="Suggested a name for this sighting">ID</span>}<RichText className="whitespace-pre-line break-words" text={c.text} onMention={openMention} onTag={handleTagClick} /></p>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-stone-500 flex-wrap">
                                            <span>{[showSpeciesCounts ? speciesLine(c.userId) : '', timeAgo(c.timestamp)].filter(Boolean).join(', ')}</span>
                                            {looksLikeSpam(c.text) && isPostOwner && <span className="text-amber-900 font-medium">Looks like spam, hidden from others</span>}
                                            {isMember && c.userId !== currentUserMode.userId && (
                                                <button onClick={() => { setNewComment(prev => `@${c.userName} ${prev}`.slice(0, 1000)); (document.getElementById('new-comment') as HTMLInputElement | null)?.focus(); }} className="font-medium min-h-[44px] hover:text-stone-800">Reply</button>
                                            )}
                                            {(c.userId === currentUserMode.userId || activePost.userId === currentUserMode.userId) && (
                                                <button onClick={() => handleDeleteComment(c.id)} className="font-medium min-h-[44px] hover:text-red-700">Delete</button>
                                            )}
                                            {c.userId !== currentUserMode.userId && (
                                                <button onClick={() => openReport({ kind: 'comment', postId: activePost.id, commentId: c.id, userId: c.userId }, 'this field note')} aria-label={`Report ${explorerName(c.userName)}'s field note`} className="font-medium min-h-[44px] hover:text-stone-800">Report</button>
                                            )}
                                        </div>
                                    </div>
                                </div>
  );

  const handleDeleteComment = (commentId: string) => {
      if (!activePost) return;
      const postId = activePost.id;
      // The confirm takes the field notes' place, then hands back to them
      setIsCommentsOpen(false);
      setConfirmAsk({
          title: 'Delete this field note?',
          body: "It will be removed for everyone. This can't be undone.",
          action: 'Delete field note',
          glyph: 'trash',
          run: async () => {
              try { await FirebaseService.deleteComment(postId, commentId); }
              catch { showToast('Could not delete the field note.'); }
              setIsCommentsOpen(true);
          },
          cancel: () => setIsCommentsOpen(true),
      });
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
        showToast("Could not save your changes. Please try again.");
    }
  };

  const handleTagClick = (tag: string) => {
      const cleanTag = (tag.startsWith('#') ? tag.slice(1) : tag).toLowerCase();
      track('tag_open', { tag: cleanTag });
      closeDetail();
      // A tag opens the one search, already asking for it
      setSearchQuery(`#${cleanTag}`);
      if (!isJournalOnly) { setFeedMode('foryou'); setIsSearchFocused(true); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };


  return (
    <div id="community-scroll-container" className="w-full relative">
        {/* Field-guide page for a species */}
        {selectedSpecies && (() => {
            const g = speciesPage.group;
            return (
            <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center sm:p-6 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="species-title">
                <div className="absolute inset-0 ng-scrim" onClick={closeSpecies} aria-hidden="true"></div>
                <div className="relative w-full max-w-lg ng-sheet overflow-hidden animate-slide-up flex flex-col max-h-[88vh] sm:max-h-[82vh]">
                    <div className="flex flex-col min-h-0 flex-1">
                        <div className="px-6 pt-6 pb-5 flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <p className="ng-kicker"><Glyph name={GROUP_GLYPH[g]} size={16} className="text-stone-400 -ml-0.5" />{g}</p>
                                <h3 id="species-title" className="ng-title italic mt-3">{selectedSpecies.name}</h3>
                                {speciesPage.scientific && <p className="font-display italic text-base text-stone-500 mt-1">{speciesPage.scientific}</p>}
                            </div>
                            <button onClick={closeSpecies} aria-label="Close" className="ng-icon-button -mr-2 -mt-1">
                                <Glyph name="close" size={24} />
                            </button>
                        </div>

                        <div className="px-6 pb-8 overflow-y-auto hidden-scrollbar flex-1 space-y-6">
                            <dl className="grid grid-cols-2 border-y border-stone-200/80 divide-x divide-stone-200/80">
                                <div className="py-3 pr-4">
                                    <dt className="ng-caption">Seen by</dt>
                                    <dd className="font-display text-xl text-stone-900 mt-0.5">{speciesPage.explorers} {speciesPage.explorers === 1 ? 'explorer' : 'explorers'}</dd>
                                </div>
                                <div className="py-3 pl-4">
                                    <dt className="ng-caption">Your sightings</dt>
                                    <dd className="font-display text-xl text-stone-900 mt-0.5">{isMember ? speciesPage.mine : '–'}</dd>
                                </div>
                            </dl>
                            {speciesPage.months && (
                                <p className="ng-small flex items-center gap-2">
                                    <Glyph name="sun" size={16} className="text-stone-400" />
                                    Recorded here in {speciesPage.months}
                                </p>
                            )}

                            {speciesData?.loading ? (
                                <PressingLoader label={`Looking up ${selectedSpecies.name}`} className="py-8" />
                            ) : (
                                <>
                                    {speciesData?.extract && (
                                        <p className="ng-body ng-measure">{speciesData.extract}</p>
                                    )}
                                    {speciesData?.failed ? (
                                        <button onClick={() => handleSpeciesClick(selectedSpecies.name, selectedSpecies.location)} className="ng-link-quiet min-h-[44px]">Try again</button>
                                    ) : speciesData?.url ? (
                                        <p className="ng-caption">
                                            <a href={speciesData.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">From Wikipedia</a>,{' '}
                                            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer license" className="underline underline-offset-4">CC BY-SA 4.0</a>
                                        </p>
                                    ) : null}
                                </>
                            )}
                            {speciesPage.explorers > 0 && speciesPath(speciesPage.scientific || selectedSpecies.name) && (
                                <a href={speciesPath(speciesPage.scientific || selectedSpecies.name)!} className="inline-flex items-center gap-2 min-h-[44px] ng-link-quiet">
                                    <Glyph name="notebook" size={20} className="text-stone-500" />
                                    More on <span className="font-display italic">{selectedSpecies.name}</span> in the field guide
                                </a>
                            )}

                            {speciesPage.lookAlikes.length > 0 && (
                                <section aria-labelledby="lookalikes" className="pt-6 border-t border-stone-200/80">
                                    <h4 id="lookalikes" className="ng-subtitle">Look-alikes</h4>
                                    <p className="ng-caption mb-3">Other names the guide weighed for this sighting</p>
                                    <ul className="space-y-3" role="list">
                                        {speciesPage.lookAlikes.map(l => (
                                            <li key={l.name}>
                                                <button onClick={() => handleSpeciesClick(l.name, selectedSpecies.location)} className="text-left w-full">
                                                    <span className="font-display italic text-stone-900 hover:underline">{l.name}</span>
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

        {/* One confirm sheet for steps that can't be undone */}
        {confirmAsk && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 animate-fade-in motion-reduce:animate-none" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
                <div className="absolute inset-0 ng-scrim" onClick={closeConfirm} aria-hidden="true"></div>
                <div className="relative w-full max-w-sm bg-day-bg rounded-2xl p-8 shadow-2xl ng-rise text-center">
                    <Glyph name={confirmAsk.glyph} size={32} strokeWidth={1.2} className="text-stone-400 mb-5" />
                    <h3 id="confirm-title" className="ng-subtitle mb-2">{confirmAsk.title}</h3>
                    <p id="confirm-body" className="ng-small mb-8">{confirmAsk.body}</p>
                    <div className="flex flex-col gap-3">
                        <button
                            onClick={() => { confirmedRef.current = true; closeConfirm(); }}
                            className="w-full min-h-[48px] bg-red-700 hover:bg-red-800 text-white font-semibold text-[15px] rounded-full transition-colors"
                        >
                            {confirmAsk.action}
                        </button>
                        <button onClick={closeConfirm} className="ng-button-quiet w-full" autoFocus>
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        )}

        {!detailOnly && (<>
        {/* Field guide header */}
        {typeof journalQuery !== 'string' && (
        <div className="w-full ng-page pt-6 md:pt-8 pb-2 flex flex-col gap-6 animate-fade-in select-none relative z-50">
            {journalQuery === undefined && (
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    {/* The mark goes back to the top, as on Instagram; it never leaves the app */}
                    <button
                        type="button"
                        onClick={() => onLogoClick?.()}
                        aria-label={isJournalOnly ? 'Scroll to top of journal' : 'NatureGram, back to the top'}
                        className="text-left transition-opacity hover:opacity-80 rounded-lg"
                    >
                        {isJournalOnly ? (
                            <h2 className="ng-title">My journal</h2>
                        ) : (
                            <h1 className="flex items-center gap-2.5 text-stone-900">
                                <BrandMark size={24} />
                                <span className="ng-wordmark">NatureGram</span>
                                <span className="sr-only">: Wild, today's sightings</span>
                            </h1>
                        )}
                    </button>
                    {!isJournalOnly && (
                        <p className="text-sm leading-[1.5] text-stone-500 mt-2 flex items-center gap-2">
                            <Glyph name={moment.icon} size={16} className="text-stone-400" />
                            <span>{moment.name}: {moment.hint}</span>
                        </p>
                    )}
                </div>

                <div className="flex items-start gap-0.5 -mr-2 shrink-0">
                    {headerActions}
                    {/* Each way on carries its name beneath it */}
                    {!isJournalOnly && onOpenActivity && (
                        <button onClick={onOpenActivity} aria-label={unreadActivity ? `Activity, ${unreadActivity} new` : 'Activity'} className={HEADER_ACTION}>
                            <span className="relative"><Glyph name="ripples" size={22} />
                            {unreadActivity > 0 && <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-theme-accent ring-2 ring-day-bg" aria-hidden="true" />}</span>
                            <span className={HEADER_LABEL} aria-hidden="true">Activity</span>
                        </button>
                    )}
                    {!isJournalOnly && onOpenExplore && (
                        <button onClick={onOpenExplore} aria-label="Explore" data-tour="explore" className={HEADER_ACTION}>
                            <Glyph name="leafCompass" size={22} />
                            <span className={HEADER_LABEL} aria-hidden="true">Explore</span>
                        </button>
                    )}
                    {!isJournalOnly && onOpenMessages && (
                        <button onClick={onOpenMessages} aria-label={unreadMessages ? `Letters, ${unreadMessages} unread` : 'Letters'} data-tour="letters" className={HEADER_ACTION}>
                            <span className="relative"><Glyph name="sealed" size={22} />
                            {unreadMessages > 0 && <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-theme-accent ring-2 ring-day-bg" aria-hidden="true" />}</span>
                            <span className={HEADER_LABEL} aria-hidden="true">Letters</span>
                        </button>
                    )}
                    {onViewDrafts && activeDraftsCount > 0 && (
                        <button
                            onClick={onViewDrafts}
                            className={HEADER_ACTION}
                            aria-label={`Drafts, ${activeDraftsCount} unfinished ${activeDraftsCount === 1 ? 'page' : 'pages'}`}
                        >
                            <span className="relative"><Glyph name="satchel" size={22} />
                                <span className="absolute -top-2 -right-3 min-w-[18px] h-[18px] px-1 bg-stone-900 rounded-full ring-2 ring-day-bg flex items-center justify-center text-[11px] font-semibold text-white tabular" aria-hidden="true">
                                    {activeDraftsCount}
                                </span>
                            </span>
                            <span className={HEADER_LABEL} aria-hidden="true">Drafts</span>
                        </button>
                    )}
                </div>
            </div>)}

            {!isJournalOnly && (
                <div className="flex items-center gap-6" role="tablist" aria-label="What to show">
                    {([['foryou', 'For you'], ['following', 'Following']] as const).map(([key, label]) => (
                        <button
                            key={key}
                            role="tab"
                            aria-selected={feedMode === key}
                            onClick={() => {
                                if (key === 'following' && !isMember) { askAccount('Create a free account to follow explorers and gather their sightings here.'); return; }
                                if (key === 'following' && feedMode !== 'following') track('following_tab_open');
                                setFeedMode(key);
                            }}
                            className={`ng-tab ${feedMode === key ? 'ng-tab-on' : ''}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}

            {freshRail.length > 0 && !searchOpen && feedMode === 'foryou' && (
                <section aria-label="Fresh sightings from explorers you follow">
                    <p className="ng-label mb-3">Fresh tracks</p>
                    <ul className="flex gap-4 overflow-x-auto no-scrollbar -mx-6 px-6 md:-mx-12 md:px-12 pb-1" role="list">
                        {freshRail.map(r => (
                            <li key={r.userId} className="shrink-0">
                                <button onClick={() => handlePostClick(r.post)} className="group flex flex-col items-start gap-1.5 w-[84px] text-left" aria-label={`${tileNames(r.post).name} from ${explorerName(r.userName)}${r.count > 1 ? `, ${r.count} new sightings` : ''}`}>
                                    <span className="relative block w-[84px] h-[100px] rounded-md overflow-hidden bg-[#f3efe7]">
                                        {(r.post.thumbnailUrl || r.post.imageUrl)
                                            ? <img src={(r.post.thumbSmallUrl || r.post.thumbnailUrl || r.post.imageUrl)!} alt="" className="w-full h-full object-cover" />
                                            : <span className="w-full h-full flex items-center justify-center text-stone-400"><Glyph name={r.post.mediaType === 'audio' ? 'sound' : 'image'} size={20} /></span>}
                                        {r.count > 1 && <span className="absolute top-1.5 right-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-black/45 backdrop-blur text-white text-[11px] font-semibold flex items-center justify-center tabular">{r.count}</span>}
                                    </span>
                                    <span className="text-sm font-display italic text-stone-900 truncate w-full leading-snug">{tileNames(r.post).name}</span>
                                    <span className="text-xs text-stone-500 truncate w-full -mt-1.5">{explorerName(r.userName, true)}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {!isJournalOnly && !searchOpen && dailyTheme?.naturalist && (
                <button
                    type="button"
                    data-tour="challenge"
                    onClick={() => { if (onOpenNaturalist) { onOpenNaturalist(); return; } handleTagClick(themeExtra.challengeTag); }}
                    aria-label={`${dailyTheme.naturalist}'s challenge: ${themeExtra.challenge} Meet ${dailyTheme.naturalist} and see what explorers found.`}
                    className="group w-full text-left flex items-start gap-4 py-1 rounded-lg"
                >
                    <span className="ng-rule mt-[14px] shrink-0" aria-hidden="true" />
                    <span className="flex-1 min-w-0 ng-measure">
                        <span className="block font-display italic text-[20px] leading-[1.35] text-stone-900 text-pretty">{themeExtra.challenge}</span>
                        <span className="block ng-caption mt-1.5">
                            {[`${dailyTheme.naturalist}'s challenge`, `${themePeriod.daysRemaining} ${themePeriod.daysRemaining === 1 ? 'day' : 'days'} left`, challenge?.mine ? 'you answered' : challenge?.explorers ? `${challenge.capped ? '60+' : challenge.explorers} answered` : null].filter(Boolean).join(' · ')}
                        </span>
                    </span>
                    <Glyph name="forward" size={20} className="text-theme-accent shrink-0 mt-1.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
            )}

            {/* The one search (shared with Explore), then one row of kinds of life; the rest behind Filters */}
            {(() => {
                const filtersButton = (
                    <button
                        type="button"
                        onClick={() => setShowFilters(s => !s)}
                        aria-expanded={showFilters}
                        className={`relative min-h-[44px] px-2 -mr-2 rounded-full transition-colors flex items-center gap-2 text-sm font-medium shrink-0 ${
                            showFilters || drawerFiltersOn ? 'text-stone-900' : 'text-stone-600 hover:text-stone-900'
                        }`}
                    >
                        <Glyph name="filter" size={20} />
                        <span className="hidden sm:inline">Filters</span><span className="sr-only sm:hidden">Filters</span>
                        {drawerFiltersOn && <span className="ng-dot" aria-hidden="true" />}
                    </button>
                );
                if (isJournalOnly) {
                    return (
                        <div className="flex items-center gap-3">
                            <div className="relative flex-1">
                                <Glyph name="search" size={20} className="absolute left-0 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
                                <input
                                    type="search"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    aria-label="Search your journal"
                                    placeholder="Search your journal"
                                    className="ng-field-line pl-8"
                                />
                            </div>
                            {filtersButton}
                        </div>
                    );
                }
                return (
                    <SearchPanel
                        inputId="feed-search"
                        query={searchQuery}
                        onQueryChange={setSearchQuery}
                        open={searchOpen}
                        onFocus={() => { setIsSearchFocused(true); setShowFilters(false); }}
                        onCancel={closeSearch}
                        aside={filtersButton}
                        onOpenPost={handlePostClick}
                        onOpenProfile={(uid) => { closeSearch(); onViewProfile?.(uid); }}
                        onOpenSpecies={(name) => handleSpeciesClick(name)}
                        suggestions={searchSuggestions}
                    />
                );
            })()}

            {!searchOpen && showFilters && (() => {
                const seg = (on: boolean) => `ng-chip ${on ? 'ng-chip-on' : ''}`;
                const naturalistShort = (themePeriod.theme?.naturalist || '').split(' ').slice(-1)[0];
                return (
                    <div className="py-6 border-y border-stone-200/80 flex flex-col gap-6 ng-rise">
                        <fieldset className="space-y-2">
                            <legend className="ng-label mb-3">Photo, video or sound</legend>
                            <div className="flex flex-wrap gap-2">
                                {([['all', 'Any'], ['image', 'Photos'], ['video', 'Videos'], ['audio', 'Sounds']] as const).map(([media, label]) => (
                                    <button key={media} type="button" aria-pressed={mediaFilter === media} onClick={() => { setMediaFilter(media); track('filter_use', { filter: 'media', value: media }); }} className={seg(mediaFilter === media)}>{label}</button>
                                ))}
                            </div>
                        </fieldset>
                        <fieldset className="space-y-2">
                            <legend className="ng-label mb-3">Season</legend>
                            <div className="flex flex-wrap gap-2">
                                {([
                                    ['all', 'Any time', ''],
                                    ['today', 'Today', ''],
                                    ['fortnight', 'This fortnight', naturalistShort ? `Since ${naturalistShort}'s fortnight began` : ''],
                                    ['month', 'This month', ''],
                                    ['season', 'This season', ''],
                                ] as const).map(([key, label, hint]) => (
                                    <button key={key} type="button" aria-pressed={dateFilter === key} title={hint || undefined} onClick={() => { setDateFilter(key); track('filter_use', { filter: 'date', value: key }); }} className={seg(dateFilter === key)}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                        <fieldset className="space-y-2">
                            <legend className="ng-label mb-3">Order</legend>
                            <div className="flex flex-wrap gap-2">
                                {([['newest', 'Newest first'], ['likes', 'Most marvelled']] as const).map(([opt, label]) => (
                                    <button key={opt} type="button" aria-pressed={sortOrder === opt} onClick={() => { setSortOrder(opt); track('filter_use', { filter: 'order', value: opt }); }} className={seg(sortOrder === opt)}>{label}</button>
                                ))}
                            </div>
                        </fieldset>
                        {drawerFiltersOn && (
                            <button type="button" onClick={() => { setMediaFilter('all'); setDateFilter('all'); setSortOrder('newest'); }} className="self-start ng-link-quiet min-h-[44px]">Clear filters</button>
                        )}
                    </div>
                );
            })()}

            {!searchOpen && (
                <KindChips present={groupsPresent} selected={selectedGroup} onSelect={(g) => { setSelectedGroup(g); hapticFeedback(); track('filter_use', { filter: 'kind', value: g || 'all' }); }} />
            )}
        </div>)}

        <div className={`w-full ng-page pt-6 pb-8 md:pt-8 ${searchOpen ? 'hidden' : ''}`}>
            {isLoading ? (
                <SkeletonGrid />
            ) : error ? (
                <div role="alert" className="ng-empty py-24 max-w-xl mx-auto ng-rise">
                    <Glyph name="offline" size={40} strokeWidth={1.2} className="ng-empty-glyph" />
                    <h3 className="ng-empty-title">The field guide didn't load</h3>
                    <p className="ng-empty-body mb-8">
                        {typeof navigator !== 'undefined' && navigator.onLine === false
                            ? "You appear to be offline. Check your connection and try again."
                            : "Something went wrong on our side. Please try again in a moment."}
                    </p>
                    <button
                        onClick={() => { setError(null); setRetryKey(k => k + 1); }}
                        className="ng-button-primary"
                    >
                        Try again
                    </button>
                </div>
            ) : filteredAndSortedPosts.length === 0 ? (
                <div className="ng-empty py-24 sm:py-32">
                    {(() => {
                        const typed = isJournalOnly && !!searchQuery.trim();
                        // Filters only look through what has been loaded so far: say so, and offer more
                        const canLoadMore = hasMore && !isJournalOnly && posts.length > 0;
                        const loadMoreButton = canLoadMore && (
                            <button onClick={() => loadMore()} disabled={loadMoreState === 'loading'} className="ng-button-primary">
                                {loadMoreState === 'loading' ? 'Looking further…' : 'Load more'}
                            </button>
                        );
                        if (isJournalOnly && !searchQuery && !searchTag && !anyFilterOn) return (<>
                            <Glyph name="rings" size={40} strokeWidth={1.2} className="ng-empty-glyph" />
                            <h3 className="ng-empty-title">Your journal starts outside</h3>
                            <p className="ng-empty-body">Your sightings will gather here.</p>
                        </>);
                        if (feedMode === 'following' && !anyFilterOn) {
                            const none = followIdList !== null && followIdList.length === 0;
                            return (<>
                                <Glyph name="binoculars" size={40} strokeWidth={1.2} className="ng-empty-glyph" />
                                <h3 className="ng-empty-title">{none ? "You aren't following anyone yet" : "The explorers you follow haven't shared yet"}</h3>
                                <p className="ng-empty-body mb-8">{none ? 'Follow explorers from their sightings: tap Follow beside their name.' : 'Their next sightings will gather here.'}</p>
                                <button onClick={() => setFeedMode('foryou')} className="ng-button-primary">For you</button>
                            </>);
                        }
                        return (<>
                            <Glyph name="compass" size={40} strokeWidth={1.2} className="ng-empty-glyph" />
                            {typed ? (<>
                                <h3 className="ng-empty-title">Nothing matches “{searchQuery.trim()}”</h3>
                                <p className="ng-empty-body mb-8">Try another word.</p>
                            </>) : feedMode === 'following' ? (<>
                                <h3 className="ng-empty-title">Your filters hide their sightings</h3>
                                <p className="ng-empty-body mb-8">{posts.length} {posts.length === 1 ? 'sighting' : 'sightings'} from the explorers you follow, none with these filters.</p>
                            </>) : (<>
                                <h3 className="ng-empty-title">{canLoadMore ? `Nothing among the latest ${posts.length} sightings` : 'Nothing with these filters'}</h3>
                                <p className="ng-empty-body mb-8">{canLoadMore ? 'Older sightings may match. Load more?' : "That's every sighting there is for now."}</p>
                            </>)}
                            <div className="flex flex-col items-center gap-3">
                                {loadMoreButton}
                                {loadMoreState === 'error' && <p role="alert" className="ng-small">Couldn't load more. Try again.</p>}
                                {anyFilterOn && <button onClick={resetAllFilters} className="ng-button-quiet">Clear filters</button>}
                            </div>
                        </>);
                    })()}
                </div>
            ) : (
                <>
                    {!isJournalOnly && <FirstHint id="wild" text="Scroll for today's sightings. Tap one to open it." className="!mx-0 !mt-0 mb-6" />}
                    <FeedGrid posts={displayPosts} onPostClick={handlePostClick} hideCounts={hideCounts} label={isJournalOnly ? 'Your sightings' : feedMode === 'following' ? 'Sightings from explorers you follow' : "Today's sightings"} />
                </>
            )}
            {!isLoading && !error && filteredAndSortedPosts.length > 0 && (
                <div ref={loadMoreRef} className="py-8 pb-40 flex flex-col items-center gap-3 text-sm text-stone-500" aria-live="polite">
                    {loadMoreState === 'loading' ? (
                        <PressingLoader size={28} label="Finding more sightings" />
                    ) : loadMoreState === 'error' ? (
                        <button onClick={() => { setLoadMoreState('idle'); loadMore(); }} className="ng-link-quiet min-h-[44px]">Couldn't load more. Tap to retry</button>
                    ) : !hasMore && !isJournalOnly ? (
                        <span className="font-display italic text-base text-stone-500">{anyFilterOn ? `That's every sighting with these filters, out of ${posts.length}.` : "That's every sighting for now. The next one is outside."}</span>
                    ) : anyFilterOn && !isJournalOnly ? (
                        // Filters look through what is loaded: keep looking further on request
                        <button onClick={() => loadMore()} className="ng-link-quiet min-h-[44px]">Look through older sightings</button>
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
                className="animate-in fade-in slide-in-from-bottom-4 duration-200 fixed inset-0 z-[150] bg-day-bg flex flex-col h-full w-full overflow-hidden"
            >
                <header className="h-16 px-4 md:px-8 flex items-center justify-between bg-day-bg border-b border-stone-200/80 shrink-0 z-[160] safe-pt box-content">
                    <button onClick={closeDetail} aria-label={`Back to ${isJournalOnly ? 'journal' : (searchTag ? 'search' : backLabel.toLowerCase())}`} className="flex items-center gap-2 h-11 pr-3 -ml-1 pl-1 rounded-full text-stone-700 hover:text-stone-900 transition-colors">
                        <Glyph name="back" size={24} />
                        <span className="text-[15px] font-medium">{isJournalOnly ? 'Journal' : (searchTag ? 'Search' : backLabel)}</span>
                    </button>

                    <div className="flex items-center gap-1 relative">
                        {/* Phones: the previous and next sighting are a tap away here too, not only a swipe */}
                        {activePostIndex !== -1 && displayPosts.length > 1 && (
                            <div className="flex items-center md:hidden" role="group" aria-label="Move between sightings">
                                <button onClick={() => navigateSequential('prev')} disabled={activePostIndex <= 0} aria-label="Previous sighting" className="ng-icon-button"><Glyph name="chevronLeft" size={22} /></button>
                                <button onClick={() => navigateSequential('next')} disabled={activePostIndex >= displayPosts.length - 1} aria-label="Next sighting" className="ng-icon-button"><Glyph name="chevronRight" size={22} /></button>
                            </div>
                        )}
                        <button onClick={() => (postMenuOpen ? closeMenu() : setPostMenuOpen(true))} aria-label="More options" aria-haspopup="menu" aria-expanded={postMenuOpen} className="ng-icon-button -mr-2">
                            <Glyph name="more" size={24} />
                        </button>
                        {postMenuOpen && <div className="fixed inset-0 z-[190]" onClick={closeMenu} aria-hidden="true" />}
                        {postMenuOpen && (
                            <div role="menu" aria-label="More options" className="absolute right-0 top-12 w-64 ng-menu z-[200] animate-fade-in motion-reduce:animate-none">
                                {activePost.userId === currentUserMode.userId ? (
                                    <>
                                        {(((activePost.items && activePost.items[activeItemIndex]) || activePost).mediaType !== 'audio') && (
                                            <button role="menuitem" onClick={() => { setPostMenuOpen(false); setIsEditing(true); }} className="ng-menu-item"><Glyph name="edit" size={20} className="text-stone-500" />{((activePost.items && activePost.items[activeItemIndex]) || activePost).mediaType === 'video' ? 'Rotate video' : 'Edit photo'}</button>
                                        )}
                                        <button role="menuitem" onClick={async () => { setPostMenuOpen(false); const next = !activePost.isPublic; try { await FirebaseService.updatePost(activePost.id, { isPublic: next } as any); setActivePost(p => p ? { ...p, isPublic: next } : p); showToast(next ? 'Now shared with everyone' : 'Now only you can see it'); } catch (err: any) { showToast(err?.message || 'Could not change visibility.'); } }} className="ng-menu-item"><Glyph name={activePost.isPublic ? 'lock' : 'globe'} size={20} className="text-stone-500" />{activePost.isPublic ? 'Make it only me' : 'Share with everyone'}</button>
                                        <button role="menuitem" onClick={() => { setPostMenuOpen(false); handleDeletePost(activePost.id); }} className="ng-menu-item ng-menu-item-danger"><Glyph name="trash" size={20} />Delete sighting</button>
                                    </>
                                ) : (
                                    <>
                                        <button role="menuitem" onClick={() => { setPostMenuOpen(false); handleProfileClick(activePost.userId); }} className="ng-menu-item"><Glyph name="person" size={20} className="text-stone-500" />View {explorerName(activePost.userName)}</button>
                                        <button role="menuitem" onClick={() => openReport({ kind: 'post', postId: activePost.id, userId: activePost.userId }, 'this sighting')} className="ng-menu-item ng-menu-item-danger"><Glyph name="flag" size={20} />Report sighting</button>
                                        <button role="menuitem" onClick={handleMuteAuthor} className="ng-menu-item"><Glyph name="soundOff" size={20} className="text-stone-500" />Mute {explorerName(activePost.userName)}</button>
                                        <button role="menuitem" onClick={handleBlockAuthor} className="ng-menu-item ng-menu-item-danger"><Glyph name="block" size={20} />Block {explorerName(activePost.userName)}</button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </header>

                <div
                    key={activePost.id}
                    ref={mainScrollRef}
                    className="animate-in fade-in slide-in-from-right-4 duration-200 flex-1 flex flex-col md:flex-row [@media(orientation:landscape)_and_(max-height:500px)]:flex-row overflow-hidden bg-day-bg w-full h-full"
                >
                    {(() => {
                        const currentItem = activePost.items && activePost.items.length > 0 ? activePost.items[activeItemIndex] : activePost;
                        const hasMultipleItems = activePost.items && activePost.items.length > 1;

                        return (
                            <>
                                <div
                                    className="flex-1 min-h-0 bg-[#f3efe7] flex flex-col justify-center relative group/media overflow-hidden"
                                    onClick={(e) => { if ((e.target as HTMLElement).closest('button,video,audio')) return; handleDoubleTap(e, activePost); }}
                                    onContextMenu={(e) => { if (activePost.userId !== currentUserMode.userId) e.preventDefault(); }}
                                >
                                    {wonderBurst && <WonderBurst key={wonderBurst.key} x={wonderBurst.x} y={wonderBurst.y} />}
                                    {/* Previous and next sighting, at the edges of the picture (desktop; phones swipe) */}
                                    {activePostIndex > 0 && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); navigateSequential('prev'); }}
                                            className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-day-bg/90 hover:bg-day-bg text-stone-800 items-center justify-center shadow-[0_4px_16px_-8px_rgba(28,25,23,0.4)] z-[180] transition-colors hidden md:flex"
                                            aria-label="Previous sighting"
                                        >
                                            <Glyph name="chevronLeft" size={24} />
                                        </button>
                                    )}
                                    {activePostIndex !== -1 && activePostIndex < displayPosts.length - 1 && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); navigateSequential('next'); }}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-day-bg/90 hover:bg-day-bg text-stone-800 items-center justify-center shadow-[0_4px_16px_-8px_rgba(28,25,23,0.4)] z-[180] transition-colors hidden md:flex"
                                            aria-label="Next sighting"
                                        >
                                            <Glyph name="chevronRight" size={24} />
                                        </button>
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
                                                            <SightingVideo src={item.videoUrl} streamUrl={(item as any).streamUrl} poster={item.thumbnailUrl || item.imageUrl} noDownload={activePost.userId !== currentUserMode.userId} label={namesOf({ ...item, aiIdentifications: (item as any).aiIdentifications || (activePost as any).aiIdentifications }).common || undefined} />
                                                        ) : item.mediaType === 'audio' ? (
                                                            <SightingSound src={item.audioUrl} image={item.thumbnailUrl || item.imageUrl} noDownload={activePost.userId !== currentUserMode.userId} label={namesOf({ ...item, aiIdentifications: (item as any).aiIdentifications || (activePost as any).aiIdentifications }).common || undefined} />
                                                        ) : (
                                                            <img
                                                                src={item.imageUrl || item.thumbnailUrl}
                                                                alt={item.labels?.[0] ? `${namesOf(item).common}${item.behavior ? `: ${item.behavior}` : ''}` : 'Sighting'}
                                                                className="w-full h-full md:w-auto md:h-auto md:max-w-full md:max-h-full object-contain rounded-none md:rounded-md"
                                                            />
                                                        )}
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Left Arrow overlay visible on hover */}
                                            {activeItemIndex > 0 && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); scrollToItem(activeItemIndex - 1); }}
                                                    aria-label="Previous picture" className="absolute left-4 md:left-[4.5rem] top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center opacity-80 md:opacity-0 md:group-hover/media:opacity-100 transition-opacity z-[175] pointer-events-auto"
                                                >
                                                    <Glyph name="chevronLeft" size={20} />
                                                </button>
                                            )}

                                            {/* Right Arrow overlay visible on hover */}
                                            {activeItemIndex < (activePost.items?.length || 1) - 1 && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); scrollToItem(activeItemIndex + 1); }}
                                                    aria-label="Next picture" className="absolute right-4 md:right-[4.5rem] top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center opacity-80 md:opacity-0 md:group-hover/media:opacity-100 transition-opacity z-[175] pointer-events-auto"
                                                >
                                                    <Glyph name="chevronRight" size={20} />
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
                                                <SightingVideo src={currentItem.videoUrl} streamUrl={(currentItem as any).streamUrl} poster={currentItem.thumbnailUrl || currentItem.imageUrl} noDownload={activePost.userId !== currentUserMode.userId} label={namesOf({ ...currentItem, aiIdentifications: (currentItem as any).aiIdentifications || (activePost as any).aiIdentifications }).common || undefined} />
                                            ) : currentItem.mediaType === 'audio' ? (
                                                <SightingSound src={currentItem.audioUrl} image={currentItem.thumbnailUrl || currentItem.imageUrl} noDownload={activePost.userId !== currentUserMode.userId} label={namesOf({ ...currentItem, aiIdentifications: (currentItem as any).aiIdentifications || (activePost as any).aiIdentifications }).common || undefined} />
                                            ) : (
                                                <img
                                                    src={currentItem.imageUrl || currentItem.thumbnailUrl}
                                                    alt={currentItem.labels?.[0] ? `${namesOf(currentItem).common}${currentItem.behavior ? `: ${currentItem.behavior}` : ''}` : 'Sighting'}
                                                    className="w-full h-full md:w-auto md:h-auto md:max-w-full md:max-h-full object-contain rounded-none md:rounded-md"
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="w-full md:w-[400px] [@media(orientation:landscape)_and_(max-height:500px)]:w-[48%] [@media(orientation:landscape)_and_(max-height:500px)]:max-h-none [@media(orientation:landscape)_and_(max-height:500px)]:border-t-0 [@media(orientation:landscape)_and_(max-height:500px)]:border-l shrink-0 max-h-[45vh] md:max-h-none border-t md:border-t-0 md:border-l border-stone-200/80 bg-day-bg flex flex-col hidden-scrollbar">
                                    <div className="px-6 pt-4 pb-4 md:px-8 md:pt-6 flex items-center justify-between gap-4 shrink-0">
                                        <button className="flex items-center gap-3 group text-left min-w-0" onClick={() => handleProfileClick(activePost.userId)}>
                                            {activePost.userAvatar
                                                ? <img src={activePost.userAvatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                                                : <span className="w-10 h-10 rounded-full bg-[#f3efe7] flex items-center justify-center text-stone-700 font-display text-lg" aria-hidden="true">{(activePost.userName || '?').charAt(0).toUpperCase()}</span>}
                                            <span className="min-w-0">
                                                <span className="block font-medium text-sm text-stone-900 truncate group-hover:underline decoration-stone-300 underline-offset-4">{explorerName(activePost.userName, true)}{speciesLine(activePost.userId) && <span className="font-normal text-stone-500"> · {speciesLine(activePost.userId)}</span>}</span>
                                                <span className="block text-xs text-stone-500 truncate">{[(currentItem.locationArea || '').trim().replace(/^(uploaded|captured)?\s*field station$/i, '') || 'Somewhere wild', timeAgo(activePost.timestamp)].filter(Boolean).join(', ')}</span>
                                            </span>
                                        </button>
                                        {activePost.userId !== currentUserMode.userId && (
                                            <button
                                                onClick={toggleFollowAuthor}
                                                disabled={followBusy || (isMember && followsAuthor === null)}
                                                aria-pressed={!!followsAuthor}
                                                aria-label={followsAuthor ? `Following ${explorerName(activePost.userName)}. Tap to unfollow` : `Follow ${explorerName(activePost.userName)}`}
                                                className={`shrink-0 ml-auto -mr-2 min-h-[44px] px-2 text-sm font-semibold transition-colors disabled:opacity-50 ${followsAuthor ? 'text-stone-500 hover:text-stone-800' : 'text-stone-900 underline decoration-stone-300 underline-offset-[6px] hover:decoration-stone-900'}`}
                                            >
                                                {followsAuthor ? 'Following' : 'Follow'}
                                            </button>
                                        )}
                                        {(() => { const liked = isLikedByMe(activePost); const n = likeTotal(activePost); return (
                                            <button
                                                onClick={(e) => handleLike(e, activePost)}
                                                aria-pressed={liked}
                                                aria-label={hideCounts ? (liked ? 'You marvelled at this' : 'Marvel at this sighting') : (liked ? `You marvelled at this. ${wonderLabel(n)}` : `Marvel at this sighting. ${wonderLabel(n)}`)}
                                                className={`shrink-0 flex items-center gap-2 min-h-[44px] pl-3.5 pr-4 rounded-full border transition-colors duration-300 ${liked ? 'border-stone-900 text-stone-900' : 'border-stone-200 text-stone-700 hover:border-stone-300 hover:text-stone-900'}`}
                                            >
                                                <WonderIcon active={liked} className={`text-[20px] ${liked ? 'text-theme-accent' : ''}`} />
                                                <span className="text-sm font-medium tabular">{!hideCounts && n > 0 ? n.toLocaleString() : liked ? 'Marvelled' : 'Marvel'}</span>
                                            </button>
                                        ); })()}
                                    </div>
                                    <div className="px-6 pt-2 pb-6 md:px-8 flex-1 overflow-y-auto hidden-scrollbar flex flex-col space-y-8">
                                        {activePost.curatorNote && (
                                            <p className="ng-small flex gap-3"><Glyph name="guide" size={16} className="text-stone-400 mt-1 shrink-0" /><span><span className="font-medium text-stone-800">Why you're seeing this:</span> {activePost.curatorNote}</span></p>
                                        )}
                                        {(() => {
                                            const species = currentItem.labels?.[0];
                                            // The common name leads; the Latin sits underneath
                                            const names = namesOf({ ...currentItem, aiIdentifications: (currentItem as any).aiIdentifications || (activePost as any).aiIdentifications });
                                            const behaviour = observedBehaviour(currentItem.behavior);
                                            const alsoSeen = (currentItem.labels || []).slice(1).filter(l => !names.latin || l.trim().toLowerCase() !== names.latin.toLowerCase());
                                            const insight = currentItem.aiInsight ? (insightBeyond(currentItem.aiInsight, behaviour).length ? insightBeyond(currentItem.aiInsight, behaviour) : currentItem.aiInsight.split(/\n+/).filter(Boolean)) : [];
                                            return (
                                                <>
                                                    <div>
                                                        {species && !PLACEHOLDER_NAME.test(names.common || species) ? (
                                                            <button onClick={() => handleSpeciesClick(names.common || species, currentItem.locationArea)} className="text-left" aria-label={`About ${names.common || species}`}>
                                                                <h2 className="ng-title italic hover:underline decoration-theme-accent/50 decoration-1 underline-offset-[6px]">{names.common || species}</h2>
                                                                {names.latin && <p className="font-display italic text-base text-stone-500 mt-0.5">{names.latin}</p>}
                                                            </button>
                                                        ) : activePost.title && !PLACEHOLDER_NAME.test(activePost.title) ? (
                                                            <h2 className="ng-title">{activePost.title}</h2>
                                                        ) : <h2 className="ng-title italic text-stone-700">Unnamed sighting</h2>}
                                                        <Provenance item={currentItem} post={activePost} agree={agreeCount} />
                                                        {behaviour && <p className="ng-body mt-3">{behaviour}</p>}
                                                        {alsoSeen.length > 0 && (
                                                            <p className="ng-small mt-2">Also in view: {alsoSeen.map((l, i) => (
                                                                <React.Fragment key={l}>{i > 0 && ', '}<button onClick={() => handleSpeciesClick(l, currentItem.locationArea)} className="italic text-stone-900 hover:underline">{l}</button></React.Fragment>
                                                            ))}</p>
                                                        )}
                                                    </div>

                                                    {isFungiPost(currentItem as any) && <FungiWarning />}

                                                    {activePost.caption && (
                                                        <figure className="border-l border-theme-accent pl-5">
                                                            <blockquote className="ng-body text-stone-800 whitespace-pre-line"><RichText text={activePost.caption} onMention={openMention} onTag={handleTagClick} /></blockquote>
                                                            <figcaption className="ng-caption mt-2">{explorerName(activePost.userName, true)}</figcaption>
                                                        </figure>
                                                    )}

                                                    {insight.length > 0 && (
                                                        <section aria-labelledby={`why-${activePost.id}`}>
                                                            <h3 id={`why-${activePost.id}`} className="ng-subtitle flex items-center gap-3"><span className="ng-rule" aria-hidden="true" />Why it does this</h3>
                                                            <p className="ng-caption mt-1 mb-3 pl-11">{(currentItem as any).aiInsightEdited || (activePost as any).aiInsightEdited ? 'From the guide (AI), edited by the explorer' : 'From the guide (AI)'}</p>
                                                            <WhyItDoes key={`${activePost.id}-${activeItemIndex}`} paragraphs={insight} />
                                                        </section>
                                                    )}

                                                    {(activePost.items?.length || 0) > 1 && activePost.description && (
                                                        <p className="ng-body">{activePost.description}</p>
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
                                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                                                {visibleTags(activePost).map(tag => (
                                                    <button key={tag} onClick={() => handleTagClick(tag)} className="text-sm text-stone-600 hover:text-stone-900 hover:underline underline-offset-4 min-h-[44px]">
                                                        {tag.startsWith('#') ? tag : `#${tag}`}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        <div className="pb-4 md:pb-8">
                                            <button
                                                onClick={() => setIsCommentsOpen(true)}
                                                className="w-full min-h-[56px] flex items-center gap-4 border-y border-stone-200/80 transition-colors text-left text-stone-800 hover:text-stone-900"
                                            >
                                                <Glyph name="feather" size={20} className="text-stone-500" />
                                                <span className="flex-1 text-[15px] font-medium">{visibleComments.length ? `${visibleComments.length} field note${visibleComments.length === 1 ? '' : 's'}` : 'Add a field note'}</span>
                                                <Glyph name="chevronRight" size={20} className="text-stone-400" />
                                            </button>
                                            <div className="flex items-center gap-8 pt-2">
                                                <button onClick={handleSave} aria-pressed={isSaved} className={`min-h-[48px] text-sm font-medium flex items-center gap-2 transition-colors ${isSaved ? 'text-stone-900' : 'text-stone-600 hover:text-stone-900'}`}>
                                                    <Glyph name="keep" size={20} filled={isSaved} className={isSaved ? 'text-theme-accent' : ''} />
                                                    {isSaved ? 'Kept' : 'Keep'}
                                                </button>
                                                <button onClick={() => setSharingPost(activePost)} className="min-h-[48px] text-stone-600 hover:text-stone-900 text-sm font-medium flex items-center gap-2 transition-colors">
                                                    <Glyph name="share" size={20} />
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
            <div className="fixed inset-0 z-[200] flex flex-col justify-end p-0 ng-scrim font-body" role="dialog" aria-modal="true" aria-labelledby="comments-title">
                <div
                    className="absolute inset-0 animate-in fade-in duration-200"
                    onClick={closeNotes}
                    aria-hidden="true"
                />
                <div
                    ref={sheetRef}
                    onTouchStart={(e) => { sheetDrag.current = { y: e.touches[0].clientY, t: Date.now(), on: !!(e.target as HTMLElement).closest('[data-sheet-handle]') }; }}
                    onTouchMove={(e) => { const d = e.touches[0].clientY - sheetDrag.current.y; if (sheetDrag.current.on && d > 0 && sheetRef.current) sheetRef.current.style.transform = `translateY(${d}px)`; }}
                    onTouchEnd={(e) => { if (!sheetDrag.current.on) return; const d = e.changedTouches[0].clientY - sheetDrag.current.y; const v = d / Math.max(1, Date.now() - sheetDrag.current.t); if (sheetRef.current) sheetRef.current.style.transform = ''; if (d > 100 || v > 0.5) closeNotes(); }}
                    className="animate-in slide-in-from-bottom duration-300 transition-transform w-full max-w-md mx-auto ng-sheet md:rounded-b-none overflow-hidden flex flex-col h-[75vh] relative z-10 pb-[env(safe-area-inset-bottom)]"
                >
                    <div data-sheet-handle className="w-full flex justify-center pt-3 pb-2 shrink-0 cursor-grab active:cursor-grabbing">
                        <div className="w-9 h-1 bg-stone-300/80 rounded-full"></div>
                    </div>

                    <div className="px-6 pb-4 flex justify-between items-center shrink-0 border-b border-stone-200/80">
                        <h3 id="comments-title" className="ng-subtitle">Field notes</h3>
                        <button onClick={closeNotes} aria-label="Close field notes" className="ng-icon-button -mr-2">
                            <Glyph name="close" size={24} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {visibleComments.length === 0 ? (
                            <div className="h-full ng-empty justify-center py-8">
                                <Glyph name="feather" size={40} strokeWidth={1.2} className="ng-empty-glyph" />
                                <p className="ng-empty-title">Be the first to add what you noticed.</p>
                            </div>
                        ) : (
                            visibleComments.map(c => renderNote(c))
                        )}
                    </div>

                    <div className="px-6 py-4 border-t border-stone-200/80 shrink-0">
                        <form onSubmit={handleSendComment} className="flex items-center gap-4">
                            <label htmlFor="new-comment" className="sr-only">Add a field note</label>
                            <input
                                id="new-comment"
                                value={newComment}
                                onChange={e => setNewComment(e.target.value.slice(0, 1000))}
                                // Guests: the account prompt comes on a tap, not on focus (focus alone could loop)
                                readOnly={!isMember}
                                onClick={() => { if (!isMember) askAccount('Create a free account to join the conversation.'); }}
                                placeholder={isMember ? 'What did you notice?' : 'Log in to add a field note'}
                                className="ng-field-line flex-1"
                            />
                            <button type="submit" disabled={isMember && (!newComment.trim() || sendingComment)} className="min-h-[44px] px-1 text-stone-900 text-[15px] font-semibold disabled:text-stone-500 transition-colors">
                                {sendingComment ? 'Adding…' : 'Add'}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        )}
    </>

    <>
        {/* One Share: the plate, other apps, a letter, and for the author, the original too */}
        {sharingPost && (
            <React.Suspense fallback={null}><ShareSheet
                post={sharingPost}
                activeItemIndex={activeItemIndex}
                onClose={() => setSharingPost(null)}
                onSendLetter={sendAsLetter}
                allowMediaDownload={sharingPost.userId === currentUserMode.userId}
                surface="post"
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

        {reportTarget && (
            <ReportSheet
                target={reportTarget}
                what={reportTarget.what}
                onClose={onReportClosed}
                onSent={onReportSent}
                surface="post"
            />
        )}

        {toast && <div role="status" className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[300] ng-toast animate-fade-in">{toast}</div>}

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
