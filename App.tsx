import React, { useState, useEffect, useRef, Suspense, lazy, useCallback } from 'react';
import Journal from './components/Journal.tsx';
import Community from './components/Community.tsx';
import AuthModal from './components/AuthModal.tsx';
import UploadModal from './components/UploadModal.tsx';
import { RateLimitService } from './services/rateLimitService.ts';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { Snapshot, AppView, GeminiConfig, UserMode, FieldNotification, ExpeditionDraft } from './types.ts';
import { FirebaseService } from './services/firebaseService.ts';
import { GeminiLiveService } from './services/geminiLiveService.ts';
import { hapticFeedback, timeAgo, PUBLIC_ORIGIN } from './utils.ts';
import { ThemeService, DailyTheme } from './services/themeService.ts';
import { getDailyTheme as getFallbackTheme } from './constants/naturalists.ts';
import { getNaturalistExtra, getThemePeriod } from './constants/naturalistExtras.ts';
import ConsentBanner from './components/ConsentBanner.tsx';
import InstallCard from './components/InstallCard.tsx';
import TeenBanner from './components/TeenBanner.tsx';
import { weekKey, seasonNote, WonderIcon } from './components/Wonder.tsx';
import { identify, track, getConsent, onConsentChange } from './services/analytics.ts';
import { registerToken, showLocalNotification } from './services/push.ts';
import Glyph, { GlyphName } from './components/Glyph.tsx';
import BrandMark from './components/BrandMark';
import FirstHint from './components/FirstHint';
import { wasOverlayPop, useBackToClose, overlayOpen } from './services/overlayStack';
import { startUpdateWatch, reloadNow, justUpdated } from './services/appUpdate';
import { useFocusTrap } from './services/focusTrap';
import SpecimenPlate, { PlateData } from './components/SpecimenPlate.tsx';
import FirstRunTour, { hasSeenFirstRunTour, resetFirstRunTour } from './components/FirstRunTour.tsx';
import { buildLifeList, toMs } from './services/lifeList.ts';
import { db } from './firebaseConfig.ts';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
// Heavy, rarely-first views load on demand to keep the first paint fast (a stale chunk after a deploy
// is caught by ErrorBoundary, which reloads once)
const LiveLens = lazy(() => import('./components/LiveLens.tsx'));
const GuardianConsent = lazy(() => import('./components/GuardianConsent.tsx'));
const AdminConsole = lazy(() => import('./components/AdminConsole.tsx'));
const PostSessionView = lazy(() => import('./components/PostSessionView.tsx'));
const UserProfile = lazy(() => import('./components/UserProfile.tsx'));
const DraftsTray = lazy(() => import('./components/DraftsTray.tsx'));
const Messages = lazy(() => import('./components/Messages.tsx'));
const Reels = lazy(() => import('./components/Reels.tsx'));
const Explore = lazy(() => import('./components/Explore.tsx'));
const SharedPostView = lazy(() => import('./components/SharedPostView.tsx'));
const NaturalistPage = lazy(() => import('./components/NaturalistPage.tsx'));
const NaturalistPersonaModal = lazy(() => import('./components/NaturalistPersonaModal.tsx'));
const AuthAction = lazy(() => import('./components/AuthAction.tsx'));

/** One gentle loader for the whole app: a leaf outline being pressed into the page (still under reduced motion). */
const PressingLeaf: React.FC<{ className?: string; size?: number }> = ({ className = '', size = 44 }) => (
  <svg viewBox="0 0 48 48" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={`press-leaf ${className}`} aria-hidden="true">
    <path d="M24 42C12 36 9 24 14 13c6 1 17 5 20 15 2 7-3 12-10 14z" />
    <path d="M24 42c-1-9-4-17-9-26M20 30l-6-1M22 24l6-3" />
  </svg>
);

const ViewLoader: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <div className={`flex-1 flex items-center justify-center ${dark ? 'bg-black' : ''}`} role="status" aria-live="polite">
    <PressingLeaf className={dark ? 'text-white/60' : 'text-stone-900/50'} />
    <span className="sr-only">Loading…</span>
  </div>
);

/** The guide's last words when a Lens session closes without a summary of its own. */
const CLOSING_LINE = 'We closed the notebook on a good walk. Your captures are waiting for you to write them up.';

// ---- Activity: group repeated events and raise the meaningful ones -------------------------------
type NoteGroup = { key: string; lead: FieldNotification; members: FieldNotification[]; unread: boolean };
/** ID confirmations, replies and mentions first; marvels last. */
const NOTE_RANK: Record<string, number> = { identification: 0, reply: 0, mention: 0, message: 1, comment: 1, follow: 2, sighting: 2, system: 2, like: 3 };
const NOTE_GLYPH: Partial<Record<FieldNotification['type'], GlyphName>> = { comment: 'feather', reply: 'feather', follow: 'tracks', mention: 'feather', message: 'letter', identification: 'tag', sighting: 'binoculars', system: 'notebook' };

const groupNotifications = (list: FieldNotification[]): NoteGroup[] => {
  const map = new Map<string, NoteGroup>();
  for (const n of list) {
    const key = n.postId && n.type !== 'message' && n.type !== 'mention' ? `${n.type}|${n.postId}` : n.id;
    const g = map.get(key);
    if (g) { g.members.push(n); g.unread = g.unread || !n.isRead; if (toMs(n.timestamp) > toMs(g.lead.timestamp)) g.lead = n; }
    else map.set(key, { key, lead: n, members: [n], unread: !n.isRead });
  }
  return [...map.values()].sort((a, b) => {
    if (a.unread !== b.unread) return a.unread ? -1 : 1;
    if (a.unread) { const r = (NOTE_RANK[a.lead.type] ?? 2) - (NOTE_RANK[b.lead.type] ?? 2); if (r) return r; }
    return toMs(b.lead.timestamp) - toMs(a.lead.timestamp);
  });
};

/** The sentence for a group: "7 explorers marvelled at your Kingfisher". */
const groupLine = (g: NoteGroup): { who: string; what: string } => {
  const lead = g.lead;
  const rest = (lead.message || '').replace(lead.senderName || '', '').trim();
  const people = new Set(g.members.map(m => m.senderId || m.senderName || m.id)).size;
  if (g.members.length === 1 || people <= 1) return { who: lead.senderName || 'NatureGram', what: g.members.length > 1 ? `${rest} (${g.members.length} times)` : rest };
  const subject = (rest.match(/your (.+?)\.?$/)?.[1] || 'sighting').replace(/[."]+$/, '');
  if (lead.type === 'like') return { who: `${people} explorers`, what: `marvelled at your ${subject}.` };
  if (lead.type === 'comment' || lead.type === 'reply') return { who: `${lead.senderName || 'An explorer'} and ${people - 1} other${people === 2 ? '' : 's'}`, what: 'left field notes on your sighting.' };
  if (lead.type === 'identification') return { who: `${people} explorers`, what: 'weighed in on the identification of your sighting.' };
  return { who: `${lead.senderName || 'An explorer'} and ${people - 1} other${people === 2 ? '' : 's'}`, what: rest };
};

const PERSONA_OFFER_KEY = 'naturegram_persona_offer';

const PATHS: Record<AppView, string> = {
  [AppView.LANDING]: '/',
  [AppView.COMMUNITY]: '/feed',
  [AppView.JOURNAL]: '/journal',
  [AppView.USER_PROFILE]: '/profile',
  [AppView.ADMIN]: '/admin',
  [AppView.DRAFTS]: '/drafts',
  [AppView.LENS]: '/lens',
  [AppView.POST_SESSION]: '/review',
  [AppView.SHARED_POST]: '/feed',
  [AppView.MESSAGES]: '/messages',
  [AppView.REELS]: '/reels',
  [AppView.EXPLORE]: '/explore',
};

const pathId = (p: string, prefix: string) => (p.startsWith(prefix) ? decodeURIComponent(p.slice(prefix.length).split('/')[0] || '') || null : null);
const getInitialPostId = () => pathId(window.location.pathname, '/post/') || new URLSearchParams(window.location.search).get('p');
const getInitialProfileId = () => pathId(window.location.pathname, '/profile/') || new URLSearchParams(window.location.search).get('user');

/**
 * Links from our letters (/auth/action?mode=…&oobCode=…) and the /welcome continue URL open
 * AuthAction over the feed. The address is read once, then the one-time code leaves the address bar.
 */
const AUTH_ACTION_URL = (() => {
  if (!/^\/(auth\/action|welcome)\/?$/.test(window.location.pathname)) return null;
  const url = window.location.pathname + window.location.search;
  window.history.replaceState(null, '', '/feed');
  return url;
})();

const viewFromPath = (p: string): AppView => {
  if (p === '/' || p === '') return AppView.LANDING;
  if (p.startsWith('/auth/action') || p.startsWith('/welcome')) return AppView.COMMUNITY;
  if (p.startsWith('/post/')) return AppView.COMMUNITY;
  if (p.startsWith('/journal')) return AppView.JOURNAL;
  if (p.startsWith('/profile')) return AppView.USER_PROFILE;
  if (p.startsWith('/admin')) return AppView.ADMIN;
  if (p.startsWith('/drafts')) return AppView.DRAFTS;
  if (p.startsWith('/messages')) return AppView.MESSAGES;
  if (p.startsWith('/reels')) return AppView.REELS;
  if (p.startsWith('/explore')) return AppView.EXPLORE;
  // Lens and review need live state; after a refresh, land on the feed instead of an empty screen
  return AppView.COMMUNITY;
};

/** A visitor arriving from a shared link (/s/ID → /post/ID?from=share) */
const SHARED_ARRIVAL = (() => {
  const q = new URLSearchParams(window.location.search);
  return q.get('from') === 'share' ? pathId(window.location.pathname, '/post/') : null;
})();

const getInitialView = () => {
  if (new URLSearchParams(window.location.search).has('post')) return AppView.SHARED_POST;
  if (SHARED_ARRIVAL) return AppView.SHARED_POST;
  return viewFromPath(window.location.pathname);
};

const MODE_PREF_KEY = 'naturegram_lens_mode';
const FIRST_LOOK_KEY = 'naturegram_first_look';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(getInitialView());
  const currentViewRef = useRef<AppView>(currentView);
  const [targetProfileId, setTargetProfileId] = useState<string | null>(getInitialProfileId());

  // Keep the URL in sync with the current view (real back/forward support)
  useEffect(() => {
    currentViewRef.current = currentView;
    if (currentView === AppView.SHARED_POST) return;
    let newPath = PATHS[currentView] || '/';
    if (currentView === AppView.USER_PROFILE && targetProfileId) newPath = `/profile/${encodeURIComponent(targetProfileId)}`;
    const here = window.location.pathname + window.location.search;
    const onPostUrl = currentView === AppView.COMMUNITY && (window.location.search.includes('p=') || window.location.pathname.startsWith('/post/'));
    // /explore?q=owl (the search box search engines offer) keeps its question for Explore to read
    const onSearchUrl = currentView === AppView.EXPLORE && window.location.pathname === '/explore';
    if (here !== newPath && !onPostUrl && !onSearchUrl) {
      // depth counts the screens behind this one inside the app, so Back can return to them
      window.history.pushState({ view: currentView, depth: (window.history.state?.depth ?? 0) + 1 }, '', newPath);
    }
  }, [currentView, targetProfileId]);

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (wasOverlayPop(e)) return; // Back closed the window on top; the page stays where it is
      const params = new URLSearchParams(window.location.search);
      if (params.get('post')) {
        setSelectedPostId(params.get('post'));
        setCurrentView(AppView.SHARED_POST);
        return;
      }
      // Back in the Lens with captures, or while a clip is recording: finish and review, like ×
      if (currentViewRef.current === AppView.LENS && (currentSessionRef.current.length > 0 || lensBusyRef.current)) {
        window.history.pushState({ view: AppView.LENS, depth: (window.history.state?.depth ?? 0) + 1 }, '', PATHS[AppView.LENS]);
        setIsFinalizing(true);
        return;
      }
      // Leaving the live lens or review via Back: never silently drop captures
      if (currentViewRef.current === AppView.POST_SESSION && currentSessionRef.current.length > 0) {
        if (!window.confirm(`Leave review? Your ${currentSessionRef.current.length} capture(s) will be saved as a draft.`)) {
          window.history.pushState({ view: AppView.POST_SESSION }, '', PATHS[AppView.POST_SESSION]);
          return;
        }
        handleSaveDraftRef.current?.();
        return;
      }
      const view = viewFromPath(window.location.pathname);
      if (view === AppView.USER_PROFILE) setTargetProfileId(pathId(window.location.pathname, '/profile/') || params.get('user'));
      const postFromPath = pathId(window.location.pathname, '/post/');
      if (postFromPath) { setSelectedPostId(postFromPath); setIsDetailActive(true); }
      setCurrentView(view);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [returnView, setReturnView] = useState<AppView | null>(null);
  const lensBusyRef = useRef(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [currentSessionSnapshots, setCurrentSessionSnapshots] = useState<Snapshot[]>([]);
  const currentSessionRef = useRef<Snapshot[]>([]);
  useEffect(() => { currentSessionRef.current = currentSessionSnapshots; }, [currentSessionSnapshots]);
  const [config, setConfig] = useState<GeminiConfig | null>(null);
  const [userMode, setUserMode] = useState<UserMode | null>({ type: 'anonymous', userId: 'explorer_guest', isAnonymous: true });
  const [sessionSummary, setSessionSummary] = useState("");
  const [dailyTheme, setDailyTheme] = useState<DailyTheme | any>(getFallbackTheme());
  const [resumedDraftId, setResumedDraftId] = useState<string | null>(null);

  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [authModal, setAuthModal] = useState<{ signUp: boolean; reason?: string } | null>(null);
  const pendingAuthActionRef = useRef<(() => void) | null>(null);
  const [notifications, setNotifications] = useState<FieldNotification[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  // "Send in a letter": the sighting rides along into a new letter
  const [attachPostId, setAttachPostId] = useState<string | null>(null);
  // Where Explore was opened from, so its back arrow can say so
  const [exploreFrom, setExploreFrom] = useState<AppView | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [isDetailActive, setIsDetailActive] = useState(false);

  const [isFirstTime, setIsFirstTime] = useState(false);
  const [skipTourOnce, setSkipTourOnce] = useState(false);
  // The first walk around the app: queued when someone steps in from the landing, shown on the feed
  // (after the first-look Lens, never on top of it or any other sheet)
  const [tourPending, setTourPending] = useState(false);
  // Weekly field letter: shown at the top of Activity, marked new once a week
  const thisWeek = weekKey();
  const [letterSeenWeek, setLetterSeenWeek] = useState<string>(() => { try { return localStorage.getItem('naturegram_letter_week') || ''; } catch { return ''; } });
  const [myWeek, setMyWeek] = useState<{ sightings: number; species: string[]; newPlates: PlateData[]; hours: number[] } | null>(null);
  const [letterToast, setLetterToast] = useState('');
  useEffect(() => {
    if (!isNotificationsOpen) return;
    setLetterSeenWeek(thisWeek);
    try { localStorage.setItem('naturegram_letter_week', thisWeek); } catch { /* storage blocked */ }
    if (userMode?.isAnonymous || !userMode?.userId) return;
    // The Sunday letter: this week's sightings, and the species new to the explorer's list as plates
    const since = Date.now() - 7 * 864e5;
    getDocs(query(collection(db, 'ecosystem_feed'), where('userId', '==', userMode.userId), orderBy('timestamp', 'desc'), limit(200)))
      .then(snap => {
        const posts = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        const recent = posts.filter(p => toMs(p.timestamp) >= since);
        const list = buildLifeList(posts);
        const fresh = list.filter(e => e.firstMs >= since);
        const species = Array.from(new Set(recent.map(p => String(p.labels?.[0] || '').trim()).filter(l => l && !/^(unknown|nature|unidentified|captured|uploaded)/i.test(l))));
        setMyWeek({
          sightings: recent.length, species,
          newPlates: fresh.slice(-6).reverse().map(e => ({ name: e.name, scientific: e.scientific, thumb: e.thumb, no: e.no, firstMs: e.firstMs, place: e.place, season: e.season, group: e.group })),
          hours: recent.map(p => new Date(toMs(p.timestamp)).getHours()),
        });
      })
      .catch(() => FirebaseService.getMyWeek().then(w => setMyWeek({ ...w, newPlates: [], hours: [] })).catch(() => setMyWeek({ sightings: 0, species: [], newPlates: [], hours: [] })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNotificationsOpen]);

  const shareLetter = async () => {
    const w = myWeek;
    const text = w && w.sightings
      ? `My week outside: ${w.sightings} sighting${w.sightings === 1 ? '' : 's'}${w.newPlates.length ? `, ${w.newPlates.length} new to my list` : ''}. From my field page on NatureGram.`
      : 'My field page on NatureGram.';
    const url = `${PUBLIC_ORIGIN}/profile/${encodeURIComponent(userMode?.userId || '')}`;
    track('share', { surface: 'sunday_letter' });
    if (w?.newPlates.length) {
      const { sharePlate } = await import('./services/plateImage.ts');
      const r = await sharePlate({ ...w.newPlates[0], line: 'New to my list this week' }, { text, url });
      // glossary-ok: the plate image of a new life-list species
      if (r === 'downloaded') { setLetterToast('Plate saved. Share it wherever you like.'); window.setTimeout(() => setLetterToast(''), 2600); }
      return;
    }
    try {
      if (navigator.share) await navigator.share({ title: 'My week outside', text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); setLetterToast('Link copied'); window.setTimeout(() => setLetterToast(''), 2000); }
    } catch { /* cancelled */ }
  };
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [activeDraftsCount, setActiveDraftsCount] = useState(0);

  // The naturalist of the fortnight: their page, and the one-time handover card after a rotation
  const [naturalistOpen, setNaturalistOpen] = useState(false);
  const [authActionUrl, setAuthActionUrl] = useState<string | null>(AUTH_ACTION_URL);
  const handoverFrom: string | null = null; // The handover card is retired: the landing greets each new naturalist
  const openNaturalist = useCallback(() => { track('naturalist_page_open', {}); setNaturalistOpen(true); }, []);

  // "What makes you stop and look?" is offered once the explorer has three sightings, not at sign-up
  const [personaOffer, setPersonaOffer] = useState(false);
  const maybeOfferPersona = useCallback(async (uid?: string | null) => {
    if (!uid || uid === 'explorer_guest') return;
    try { if (localStorage.getItem(PERSONA_OFFER_KEY)) return; } catch { return; }
    try {
      const profile = await FirebaseService.getUserProfile(uid);
      const p = profile?.naturalistPersona;
      if (p && (p.taxaInterests?.length || p.habitatAffinities?.length || p.customFocus)) {
        try { localStorage.setItem(PERSONA_OFFER_KEY, 'has'); } catch { /* storage blocked */ }
        return;
      }
      const snap = await getDocs(query(collection(db, 'ecosystem_feed'), where('userId', '==', uid), orderBy('timestamp', 'desc'), limit(3)));
      if (snap.size >= 3) setPersonaOffer(true);
    } catch { /* not now */ }
  }, []);
  const closePersonaOffer = (outcome: 'later' | 'done') => {
    try { localStorage.setItem(PERSONA_OFFER_KEY, outcome); } catch { /* storage blocked */ }
    setPersonaOffer(false);
  };

  /** Ask for an account, then continue what the explorer was doing. */
  const requireAccount = useCallback((reason: string, then?: () => void) => {
    track('account_prompt', { reason: reason.slice(0, 60) });
    pendingAuthActionRef.current = then || null;
    setAuthModal({ signUp: true, reason });
  }, []);

  const refreshDraftsCount = useCallback(async () => {
    if (userMode?.userId) {
      try {
        const d = await FirebaseService.getDrafts(userMode.userId);
        setActiveDraftsCount(d.length);
      } catch (e) {
        console.warn("Failed to refresh drafts count:", e);
      }
    } else {
      setActiveDraftsCount(0);
    }
  }, [userMode?.userId]);

  useEffect(() => { refreshDraftsCount(); }, [userMode?.userId, refreshDraftsCount]);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [limitNotice, setLimitNotice] = useState('');
  const [selectedMode, setSelectedMode] = useState<'observation' | 'conversation'>('observation');

  const geminiServiceRef = useRef<GeminiLiveService | null>(null);
  const pendingSnapshotIdRef = useRef<string | null>(null);

  const updateSnapshot = useCallback((id: string, updates: Partial<Snapshot>) => {
    setCurrentSessionSnapshots(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    setSnapshots(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  useEffect(() => {
    FirebaseService.getGeminiConfig().then(setConfig);
    try { if (!localStorage.getItem('naturegram_has_seen_tour')) setIsFirstTime(true); } catch { /* storage blocked */ }

    const unsubscribeAuth = FirebaseService.subscribeToAuthChanges((user) => {
      identify(user && !user.isAnonymous ? user.uid : null);
      if (user) {
        setUserMode({
          type: 'community',
          userId: user.uid,
          isAnonymous: user.isAnonymous,
          email: user.email,
          displayName: user.displayName
        });
        FirebaseService.getDrafts(user.uid).then(d => setActiveDraftsCount(d.length)).catch(() => {});
        if (currentViewRef.current === AppView.LANDING && !user.isAnonymous) {
          setCurrentView(AppView.REELS);
        }
        // A member opening a shared link sees the post in the app, not the visitors' welcome
        if (SHARED_ARRIVAL && !user.isAnonymous && currentViewRef.current === AppView.SHARED_POST) {
          setSelectedPostId(SHARED_ARRIVAL);
          setIsDetailActive(true);
          setCurrentView(AppView.COMMUNITY);
        }
        // Continue the action that required an account (like, comment, publish…)
        if (!user.isAnonymous) maybeOfferPersona(user.uid);
        if (!user.isAnonymous && pendingAuthActionRef.current) {
          const action = pendingAuthActionRef.current;
          pendingAuthActionRef.current = null;
          setTimeout(action, 0);
        }
      } else {
        setUserMode(currentViewRef.current !== AppView.LANDING ? { type: 'anonymous', userId: 'explorer_guest', isAnonymous: true } : null);
        setActiveDraftsCount(0);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (userMode?.userId && userMode.userId !== 'explorer_guest' && !userMode.isAnonymous) {
      registerToken().catch(() => {});
      const seen = new Set<string>();
      let first = true;
      const unsubscribe = FirebaseService.subscribeToNotifications(userMode.userId, (list) => {
        setNotifications(list);
        // System notification for genuinely new activity while the tab is in the background
        list.forEach(n => {
          if (!first && !seen.has(n.id) && !n.isRead) {
            showLocalNotification('NatureGram', n.message || 'New activity', n.postId ? `/feed?p=${n.postId}` : '/feed');
          }
          seen.add(n.id);
        });
        first = false;
      });
      return () => unsubscribe();
    }
    setNotifications([]);
  }, [userMode?.userId, userMode?.isAnonymous]);

  useEffect(() => {
    if (!userMode?.userId || userMode.isAnonymous || userMode.userId === 'explorer_guest') { setUnreadMessages(0); return; }
    const me = userMode.userId;
    const toMs = (t: any) => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0);
    return FirebaseService.subscribeToInbox(convos => {
      setUnreadMessages(convos.filter(c => c.lastMessage && c.lastMessage.senderId !== me && toMs(c.lastMessage.at) > toMs(c.lastReadAt?.[me])).length);
    });
  }, [userMode?.userId, userMode?.isAnonymous]);

  useEffect(() => {
    (async () => {
      let theme = await ThemeService.getDailyTheme();
      if (!theme) theme = await ThemeService.generateAndSaveDailyTheme();
      if (theme) {
        setDailyTheme(theme);
        ThemeService.applyThemeToDOM(theme);
      }
    })();
  }, []);

  // Deep links (?post=ID) are handled once on load and on history navigation (no polling)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const postId = params.get('post') || SHARED_ARRIVAL;
    if (postId) {
      setSelectedPostId(postId);
      setCurrentView(AppView.SHARED_POST);
      return;
    }
    // In-app post links: /post/POST_ID (shared) or /feed?p=POST_ID (notifications)
    const inApp = getInitialPostId();
    if (inApp) {
      setSelectedPostId(inApp);
      setIsDetailActive(true);
    }
  }, []);

  // Protect unsaved captures from accidental tab close/refresh
  useEffect(() => {
    if (currentSessionSnapshots.length === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [currentSessionSnapshots.length]);

  const handleCapture = (snap: Snapshot) => {
    setSnapshots(prev => [...prev, snap]);
    setCurrentSessionSnapshots(prev => [...prev, snap]);
  };

  const handleEndSession = (summary: string) => {
    track('lens_session_end', { captures: currentSessionRef.current.length });
    setSessionSummary(summary);
    setIsFinalizing(false);
    setCurrentView(AppView.POST_SESSION);
  };

  const clearSession = () => {
    setCurrentSessionSnapshots([]);
    setSnapshots([]);
    setSessionSummary("");
  };

  const handleSaveDraft = async () => {
    if (userMode?.isAnonymous) {
      requireAccount('Create a free account to keep drafts of your sightings.', () => handleSaveDraftRef.current?.());
      return;
    }
    const activeUserId = userMode?.userId;
    if (activeUserId && currentSessionRef.current.length > 0) {
      try {
        await FirebaseService.saveDraft(activeUserId, currentSessionRef.current, sessionSummary || "Unfinished sighting.");
        if (resumedDraftId) {
          await FirebaseService.deleteDraft(activeUserId, resumedDraftId).catch(() => {});
          setResumedDraftId(null);
        }
      } catch (e) {
        // Never throw captures away: stay in review, keep everything, and say what happened
        console.error("Failed to save draft:", e);
        setLimitNotice(navigator.onLine === false
          ? "You're offline, so the draft couldn't be saved. Your captures are still here; try again when you're back online."
          : "The draft couldn't be saved. Your captures are still here; please try again.");
        setCurrentView(AppView.POST_SESSION);
        return false;
      }
      clearSession();
      refreshDraftsCount();
      setCurrentView(AppView.JOURNAL);
      setLimitNotice('Saved. Your draft is under Unfinished in your Journal.');
      window.setTimeout(() => setLimitNotice(n => n.startsWith('Saved. Your draft') ? '' : n), 5000);
      return true;
    }
    return false;
  };
  const handleSaveDraftRef = useRef(handleSaveDraft);
  handleSaveDraftRef.current = handleSaveDraft;

  /** Drafts reopen in review where they were saved; the draft is only removed once published or re-saved. */
  const handleResumeDraft = async (draft: ExpeditionDraft) => {
    setCurrentSessionSnapshots(draft.snapshots);
    setSnapshots(draft.snapshots);
    setSessionSummary(draft.summary);
    setResumedDraftId(draft.id);
    setCurrentView(AppView.POST_SESSION);
  };

  const handlePublished = async () => {
    if (!userMode?.isAnonymous) maybeOfferPersona(userMode?.userId);
    if (resumedDraftId && userMode?.userId) {
      await FirebaseService.deleteDraft(userMode.userId, resumedDraftId).catch(() => {});
      setResumedDraftId(null);
      refreshDraftsCount();
    }
  };

  const initAudioContext = async () => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      const ctx = new AudioContextClass({ sampleRate: 24000 });
      audioContextRef.current = ctx;
      setAudioContext(ctx);
    }
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
    return audioContextRef.current;
  };

  const openLens = async () => {
    setSkipTourOnce(false); // the tour skipped on the first look shows on the next visit
    await initAudioContext();
    // No mode dialog: the Lens starts as the quiet companion unless the explorer turned on "Talk with me"
    let saved: string | null = null;
    try { saved = localStorage.getItem(MODE_PREF_KEY); } catch { /* storage blocked */ }
    let mode: 'observation' | 'conversation' = saved === 'conversation' ? 'conversation' : 'observation';
    if (!allowSession(mode)) {
      // Conversations used up for today: open the quiet Lens instead of nothing
      if (mode === 'conversation' && !RateLimitService.isSessionActive()) mode = 'observation';
      else return;
    }
    track('lens_open', { mode, remembered: !!saved });
    setSelectedMode(mode);
    setCurrentView(AppView.LENS);
  };

  /** Daily session allowance (client-side guard from main; the server enforces the real quota). */
  const allowSession = (mode: 'observation' | 'conversation') => {
    const uid = userMode?.userId || 'explorer_guest';
    if (RateLimitService.isSessionActive()) { setLimitNotice('A session is already open in another tab. Close it to start a new one.'); return false; }
    // The quiet Lens costs nothing to open (identifications are limited on the server), so opening and
    // closing it never uses anything up. A conversation is counted once the guide connects (in the Lens).
    if (mode === 'observation') return true;
    if (!RateLimitService.canStartConversation(uid)) { setLimitNotice("You've used today's conversations with the guide. They refresh tomorrow. The quiet Lens still works."); return false; }
    return true;
  };

  const handleNavigationRequest = async (targetView: AppView, params?: any) => {
    if (userMode?.isAnonymous) {
      if (targetView === AppView.MESSAGES) {
        requireAccount('Create a free account to write letters to other explorers.', () => handleNavigationRequest(targetView, params));
        return;
      }
      // Guests can look at their (empty) journal and profile first; we ask for an account when they save something
      if (targetView === AppView.DRAFTS) {
        requireAccount('Drafts are kept with your account. Create a free account to keep them.', () => handleNavigationRequest(targetView, params));
        return;
      }
    }

    hapticFeedback(10);
    setIsDetailActive(false);
    setSelectedPostId(null);

    if ((targetView === AppView.COMMUNITY || targetView === AppView.LANDING) && geminiServiceRef.current) {
      geminiServiceRef.current.disconnect();
      geminiServiceRef.current = null;
    }

    if (targetView === AppView.LENS) {
      await openLens();
      return;
    }

    if (targetView === AppView.USER_PROFILE) {
      setTargetProfileId(params?.userId && params.userId !== userMode?.userId ? params.userId : null);
      setCurrentView(AppView.USER_PROFILE);
      return;
    }

    if (targetView === AppView.EXPLORE && currentViewRef.current !== AppView.EXPLORE) setExploreFrom(currentViewRef.current);
    setCurrentView(targetView);
    setReturnView(null);
  };
  const sendAsLetter = (postId: string) => { setAttachPostId(postId); openMessages(); };

  /**
   * Back returns to the screen the explorer came from (the browser's own history, so the system
   * back gesture and this button agree). Opened straight from a link with nothing behind it,
   * Back goes home: Moments.
   */
  const goBack = () => {
    if ((window.history.state?.depth ?? 0) > 0) window.history.back();
    else handleNavigationRequest(AppView.REELS);
  };

  const handleSignOut = async () => {
    if (currentSessionRef.current.length > 0 && !window.confirm('You have unsaved captures. Sign out anyway?')) return;
    clearSession();
    await FirebaseService.logout();
    setUserMode(null);
    setCurrentView(AppView.LANDING);
  };

  const scrollFeedToTop = () => {
    const el = document.getElementById('main-scroll');
    el?.scrollTo({ top: 0, behavior: 'smooth' });
    window.dispatchEvent(new CustomEvent('ng:feed-top'));
  };

  const handleNotificationClick = async (alert: FieldNotification) => {
    if (userMode?.userId && !alert.isRead) FirebaseService.markNotificationRead(userMode.userId, alert.id).catch(() => {});
    setIsNotificationsOpen(false);
    if (alert.type === 'follow' && alert.senderId) {
      handleNavigationRequest(AppView.USER_PROFILE, { userId: alert.senderId });
      return;
    }
    if (currentView !== AppView.COMMUNITY) setReturnView(currentView);
    if (alert.postId) {
      setSelectedPostId(alert.postId);
      setIsDetailActive(true);
    }
    setCurrentView(AppView.COMMUNITY);
  };

  /** A grouped row marks every event in it as read, then opens what they share. */
  const handleNotificationGroupClick = (group: NoteGroup) => {
    if (userMode?.userId) group.members.filter(n => !n.isRead && n.id !== group.lead.id).forEach(n => FirebaseService.markNotificationRead(userMode.userId!, n.id).catch(() => {}));
    if (group.lead.type === 'message') {
      if (userMode?.userId && !group.lead.isRead) FirebaseService.markNotificationRead(userMode.userId, group.lead.id).catch(() => {});
      setIsNotificationsOpen(false);
      openMessages();
      return;
    }
    handleNotificationClick(group.lead);
  };

  const markAllRead = () => {
    if (!userMode?.userId) return;
    notifications.filter(n => !n.isRead).forEach(n => FirebaseService.markNotificationRead(userMode.userId!, n.id).catch(() => {}));
  };

  const handlePostClose = () => {
    setSelectedPostId(null);
    setIsDetailActive(false);
    if (returnView) {
      setCurrentView(returnView);
      setReturnView(null);
    }
  };

  const enterApp = async () => {
    track('landing_enter', { naturalist: dailyTheme?.id || '' });
    try { await initAudioContext(); } catch { /* audio is optional here */ }
    if (!FirebaseService.getCurrentUserId()) {
      try {
        await FirebaseService.loginAnonymous();
      } catch (e) {
        console.error("Guest sign-in failed, continuing in read-only mode:", e);
        setUserMode({ type: 'anonymous', userId: 'explorer_guest', isAnonymous: true });
      }
    }
    if (!hasSeenFirstRunTour()) setTourPending(true);
    // Explore the wild opens on Moments: living clips first, the feed one tap away, the tour shows the way,
    // and the Lens is one tap away in the middle of the nav.
    try { localStorage.setItem(FIRST_LOOK_KEY, '1'); } catch { /* storage blocked */ }
    setCurrentView(AppView.REELS);
  };


  const isDashboardMode = currentView === AppView.COMMUNITY || currentView === AppView.JOURNAL || currentView === AppView.DRAFTS;
  const showNav = (isDashboardMode || currentView === AppView.USER_PROFILE || currentView === AppView.REELS || currentView === AppView.EXPLORE) && !isDetailActive;
  const darkNav = currentView === AppView.REELS;
  const openActivity = () => setIsNotificationsOpen(true);
  // Back gesture, Escape and × all close Activity; focus stays inside while it's open
  const activityRef = useRef<HTMLElement | null>(null);
  const { close: closeActivity } = useBackToClose(isNotificationsOpen, () => setIsNotificationsOpen(false));
  useFocusTrap(activityRef, isNotificationsOpen);
  // Consent and install prompts never stack: the install card waits until consent is decided
  const [consentDecided, setConsentDecided] = useState(() => getConsent() !== null);
  useEffect(() => onConsentChange(() => setConsentDecided(getConsent() !== null)), []);
  // A newer NatureGram is out: update by itself when nothing would be lost, else offer a Refresh
  const [updateReady, setUpdateReady] = useState(false);
  const safeToReloadRef = useRef<() => boolean>(() => false);
  safeToReloadRef.current = () => {
    const v = currentViewRef.current;
    if (v === AppView.LENS || v === AppView.POST_SESSION || v === AppView.ADMIN) return false;
    if (currentSessionRef.current.length > 0 || lensBusyRef.current) return false;
    if (overlayOpen() || authModal || showUploadModal) return false;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return false;
    return true;
  };
  useEffect(() => {
    if (justUpdated()) { setLimitNotice('NatureGram is up to date.'); window.setTimeout(() => setLimitNotice(n => n === 'NatureGram is up to date.' ? '' : n), 3000); }
    return startUpdateWatch({ isSafe: () => safeToReloadRef.current(), onReady: () => setUpdateReady(true) });
  }, []);
  // The first window anyone opens teaches, once, how every window closes
  useEffect(() => {
    const onFirst = () => {
      const tip = "Tap × or outside to close. Your phone's back works too.";
      window.setTimeout(() => setLimitNotice(n => n || tip), 600);
      window.setTimeout(() => setLimitNotice(n => n === tip ? '' : n), 6000);
    };
    window.addEventListener('ng:first-window', onFirst);
    return () => window.removeEventListener('ng:first-window', onFirst);
  }, []);
  // A quiet line when the connection drops, so failures make sense
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const openMessages = (cid?: string) => { setOpenConversationId(cid || null); handleNavigationRequest(AppView.MESSAGES); };
  const unreadCount = notifications.filter(n => !n.isRead).length;
  // The weekly line is a member's own week, so guests never get a dot for it
  const isMemberMode = !!userMode?.userId && userMode.userId !== 'explorer_guest' && !userMode.isAnonymous;
  const letterUnread = isMemberMode && letterSeenWeek !== thisWeek;
  const period = getThemePeriod();
  const extra = getNaturalistExtra(dailyTheme?.id);

  const navItems: { key: string; label: string; icon: GlyphName; active: boolean; onClick: () => void; badge?: number }[] = [
    { key: 'reels', label: 'Moments', icon: 'firefly', active: currentView === AppView.REELS, onClick: () => handleNavigationRequest(AppView.REELS) },
    { key: 'feed', label: 'Wild', icon: 'meadow', active: currentView === AppView.COMMUNITY || currentView === AppView.EXPLORE, onClick: () => currentView === AppView.COMMUNITY ? scrollFeedToTop() : handleNavigationRequest(AppView.COMMUNITY) },
    { key: 'capture', label: 'Lens', icon: 'eyeEar', active: false, onClick: () => handleNavigationRequest(AppView.LENS) },
    { key: 'journal', label: 'Journal', icon: 'rings', active: currentView === AppView.JOURNAL || currentView === AppView.DRAFTS, onClick: () => handleNavigationRequest(AppView.JOURNAL) },
    { key: 'profile', label: 'You', icon: 'seedling', active: currentView === AppView.USER_PROFILE && !targetProfileId, onClick: () => handleNavigationRequest(AppView.USER_PROFILE, { userId: userMode?.userId }) },
  ];

  return (
    <div className="fixed inset-0 bg-day-bg text-text-main font-body flex flex-col overflow-hidden h-[100dvh]">
      <a href="#main-content" className="sr-only-focusable absolute top-2 left-2 z-[300] bg-white px-4 py-2 rounded-lg shadow font-semibold">Skip to content</a>

      {isNotificationsOpen && (
        <div className="fixed inset-0 z-[100] flex justify-end animate-fade-in">
          <div className="absolute inset-0 ng-scrim" onClick={closeActivity} aria-hidden="true"></div>
          <section ref={activityRef} role="dialog" aria-modal="true" aria-labelledby="activity-title" className="relative w-full max-w-md bg-day-bg h-full shadow-[-24px_0_60px_-30px_rgba(28,25,23,0.45)] flex flex-col animate-slide-in-right safe-pt">
            <header className="px-6 pt-6 pb-5 flex items-start justify-between gap-4 shrink-0">
              <div>
                <h2 id="activity-title" className="ng-title">Activity</h2>
                <p className="ng-small mt-1">{unreadCount ? `${unreadCount} new` : 'You\'re all caught up'}</p>
              </div>
              <div className="flex items-center gap-1 -mr-2">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="ng-link-quiet min-h-[44px] px-2">Mark all read</button>
                )}
                <button onClick={closeActivity} aria-label="Close activity" className="ng-icon-button" autoFocus>
                  <Glyph name="close" size={24} />
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-10">
              <FirstHint id="activity" text="Marvels, field notes, new followers and letters about you land here." className="!mx-0 !mt-0 mb-4" />
              {/* Your week outside: one short line, the week's new plates and a way to share them */}
              <article aria-labelledby="field-letter-title" className="py-6 border-y border-stone-200/80">
                <p className="ng-kicker">This week</p>
                <h3 id="field-letter-title" className="ng-subtitle mt-3">Your week outside</h3>
                <p className="ng-body mt-2">
                  {userMode?.isAnonymous ? seasonNote()
                    : !myWeek ? 'Counting your week…'
                    : myWeek.sightings === 0 ? 'No sightings yet this week. One good look is enough.'
                    : `${myWeek.sightings} sighting${myWeek.sightings === 1 ? '' : 's'} this week${myWeek.species.length ? `, including ${myWeek.species.slice(0, 3).join(', ')}` : ''}.`}
                </p>
                {!!myWeek?.newPlates.length && (
                  <ul className="mt-4 flex gap-4 overflow-x-auto no-scrollbar pb-2 pt-1 -mx-1 px-1" role="list" aria-label="New to your list">
                    {myWeek.newPlates.map(pl => (
                      <li key={pl.name} className="w-[104px] shrink-0">
                        <SpecimenPlate size="sm" data={pl} />
                      </li>
                    ))}
                  </ul>
                )}
                {!userMode?.isAnonymous && !!myWeek?.sightings && (
                  <button onClick={shareLetter} className="mt-3 inline-flex items-center gap-2 min-h-[44px] ng-link-quiet">
                    <Glyph name="share" size={20} className="text-stone-500" />
                    {/* glossary-ok: the life-list plate itself */}
                    {myWeek?.newPlates.length ? 'Share your new plate' : 'Share your week'}
                  </button>
                )}
                {letterToast && <p role="status" className="ng-caption mt-1">{letterToast}</p>}
              </article>
              {notifications.length === 0 ? (
                <div className="ng-empty">
                  <Glyph name="leaf" size={40} strokeWidth={1.2} className="ng-empty-glyph" />
                  <p className="ng-empty-title">Quiet in the woods</p>
                </div>
              ) : (
                <ul role="list">
                  {groupNotifications(notifications).map(group => {
                    const alert = group.lead;
                    const { who, what } = groupLine(group);
                    const glyph = NOTE_GLYPH[alert.type];
                    return (
                      <li key={group.key} className="border-b border-stone-200/70 last:border-b-0">
                        <button onClick={() => handleNotificationGroupClick(group)} className="w-full py-4 text-left flex items-start gap-4 transition-colors hover:bg-stone-900/[0.02] -mx-2 px-2 rounded-lg">
                          <span className="w-6 h-6 mt-0.5 flex items-center justify-center shrink-0 text-stone-500" aria-hidden="true">
                            {glyph ? <Glyph name={glyph} size={20} /> : <WonderIcon className="text-[20px]" />}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[15px] leading-[1.5] text-stone-800"><span className="font-medium text-stone-900">{who}</span> {what}</span>
                            <span className="block ng-caption mt-1">{timeAgo(alert.timestamp)}</span>
                          </span>
                          {group.unread && <span className="ng-dot mt-2.5 shrink-0" aria-label="Unread"></span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}
      <main id="main-content" className={`flex-1 relative overflow-hidden flex flex-col ${showNav ? 'lg:pl-24 land:pl-20' : ''}`}>
        {currentView === AppView.LANDING && (
          <div className="landing absolute inset-0 z-[60] overflow-hidden bg-stone-950 text-white">
            {/* The photograph is the hero, in its own colours: no theme wash, only shade where words sit */}
            <div className="landing-photo absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('${dailyTheme.imageUrl}')` }} aria-hidden="true" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/35" aria-hidden="true" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent md:bg-gradient-to-tr md:from-black/65 md:via-black/10 md:to-transparent" aria-hidden="true" />

            <div className="relative h-full w-full flex flex-col safe-pt">
              <header className="flex items-center justify-between px-6 md:px-12 pt-6 md:pt-8">
                <span className="flex items-center gap-2.5">
                  <BrandMark size={26} />
                  <span className="font-display italic text-xl md:text-2xl tracking-tight">NatureGram</span>
                </span>
                {/* Who makes NatureGram: one quiet link, so the landing keeps its single invitation */}
                <a href="/about" className="text-sm text-white/85 hover:text-white underline decoration-white/30 hover:decoration-white underline-offset-[6px] min-h-[44px] inline-flex items-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/80">About us</a>
              </header>

              <main className="mt-auto px-6 md:px-12 pb-10 md:pb-16 safe-pb max-w-3xl landing-rise">
                <p className="flex items-center gap-3 text-sm text-white/80">
                  <span className="block w-8 h-px bg-theme-vivid" aria-hidden="true" />
                  Naturalist of the fortnight
                </p>
                <figure className="mt-4">
                  <blockquote className="font-display italic text-[28px] leading-[1.18] md:text-5xl md:leading-[1.12] text-white text-balance">
                    &ldquo;{dailyTheme.quote}&rdquo;
                  </blockquote>
                  <figcaption className="mt-4 text-base text-white/90">
                    {dailyTheme.naturalist}
                    {dailyTheme.locationName && <span className="text-white/60"> &middot; {dailyTheme.locationName}</span>}
                  </figcaption>
                </figure>

                {/* What NatureGram is, in one line, on every screen size */}
                <p className="mt-6 text-[15px] leading-[1.6] text-white/85 max-w-md">
                  A field notebook for the living world. Point your camera at anything alive, let your guide (an AI) help you name it, and keep what you find.
                </p>

                <div className="mt-6 md:mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
                  <button
                    type="button"
                    onClick={enterApp}
                    className="group inline-flex items-center gap-3 rounded-full bg-white text-stone-900 pl-6 pr-5 py-3.5 text-base font-semibold shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] transition-transform duration-200 hover:-translate-y-px active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                  >
                    Explore the wild
                    <Glyph name="forward" size={20} className="text-theme-deep transition-transform duration-200 group-hover:translate-x-0.5" />
                  </button>
                  {/* Returning members sign in here, without passing through guest mode */}
                  <button
                    type="button"
                    onClick={() => setAuthModal({ signUp: false })}
                    className="text-sm font-medium text-white hover:text-white underline decoration-white/50 hover:decoration-white underline-offset-[6px] min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/80 rounded"
                  >
                    Log in
                  </button>
                  <button
                    type="button"
                    onClick={openNaturalist}
                    className="text-sm text-white/85 hover:text-white underline decoration-white/30 hover:decoration-white underline-offset-[6px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/80 rounded"
                  >
                    Meet {dailyTheme.naturalist}
                  </button>
                </div>
                {dailyTheme.imageCredit?.author && (
                  <a
                    href={dailyTheme.imageCredit.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="md:hidden mt-6 block text-[10px] leading-snug text-white/50 [text-shadow:0_1px_2px_rgba(0,0,0,0.55)]"
                  >
                    Photo: {dailyTheme.imageCredit.author}, {dailyTheme.imageCredit.license}
                  </a>
                )}
              </main>
            </div>

            {/* CC BY / BY-SA ask for attribution: the photographer, quietly, in the bottom corner on larger
                screens (on phones it sits under the buttons, so nothing crowds the header) */}
            {dailyTheme.imageCredit?.author && (
              <a
                href={dailyTheme.imageCredit.source}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:block absolute right-5 bottom-4 max-w-[40vw] truncate text-right text-[10px] text-white/45 [text-shadow:0_1px_2px_rgba(0,0,0,0.55)] hover:text-white/80 transition-colors"
              >
                Photo: {dailyTheme.imageCredit.author}, {dailyTheme.imageCredit.license}
              </a>
            )}
          </div>
        )}

        {currentView === AppView.LENS && config && userMode && (
          <div className="flex-1 relative z-50">
            <ErrorBoundary label="lens" onReset={() => setCurrentView(AppView.COMMUNITY)}>
              <Suspense fallback={<ViewLoader dark />}>
                <LiveLens
                  onCapture={handleCapture}
                  onEndSession={handleEndSession}
                  onBusyChange={(busy) => { lensBusyRef.current = busy; }}
                  onExit={(note?: string) => {
                    setIsFinalizing(false);
                    if (currentSessionRef.current.length > 0) {
                      handleEndSession(sessionSummary || CLOSING_LINE);
                    } else {
                      if (note) { setLimitNotice(note); window.setTimeout(() => setLimitNotice(n => n === note ? '' : n), 6000); }
                      if (geminiServiceRef.current) { geminiServiceRef.current.disconnect(); geminiServiceRef.current = null; }
                      goBack();
                    }
                  }}
                  config={config}
                  userMode={userMode}
                  audioContext={audioContext}
                  isFirstTime={isFirstTime && !skipTourOnce}
                  isFinalizing={isFinalizing}
                  geminiServiceRef={geminiServiceRef}
                  updateSnapshot={updateSnapshot}
                  pendingSnapshotIdRef={pendingSnapshotIdRef}
                  selectedMode={selectedMode}
                  initialAudioMode={selectedMode === 'observation' ? 'silent' : 'voice'}
                  onImportFromRoll={() => { handleNavigationRequest(AppView.COMMUNITY); setShowUploadModal(true); }}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        <UploadModal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          userId={userMode?.userId || ''}
          onProcessUploads={(processed: Snapshot[], summary?: string) => {
            setShowUploadModal(false);
            setCurrentSessionSnapshots(processed);
            setSnapshots(processed);
            if (summary) setSessionSummary(summary);
            setCurrentView(AppView.POST_SESSION);
          }}
        />

        {limitNotice && (
          <div role="alert" className="fixed left-6 right-6 bottom-24 z-[210] mx-auto max-w-sm ng-toast rounded-2xl pl-5 pr-2 py-2 flex items-center gap-3 ng-rise">
            <Glyph name="clock" size={20} className="text-white/70 shrink-0" />
            <p className="flex-1 py-1.5">{limitNotice}</p>
            <button onClick={() => setLimitNotice('')} aria-label="Dismiss" className="ng-icon-button-dark"><Glyph name="close" size={20} /></button>
          </div>
        )}

        {currentView === AppView.SHARED_POST && selectedPostId && (
          <Suspense fallback={<ViewLoader />}>
            <SharedPostView postId={selectedPostId} userMode={userMode || undefined} onGoToApp={() => {
              setSelectedPostId(null);
              window.history.replaceState({}, document.title, '/feed');
              enterApp();
            }} onOpenLens={() => {
              setSelectedPostId(null);
              window.history.replaceState({}, document.title, '/feed');
              handleNavigationRequest(AppView.LENS);
            }} />
          </Suspense>
        )}

        {isDashboardMode && (
          <div id="main-scroll" className="flex-1 overflow-y-auto overscroll-contain no-scrollbar relative pb-28 lg:pb-8">
            <ErrorBoundary label="dashboard">
              {currentView === AppView.COMMUNITY && userMode && (
                <Community
                  currentUserMode={userMode}
                  selectedPostId={selectedPostId}
                  onPostClose={handlePostClose}
                  onPostOpen={(postId?: string) => { if (postId) setSelectedPostId(postId); setIsDetailActive(true); }}
                  backLabel={returnView === AppView.JOURNAL ? "Journal" : returnView === AppView.REELS ? "Moments" : returnView === AppView.MESSAGES ? "Letters" : returnView === AppView.EXPLORE ? "Explore" : "Wild"}
                  onViewProfile={(uid) => handleNavigationRequest(AppView.USER_PROFILE, { userId: uid })}
                  activeDraftsCount={activeDraftsCount}
                  onViewDrafts={() => setCurrentView(AppView.DRAFTS)}
                  onLogoClick={scrollFeedToTop}
                  onRequireAccount={requireAccount}
                  dailyTheme={dailyTheme}
                  onOpenNaturalist={openNaturalist}
                  onOpenActivity={openActivity}
                  onOpenMessages={() => openMessages()}
                  onSendAsLetter={sendAsLetter}
                  onOpenExplore={() => handleNavigationRequest(AppView.EXPLORE)}
                  unreadActivity={unreadCount + (letterUnread ? 1 : 0)}
                  unreadMessages={unreadMessages}
                />
              )}
              {currentView === AppView.JOURNAL && userMode && (
                <Journal
                  userId={userMode.userId!}
                  activeDraftsCount={activeDraftsCount}
                  onViewDrafts={() => setCurrentView(AppView.DRAFTS)}
                  onResumeDraft={handleResumeDraft}
                  onViewProfile={(uid) => handleNavigationRequest(AppView.USER_PROFILE, { userId: uid })}
                  onPostOpen={(postId?: string) => { if (postId) setSelectedPostId(postId); setIsDetailActive(true); }}
                  onPostClose={handlePostClose}
                  onLogoClick={scrollFeedToTop}
                  onOpenLens={() => handleNavigationRequest(AppView.LENS)}
                  onImportFromRoll={() => setShowUploadModal(true)}
                />
              )}
              {currentView === AppView.DRAFTS && userMode && (
                <Suspense fallback={<ViewLoader />}>
                  <DraftsTray userId={userMode.userId!} onResume={handleResumeDraft} onBack={() => { refreshDraftsCount(); goBack(); }} />
                </Suspense>
              )}
            </ErrorBoundary>
          </div>
        )}

        {currentView === AppView.USER_PROFILE && userMode && (
          <div className="flex-1 overflow-hidden flex flex-col pb-16">
            <ErrorBoundary label="profile">
              <Suspense fallback={<ViewLoader />}>
                <UserProfile
                  userId={targetProfileId || userMode.userId!}
                  currentUserId={userMode.userId}
                  isAnonymous={userMode.isAnonymous}
                  onBack={goBack}
                  onSignOut={handleSignOut}
                  onViewJournal={() => handleNavigationRequest(AppView.JOURNAL)}
                  onAdminConsole={() => setCurrentView(AppView.ADMIN)}
                  onOpenPost={(postId: string) => { setReturnView(AppView.USER_PROFILE); setSelectedPostId(postId); setIsDetailActive(true); setCurrentView(AppView.COMMUNITY); }}
                  onViewProfile={(uid: string) => handleNavigationRequest(AppView.USER_PROFILE, { userId: uid })}
                  onRequireAccount={requireAccount}
                  onAbout={() => { window.location.assign(window.location.hostname === 'localhost' && window.location.protocol !== 'http:' ? `${PUBLIC_ORIGIN}/about` : '/about'); }}
                  onLogIn={() => setAuthModal({ signUp: false })}
                  onRetakeTour={() => { resetFirstRunTour(); setTourPending(true); handleNavigationRequest(AppView.COMMUNITY); }}
                  onMessage={async (uid: string) => {
                    if (userMode?.isAnonymous) { requireAccount('Create a free account to write letters to explorers.'); return; }
                    // Errors go back to the profile, which says what went wrong.
                    const cid = await FirebaseService.openConversation(uid);
                    openMessages(cid);
                  }}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {currentView === AppView.MESSAGES && userMode && (
          <div className="flex-1 flex flex-col min-h-0">
            <ErrorBoundary label="messages">
              <Suspense fallback={<ViewLoader />}>
                <Messages
                  initialConversationId={openConversationId}
                  attachPostId={attachPostId}
                  onAttachUsed={() => setAttachPostId(null)}
                  onBack={() => { setOpenConversationId(null); goBack(); }}
                  onViewProfile={(uid) => handleNavigationRequest(AppView.USER_PROFILE, { userId: uid })}
                  onOpenPost={(postId) => { setReturnView(AppView.MESSAGES); setSelectedPostId(postId); setIsDetailActive(true); setCurrentView(AppView.COMMUNITY); }}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {currentView === AppView.REELS && userMode && (
          <ErrorBoundary label="reels">
            <Suspense fallback={<ViewLoader dark />}>
              <Reels
                currentUserMode={userMode}
                onBack={() => handleNavigationRequest(AppView.COMMUNITY)}
                onOpenExplore={() => handleNavigationRequest(AppView.EXPLORE)}
                onOpenActivity={openActivity}
                onOpenMessages={() => openMessages()}
                unreadMessages={unreadMessages}
                onSendAsLetter={sendAsLetter}
                unreadActivity={unreadCount + (letterUnread ? 1 : 0)}
                onOpenPost={(postId) => { setReturnView(AppView.REELS); setSelectedPostId(postId); setIsDetailActive(true); setCurrentView(AppView.COMMUNITY); }}
                onViewProfile={(uid) => handleNavigationRequest(AppView.USER_PROFILE, { userId: uid })}
                onRequireAccount={requireAccount}
              />
            </Suspense>
          </ErrorBoundary>
        )}

        {currentView === AppView.EXPLORE && userMode && (
          <ErrorBoundary label="explore">
            <Suspense fallback={<ViewLoader />}>
              <div id="main-scroll" className="flex-1 overflow-y-auto overscroll-contain no-scrollbar pb-28 lg:pb-8">
                <Explore
                  onBack={goBack}
                  backLabel={exploreFrom === AppView.REELS ? 'Moments' : exploreFrom === AppView.COMMUNITY ? 'Wild' : exploreFrom === AppView.JOURNAL ? 'Journal' : 'Back'}
                  onOpenNaturalist={openNaturalist}
                  onOpenPost={(postId: string) => { setReturnView(AppView.EXPLORE); setSelectedPostId(postId); setIsDetailActive(true); setCurrentView(AppView.COMMUNITY); }}
                  onOpenProfile={(uid: string) => handleNavigationRequest(AppView.USER_PROFILE, { userId: uid })}
                />
              </div>
            </Suspense>
          </ErrorBoundary>
        )}

        {currentView === AppView.ADMIN && (
          <Suspense fallback={<ViewLoader />}>
            <AdminConsole onBack={goBack} />
          </Suspense>
        )}

          {currentView === AppView.POST_SESSION && userMode && (
            <Suspense fallback={<ViewLoader />}>
              <ErrorBoundary label="review" onReset={() => setCurrentView(AppView.COMMUNITY)}>
                <PostSessionView
                  snapshots={currentSessionSnapshots}
                  summary={sessionSummary}
                  userMode={userMode}
                  onClose={() => { clearSession(); setResumedDraftId(null); setCurrentView(AppView.COMMUNITY); }}
                  onViewFeed={() => { clearSession(); setCurrentView(AppView.COMMUNITY); }}
                  onCaptureMore={() => { clearSession(); openLens(); }}
                  onPublished={handlePublished}
                  onSaveDraft={handleSaveDraft}
                  onRequireAccount={requireAccount}
                  onUpdateSnapshots={(snaps: Snapshot[]) => { setCurrentSessionSnapshots(snaps); setSnapshots(snaps); }}
                  geminiServiceRef={geminiServiceRef}
                  updateSnapshot={updateSnapshot}
                  pendingSnapshotIdRef={pendingSnapshotIdRef}
                />
              </ErrorBoundary>
            </Suspense>
          )}

        {authModal && (
          <AuthModal
            initialIsSignUp={authModal.signUp}
            reason={authModal.reason}
            onClose={() => {
              pendingAuthActionRef.current = null; setAuthModal(null);
              // Closing the window mid-save keeps everything where it was, and says so
              if (currentViewRef.current === AppView.POST_SESSION && currentSessionRef.current.length > 0) {
                setLimitNotice('Not saved yet. Your captures are still here; create an account whenever you are ready.');
                window.setTimeout(() => setLimitNotice(n => n.startsWith('Not saved yet.') ? '' : n), 6000);
              }
            }}
            onSuccess={(how) => {
              setAuthModal(null);
              if (currentViewRef.current === AppView.LANDING) setCurrentView(AppView.REELS);
              if (how === 'signup') { setLimitNotice("Welcome. We've emailed you a link to confirm your address; it keeps your account safe."); window.setTimeout(() => setLimitNotice(n => n.startsWith('Welcome. We') ? '' : n), 8000); }
            }}
          />
        )}

        {authActionUrl && (
          <Suspense fallback={<div className="fixed inset-0 z-[150] bg-[#f3eee4] flex"><ViewLoader /></div>}>
            <AuthAction
              url={authActionUrl}
              onDone={(to) => { setAuthActionUrl(null); setCurrentView(AppView.COMMUNITY); if (to === 'lens') handleNavigationRequest(AppView.LENS); }}
              onSignIn={() => { setAuthActionUrl(null); setCurrentView(AppView.COMMUNITY); setAuthModal({ signUp: false }); }}
            />
          </Suspense>
        )}

        {naturalistOpen && (
          <Suspense fallback={<div className="fixed inset-0 z-[120] bg-day-bg flex"><ViewLoader /></div>}>
            <NaturalistPage
              theme={dailyTheme}
              extra={extra}
              period={period}
              onClose={() => setNaturalistOpen(false)}
              onOpenPost={async (postId) => {
                setNaturalistOpen(false);
                if (currentView === AppView.LANDING) {
                  // From the landing, step in as a guest (as Explore Wild would) and open the answer in the feed
                  if (!FirebaseService.getCurrentUserId()) await FirebaseService.loginAnonymous().catch(() => setUserMode({ type: 'anonymous', userId: 'explorer_guest', isAnonymous: true }));
                } else if (currentView !== AppView.COMMUNITY) setReturnView(currentView);
                setSelectedPostId(postId); setIsDetailActive(true); setCurrentView(AppView.COMMUNITY);
              }}
              onOpenLens={currentView === AppView.LANDING ? undefined : () => { setNaturalistOpen(false); handleNavigationRequest(AppView.LENS); }}
            />
          </Suspense>
        )}


        {personaOffer && currentView === AppView.COMMUNITY && !isDetailActive && !handoverFrom && userMode?.userId && (
          <Suspense fallback={null}>
            <NaturalistPersonaModal
              userId={userMode.userId}
              isOpen={true}
              onClose={() => closePersonaOffer('later')}
              onSave={() => closePersonaOffer('done')}
            />
          </Suspense>
        )}
        {tourPending && (currentView === AppView.COMMUNITY || currentView === AppView.REELS) && !isDetailActive && !isNotificationsOpen && !naturalistOpen && !handoverFrom && !personaOffer && !authModal && !authActionUrl && !showUploadModal && (
          <FirstRunTour onClose={() => setTourPending(false)} />
        )}
      </main>

      {/* Prompts stay off the Lens, review and open windows, and never stack */}
      {currentView !== AppView.LANDING && currentView !== AppView.LENS && currentView !== AppView.POST_SESSION && currentView !== AppView.SHARED_POST && !isDetailActive && !(tourPending && (currentView === AppView.COMMUNITY || currentView === AppView.REELS)) && <ConsentBanner />}
      {currentView !== AppView.LANDING && currentView !== AppView.LENS && currentView !== AppView.POST_SESSION && !tourPending && consentDecided && <InstallCard />}
      {currentView !== AppView.LANDING && currentView !== AppView.LENS && currentView !== AppView.POST_SESSION && <TeenBanner />}
      {updateReady && currentView !== AppView.LENS && (
        <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:bottom-6 z-[96] ng-toast flex items-center gap-3 pl-4 pr-2 py-2 text-sm">
          <span>A newer NatureGram is ready.</span>
          <button onClick={() => { if (currentSessionRef.current.length > 0) { setLimitNotice('Save or share your captures first, then refresh.'); return; } reloadNow(); }} className="min-h-[40px] px-3 rounded-full bg-white text-stone-900 font-semibold">Refresh</button>
          <button onClick={() => setUpdateReady(false)} aria-label="Later" className="ng-icon-button-dark"><Glyph name="close" size={18} /></button>
        </div>
      )}
      {offline && currentView !== AppView.LANDING && (
        <p role="status" className="fixed top-[calc(env(safe-area-inset-top)+0.5rem)] left-1/2 -translate-x-1/2 z-[95] ng-toast text-sm px-4 py-2">You're offline. Sightings you've already seen still open; new ones will load when you're back.</p>
      )}

      {showNav && (
        <div className={`absolute bottom-0 left-0 right-0 z-[48] animate-fade-in pb-[env(safe-area-inset-bottom)] backdrop-blur-md border-t lg:top-0 lg:right-auto lg:w-24 lg:border-t-0 lg:border-r lg:pb-0 land:top-0 land:right-auto land:w-20 land:border-t-0 land:border-r land:pb-0 land:pl-[env(safe-area-inset-left)] ${darkNav ? 'bg-black/80 border-white/10' : 'bg-day-bg/95 border-stone-200/80'}`}>
          <nav aria-label="Main" className="h-16 flex justify-around items-center px-2 max-w-md mx-auto lg:h-full lg:flex-col lg:justify-center lg:gap-8 lg:max-w-none lg:px-0 land:h-full land:flex-col land:justify-center land:gap-1 land:max-w-none land:px-0">
            {navItems.map(item => item.key === 'capture' ? (
              <button key={item.key} data-tour={item.key} onClick={item.onClick} aria-label="Open the lens to look at something new" className={`lens-ring relative w-14 h-14 -mt-3 lg:mt-0 land:mt-0 land:w-12 land:h-12 rounded-full flex items-center justify-center active:scale-95 transition-[transform,background-color] duration-200 bg-theme-primary text-white hover:brightness-110 shadow-[0_8px_20px_-10px_rgb(var(--theme-primary-rgb)/0.7)]`}>
                <Glyph name="eyeEar" size={26} />
              </button>
            ) : (
              <button
                key={item.key}
                data-tour={item.key}
                onClick={item.onClick}
                aria-label={item.badge ? `${item.label}, ${item.badge} new` : item.label}
                aria-current={item.active ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 min-w-[56px] h-14 land:h-12 rounded-xl transition-colors duration-300 ${darkNav ? (item.active ? 'text-white' : 'text-white/65 hover:text-white') : (item.active ? 'text-stone-900' : 'text-stone-500 hover:text-stone-800')}`}
              >
                <Glyph name={item.icon} size={24} />
                <span className="text-[12px] leading-none font-medium">{item.label}</span>
                {item.active && <span className={`absolute bottom-0 w-4 h-[2px] rounded-full ${darkNav ? 'bg-white' : 'bg-theme-accent'}`} aria-hidden="true" />}
                {!!item.badge && (
                  <span className={`absolute top-2 right-3 w-2 h-2 rounded-full bg-theme-accent ring-2 ${darkNav ? 'ring-black' : 'ring-day-bg'}`} aria-hidden="true" />
                )}
              </button>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
};

// A parent's consent page (/guardian?t=…, from the letter) stands on its own, outside the app shell
const Root: React.FC = () => (window.location.pathname.startsWith('/guardian')
  ? <Suspense fallback={null}><GuardianConsent /></Suspense>
  : <App />);

export default Root;
