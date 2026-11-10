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
import { hapticFeedback, timeAgo } from './utils.ts';
import { ThemeService, DailyTheme } from './services/themeService.ts';
import { getDailyTheme as getFallbackTheme } from './constants/naturalists.ts';
import { getNaturalistExtra, getThemePeriod } from './constants/naturalistExtras.ts';
import ConsentBanner from './components/ConsentBanner.tsx';
import TeenBanner from './components/TeenBanner.tsx';
import { weekKey, seasonNote, WonderIcon } from './components/Wonder.tsx';
import { identify, track } from './services/analytics.ts';
import { registerToken, showLocalNotification } from './services/push.ts';
import Glyph, { GlyphName } from './components/Glyph.tsx';
import SpecimenPlate, { PlateData } from './components/SpecimenPlate.tsx';
import ChangingOfTheGuard, { pendingHandover } from './components/ChangingOfTheGuard.tsx';
import FirstRunTour, { hasSeenFirstRunTour, resetFirstRunTour } from './components/FirstRunTour.tsx';
import { buildLifeList, toMs } from './services/lifeList.ts';
import { db } from './firebaseConfig.ts';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';

// Heavy, rarely-first views are loaded on demand to keep first paint fast
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
    <PressingLeaf className={dark ? 'text-white/60' : 'text-theme-primary/50'} />
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

const getInitialView = () => {
  if (new URLSearchParams(window.location.search).has('post')) return AppView.SHARED_POST;
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
      window.history.pushState({ view: currentView }, '', newPath);
    }
  }, [currentView, targetProfileId]);

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('post')) {
        setSelectedPostId(params.get('post'));
        setCurrentView(AppView.SHARED_POST);
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
    const url = `${window.location.origin}/profile/${encodeURIComponent(userMode?.userId || '')}`;
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
  const [handoverFrom, setHandoverFrom] = useState<string | null>(() => pendingHandover(getFallbackTheme().id));
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
    const postId = params.get('post');
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
        console.error("Failed to save draft:", e);
      }
      clearSession();
      refreshDraftsCount();
      setCurrentView(AppView.COMMUNITY);
    }
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
    const mode: 'observation' | 'conversation' = saved === 'conversation' ? 'conversation' : 'observation';
    if (!allowSession(mode)) return;
    track('lens_open', { mode, remembered: !!saved });
    setSelectedMode(mode);
    setCurrentView(AppView.LENS);
  };

  /** Daily session allowance (client-side guard from main; the server enforces the real quota). */
  const allowSession = (mode: 'observation' | 'conversation') => {
    const uid = userMode?.userId || 'explorer_guest';
    if (RateLimitService.isSessionActive()) { setLimitNotice('A session is already open in another tab. Close it to start a new one.'); return false; }
    const ok = mode === 'observation' ? RateLimitService.canStartObservation(uid) : RateLimitService.canStartConversation(uid);
    if (!ok) { setLimitNotice(`You've used today's ${mode === 'observation' ? 'observation' : 'conversation'} sessions. They refresh tomorrow. You can still upload sightings.`); return false; }
    if (mode === 'observation') RateLimitService.incrementObservation(uid); else RateLimitService.incrementConversation(uid);
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

    setCurrentView(targetView);
    setReturnView(null);
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
    // Explore the wild always lands on the feed: explorers look around first, the tour shows them
    // the way, and the Lens is one tap away in the middle of the nav.
    try { localStorage.setItem(FIRST_LOOK_KEY, '1'); } catch { /* storage blocked */ }
    setCurrentView(AppView.COMMUNITY);
  };

  // Escape closes the activity panel
  useEffect(() => {
    if (!isNotificationsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsNotificationsOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isNotificationsOpen]);

  const isDashboardMode = currentView === AppView.COMMUNITY || currentView === AppView.JOURNAL || currentView === AppView.DRAFTS;
  const showNav = (isDashboardMode || currentView === AppView.USER_PROFILE || currentView === AppView.REELS || currentView === AppView.EXPLORE) && !isDetailActive;
  const darkNav = currentView === AppView.REELS;
  const openActivity = () => setIsNotificationsOpen(true);
  const openMessages = (cid?: string) => { setOpenConversationId(cid || null); handleNavigationRequest(AppView.MESSAGES); };
  const unreadCount = notifications.filter(n => !n.isRead).length;
  // The weekly line is a member's own week, so guests never get a dot for it
  const isMemberMode = !!userMode?.userId && userMode.userId !== 'explorer_guest' && !userMode.isAnonymous;
  const letterUnread = isMemberMode && letterSeenWeek !== thisWeek;
  const period = getThemePeriod();
  const extra = getNaturalistExtra(dailyTheme?.id);

  const navItems: { key: string; label: string; icon: GlyphName; active: boolean; onClick: () => void; badge?: number }[] = [
    { key: 'feed', label: 'Wild', icon: 'meadow', active: currentView === AppView.COMMUNITY, onClick: () => currentView === AppView.COMMUNITY ? scrollFeedToTop() : handleNavigationRequest(AppView.COMMUNITY) },
    { key: 'reels', label: 'Moments', icon: 'firefly', active: currentView === AppView.REELS, onClick: () => handleNavigationRequest(AppView.REELS) },
    { key: 'capture', label: 'Lens', icon: 'eyeEar', active: false, onClick: () => handleNavigationRequest(AppView.LENS) },
    { key: 'journal', label: 'Journal', icon: 'rings', active: currentView === AppView.JOURNAL, onClick: () => handleNavigationRequest(AppView.JOURNAL) },
    { key: 'profile', label: 'You', icon: 'seedling', active: currentView === AppView.USER_PROFILE && !targetProfileId, onClick: () => handleNavigationRequest(AppView.USER_PROFILE, { userId: userMode?.userId }) },
  ];

  return (
    <div className="fixed inset-0 bg-day-bg text-text-main font-body flex flex-col overflow-hidden h-[100dvh]">
      <a href="#main-content" className="sr-only-focusable absolute top-2 left-2 z-[300] bg-white px-4 py-2 rounded-lg shadow font-bold">Skip to content</a>

      {isNotificationsOpen && (
        <div className="fixed inset-0 z-[100] flex justify-end animate-fade-in">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsNotificationsOpen(false)} aria-hidden="true"></div>
          <section role="dialog" aria-modal="true" aria-labelledby="activity-title" className="relative w-full max-w-sm bg-white h-full shadow-2xl flex flex-col animate-slide-in-right safe-pt">
            <header className="p-6 pb-4 flex items-center justify-between border-b border-stone-100 shrink-0">
              <div>
                <h2 id="activity-title" className="text-2xl font-display font-semibold text-text-main">Activity</h2>
                <p className="text-sm text-stone-500">{unreadCount ? `${unreadCount} new` : 'You\'re all caught up'}</p>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-sm font-semibold text-theme-accent px-3 py-2 rounded-full hover:bg-stone-50">Mark all read</button>
                )}
                <button onClick={() => setIsNotificationsOpen(false)} aria-label="Close activity" className="w-11 h-11 rounded-full bg-stone-50 text-stone-700 flex items-center justify-center" autoFocus>
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 no-scrollbar">
              {/* Your week outside: one short line, the week's new plates and a way to share them */}
              <article aria-labelledby="field-letter-title" className="p-4 rounded-2xl bg-insight-bg border border-theme-accent/25">
                <h3 id="field-letter-title" className="font-display text-lg font-semibold text-theme-primary">Your week outside</h3>
                <p className="text-sm text-stone-700 mt-1 leading-relaxed">
                  {userMode?.isAnonymous ? seasonNote()
                    : !myWeek ? 'Counting your week…'
                    : myWeek.sightings === 0 ? 'No sightings yet this week. One good look is enough.'
                    : `${myWeek.sightings} sighting${myWeek.sightings === 1 ? '' : 's'} this week${myWeek.species.length ? `, including ${myWeek.species.slice(0, 3).join(', ')}` : ''}.`}
                </p>
                {!!myWeek?.newPlates.length && (
                  <ul className="mt-2 flex gap-3 overflow-x-auto no-scrollbar pb-2 pt-2 -mx-1 px-1" role="list" aria-label="New to your list">
                    {myWeek.newPlates.map(pl => (
                      <li key={pl.name} className="w-[104px] shrink-0">
                        <SpecimenPlate size="sm" data={pl} />
                      </li>
                    ))}
                  </ul>
                )}
                {!userMode?.isAnonymous && !!myWeek?.sightings && (
                  <button onClick={shareLetter} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-theme-accent px-3 py-2 -ml-3 rounded-full hover:bg-theme-accent/5">
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">ios_share</span>
                    {/* glossary-ok: the life-list plate itself */}
                    {myWeek?.newPlates.length ? 'Share your new plate' : 'Share your week'}
                  </button>
                )}
                {letterToast && <p role="status" className="text-xs text-stone-600 mt-1">{letterToast}</p>}
              </article>
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center px-8 text-stone-500">
                  <span className="material-symbols-outlined text-4xl mb-3 text-theme-accent/60" aria-hidden="true">nest_eco_leaf</span>
                  <p className="font-display text-lg text-stone-800">Quiet in the woods</p>
                </div>
              ) : groupNotifications(notifications).map(group => {
                const alert = group.lead;
                const { who, what } = groupLine(group);
                const glyph = NOTE_GLYPH[alert.type];
                return (
                  <button key={group.key} onClick={() => handleNotificationGroupClick(group)} className={`w-full p-4 rounded-2xl text-left flex items-start gap-3 transition-colors ${group.unread ? 'bg-theme-accent/5 hover:bg-theme-accent/10' : 'bg-white hover:bg-stone-50'}`}>
                    <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-stone-100 text-theme-accent" aria-hidden="true">
                      {glyph ? <Glyph name={glyph} size={22} /> : <WonderIcon active className="text-xl" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-main leading-snug"><span className="font-bold">{who}</span> {what}</p>
                      <p className="text-xs text-stone-500 mt-1">{timeAgo(alert.timestamp)}</p>
                    </div>
                    {group.unread && <span className="w-2.5 h-2.5 rounded-full bg-theme-accent mt-2 shrink-0" aria-label="Unread"></span>}
                  </button>
                );
              })}
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
                  <Glyph name="mark" size={22} className="text-white/95" />
                  <span className="font-display italic text-xl md:text-2xl tracking-tight">NatureGram</span>
                </span>
                <span className="hidden md:block text-sm text-white/75">A field notebook for the living world</span>
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

                <div className="mt-8 md:mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
                  <button
                    type="button"
                    onClick={enterApp}
                    className="group inline-flex items-center gap-3 rounded-full bg-white text-stone-900 pl-6 pr-5 py-3.5 text-base font-semibold shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] transition-transform duration-200 hover:-translate-y-px active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                  >
                    Explore the wild
                    <span className="material-symbols-outlined text-[20px] text-theme-deep transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true">arrow_forward</span>
                  </button>
                  <button
                    type="button"
                    onClick={openNaturalist}
                    className="text-sm text-white/85 hover:text-white underline decoration-white/30 hover:decoration-white underline-offset-[6px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/80 rounded"
                  >
                    Meet {dailyTheme.naturalist}
                  </button>
                </div>
              </main>
            </div>

            {/* CC BY / BY-SA ask for attribution: the photographer, quietly, in the corner */}
            {dailyTheme.imageCredit?.author && (
              <a
                href={dailyTheme.imageCredit.source}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute right-6 top-[calc(env(safe-area-inset-top)+1.9rem)] md:top-auto md:right-5 md:bottom-4 max-w-[52vw] md:max-w-[40vw] text-right leading-snug md:truncate text-[10px] md:text-[11px] text-white/70 md:text-white/50 [text-shadow:0_1px_2px_rgba(0,0,0,0.55)] hover:text-white/80 transition-colors"
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
                  onExit={() => {
                    if (currentSessionRef.current.length > 0) {
                      handleEndSession(sessionSummary || CLOSING_LINE);
                    } else {
                      handleNavigationRequest(AppView.COMMUNITY);
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
          <div role="alert" className="fixed left-4 right-4 bottom-24 z-[210] mx-auto max-w-sm bg-stone-900 text-white rounded-2xl p-4 shadow-2xl flex items-start gap-3 animate-slide-up">
            <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
            <p className="text-sm flex-1">{limitNotice}</p>
            <button onClick={() => setLimitNotice('')} aria-label="Dismiss" className="w-8 h-8 flex items-center justify-center"><span className="material-symbols-outlined text-lg" aria-hidden="true">close</span></button>
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
                  onLogoClick={() => handleNavigationRequest(AppView.LANDING)}
                  onRequireAccount={requireAccount}
                  dailyTheme={dailyTheme}
                  onOpenNaturalist={openNaturalist}
                  onOpenActivity={openActivity}
                  onOpenMessages={() => openMessages()}
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
                  <DraftsTray userId={userMode.userId!} onResume={handleResumeDraft} onBack={() => { refreshDraftsCount(); setCurrentView(AppView.COMMUNITY); }} />
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
                  onBack={() => handleNavigationRequest(AppView.COMMUNITY)}
                  onSignOut={handleSignOut}
                  onViewJournal={() => handleNavigationRequest(AppView.JOURNAL)}
                  onAdminConsole={() => setCurrentView(AppView.ADMIN)}
                  onOpenPost={(postId: string) => { setReturnView(AppView.USER_PROFILE); setSelectedPostId(postId); setIsDetailActive(true); setCurrentView(AppView.COMMUNITY); }}
                  onViewProfile={(uid: string) => handleNavigationRequest(AppView.USER_PROFILE, { userId: uid })}
                  onRequireAccount={requireAccount}
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
                  onBack={() => { setOpenConversationId(null); handleNavigationRequest(AppView.COMMUNITY); }}
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
                  onBack={() => handleNavigationRequest(AppView.COMMUNITY)}
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
            <AdminConsole onBack={() => setCurrentView(AppView.USER_PROFILE)} />
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
            onClose={() => { pendingAuthActionRef.current = null; setAuthModal(null); }}
            onSuccess={() => { setAuthModal(null); if (currentViewRef.current === AppView.LANDING) setCurrentView(AppView.COMMUNITY); }}
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

        {handoverFrom && !naturalistOpen && currentView !== AppView.LANDING && currentView !== AppView.LENS && currentView !== AppView.POST_SESSION && currentView !== AppView.SHARED_POST && (
          <ChangingOfTheGuard
            previousId={handoverFrom}
            current={dailyTheme}
            onOpenNaturalist={openNaturalist}
            onDone={() => setHandoverFrom(null)}
          />
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
        {tourPending && currentView === AppView.COMMUNITY && !isDetailActive && !isNotificationsOpen && !naturalistOpen && !handoverFrom && !personaOffer && !authModal && !authActionUrl && !showUploadModal && (
          <FirstRunTour onClose={() => setTourPending(false)} />
        )}
      </main>

      {currentView !== AppView.LANDING && currentView !== AppView.LENS && !(tourPending && currentView === AppView.COMMUNITY) && <ConsentBanner />}
      {currentView !== AppView.LANDING && currentView !== AppView.LENS && <TeenBanner />}

      {showNav && (
        <div className={`absolute bottom-0 left-0 right-0 z-[48] animate-fade-in pb-[env(safe-area-inset-bottom)] backdrop-blur border-t lg:top-0 lg:right-auto lg:w-24 lg:border-t-0 lg:border-r lg:pb-0 land:top-0 land:right-auto land:w-20 land:border-t-0 land:border-r land:pb-0 land:pl-[env(safe-area-inset-left)] ${darkNav ? 'bg-black/80 border-white/10' : 'bg-day-bg/95 border-theme-primary/10'}`}>
          <nav aria-label="Main" className="h-16 flex justify-around items-center px-2 max-w-md mx-auto lg:h-full lg:flex-col lg:justify-center lg:gap-6 lg:max-w-none lg:px-0 land:h-full land:flex-col land:justify-center land:gap-1 land:max-w-none land:px-0">
            {navItems.map(item => item.key === 'capture' ? (
              <button key={item.key} data-tour={item.key} onClick={item.onClick} aria-label="Open the lens to look at something new" className="lens-breath relative w-14 h-14 -mt-3 lg:mt-0 land:mt-0 land:w-12 land:h-12 rounded-full flex items-center justify-center shadow-lg shadow-theme-accent/30 bg-gradient-to-br from-theme-accent to-theme-primary text-white active:scale-95 transition-all">
                <Glyph name="eyeEar" size={28} strokeWidth={1.6} />
              </button>
            ) : (
              <button
                key={item.key}
                data-tour={item.key}
                onClick={item.onClick}
                aria-label={item.badge ? `${item.label}, ${item.badge} new` : item.label}
                aria-current={item.active ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 min-w-[56px] h-14 land:h-12 rounded-xl transition-colors duration-300 ${darkNav ? (item.active ? 'text-white' : 'text-white/65 hover:text-white') : (item.active ? 'text-theme-primary' : 'text-stone-500 hover:text-stone-800')}`}
              >
                <Glyph name={item.icon} size={25} strokeWidth={item.active ? 2 : 1.5} className={`transition-transform duration-300 ${item.active ? '-translate-y-px' : ''}`} />
                <span className={`text-[11px] leading-none ${item.active ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
                {item.active && <span className={`absolute bottom-0.5 w-1 h-1 rounded-full ${darkNav ? 'bg-white' : 'bg-theme-accent'}`} aria-hidden="true" />}
                {!!item.badge && (
                  <span className="absolute top-2 right-3 w-2.5 h-2.5 rounded-full bg-theme-accent ring-2 ring-white" aria-hidden="true" />
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
