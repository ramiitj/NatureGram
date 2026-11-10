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
import { weekKey, seasonNote, fieldMoment, WonderIcon } from './components/Wonder.tsx';
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
  const [weekChallenge, setWeekChallenge] = useState<{ explorers: number; mine: boolean; capped: boolean } | null>(null);
  const [letterToast, setLetterToast] = useState('');
  useEffect(() => {
    if (!isNotificationsOpen) return;
    setLetterSeenWeek(thisWeek);
    try { localStorage.setItem('naturegram_letter_week', thisWeek); } catch { /* storage blocked */ }
    FirebaseService.getChallengeProgress(getNaturalistExtra(dailyTheme?.id).challengeTag).then(setWeekChallenge).catch(() => {});
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

  /** What to look for next week: the season ahead, and an hour of the day the explorer hasn't tried yet. */
  const nextWeekHint = () => {
    const hours = myWeek?.hours || [];
    const tried = (from: number, to: number) => hours.some(h => h >= from && h < to);
    const at = !tried(4, 7) ? new Date(2000, 0, 1, 5) : !tried(18, 20) ? new Date(2000, 0, 1, 19) : !tried(20, 24) ? new Date(2000, 0, 1, 22) : new Date(2000, 0, 1, 9);
    const m = fieldMoment(at);
    const ahead = seasonNote(new Date(Date.now() + 7 * 864e5));
    return { season: ahead !== seasonNote() ? ahead : '', moment: `Try going out at ${m.name.toLowerCase()} once: ${m.hint}.` };
  };

  const shareLetter = async () => {
    const w = myWeek;
    const text = w && w.sightings
      ? `My week outside: ${w.sightings} sighting${w.sightings === 1 ? '' : 's'}${w.newPlates.length ? `, ${w.newPlates.length} new to my list` : ''}. From my NatureGram field notebook.`
      : 'My field notebook on NatureGram.';
    const url = `${window.location.origin}/profile/${encodeURIComponent(userMode?.userId || '')}`;
    track('share', { surface: 'sunday_letter' });
    if (w?.newPlates.length) {
      const { sharePlate } = await import('./services/plateImage.ts');
      const r = await sharePlate({ ...w.newPlates[0], line: 'New to my list this week' }, { text, url });
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

  const [showModeSelection, setShowModeSelection] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [limitNotice, setLimitNotice] = useState('');
  const [rememberMode, setRememberMode] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'observation' | 'conversation'>('conversation');

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
      requireAccount('Create a free account to keep drafts of your expeditions.', () => handleSaveDraftRef.current?.());
      return;
    }
    const activeUserId = userMode?.userId;
    if (activeUserId && currentSessionRef.current.length > 0) {
      try {
        await FirebaseService.saveDraft(activeUserId, currentSessionRef.current, sessionSummary || "Unfinished expedition.");
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
    const saved = localStorage.getItem(MODE_PREF_KEY) as 'observation' | 'conversation' | null;
    if (saved) {
      if (!allowSession(saved)) return;
      track('lens_open', { mode: saved, remembered: true });
      setSelectedMode(saved);
      setCurrentView(AppView.LENS);
    } else {
      setShowModeSelection(true);
    }
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

  const chooseMode = (mode: 'observation' | 'conversation') => {
    if (!allowSession(mode)) { setShowModeSelection(false); return; }
    track('lens_open', { mode, remembered: rememberMode });
    setSelectedMode(mode);
    if (rememberMode) localStorage.setItem(MODE_PREF_KEY, mode);
    setShowModeSelection(false);
    setCurrentView(AppView.LENS);
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
  const letterUnread = letterSeenWeek !== thisWeek;
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
              <article aria-labelledby="field-letter-title" className="p-5 rounded-2xl bg-insight-bg border border-theme-accent/25">
                <p className="text-xs text-stone-500">Sunday letter · week of {new Date(Date.now() - ((new Date().getDay() + 6) % 7) * 864e5).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}</p>
                <h3 id="field-letter-title" className="font-display text-xl font-semibold text-theme-primary mt-0.5">Your week outside</h3>
                <p className="text-[15px] font-display text-stone-800 mt-3 leading-relaxed">{seasonNote()}</p>
                {!userMode?.isAnonymous && (
                  <p className="text-sm text-stone-700 mt-3 leading-relaxed">
                    {!myWeek ? 'Counting your week…'
                      : myWeek.sightings === 0 ? 'No sightings yet this week. One good look is enough.'
                      : `This week you recorded ${myWeek.sightings} sighting${myWeek.sightings === 1 ? '' : 's'}${myWeek.species.length ? `, including ${myWeek.species.slice(0, 3).join(', ')}` : ''}.`}
                  </p>
                )}
                {!!myWeek?.newPlates.length && (
                  <div className="mt-4">
                    <p className="text-sm text-stone-700">New to your list</p>
                    <ul className="mt-2 flex gap-3 overflow-x-auto no-scrollbar pb-2 pt-2 -mx-1 px-1" role="list">
                      {myWeek.newPlates.map(pl => (
                        <li key={pl.name} className="w-[104px] shrink-0">
                          <SpecimenPlate size="sm" data={pl} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-4 pt-4 border-t border-theme-accent/15 flex items-start gap-2.5">
                  <Glyph name="stamp" size={20} className="text-theme-accent mt-0.5" />
                  <button onClick={() => { setIsNotificationsOpen(false); openNaturalist(); }} className="text-left text-sm text-stone-700 leading-relaxed hover:text-stone-900">
                    {weekChallenge?.mine
                      ? <>You answered {dailyTheme.naturalist}'s challenge. {period.daysRemaining} day{period.daysRemaining === 1 ? '' : 's'} left for one more.</>
                      : <>{dailyTheme.naturalist}'s challenge: {extra.challenge} {weekChallenge?.explorers ? `${weekChallenge.capped ? '60+' : weekChallenge.explorers} explorers have answered; ` : ''}{period.daysRemaining} day{period.daysRemaining === 1 ? '' : 's'} left.</>}
                  </button>
                </div>
                <div className="mt-3 flex items-start gap-2.5">
                  <Glyph name="leafCompass" size={20} className="text-theme-accent mt-0.5" />
                  <p className="text-sm text-stone-700 leading-relaxed">Next week: {[nextWeekHint().season, nextWeekHint().moment].filter(Boolean).join(' ')}</p>
                </div>
                {!userMode?.isAnonymous && (
                  <button onClick={shareLetter} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-theme-accent px-3 py-2 -ml-3 rounded-full hover:bg-theme-accent/5">
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">ios_share</span>
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
          <div className="absolute inset-0 bg-stone-900 flex flex-col items-center justify-center p-6 z-[60] overflow-y-auto no-scrollbar">
            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('${dailyTheme.imageUrl}')`, opacity: 0.6 }} aria-hidden="true"></div>
            <div className="absolute inset-0 bg-gradient-to-t from-theme-primary-gradient to-theme-primary opacity-40 mix-blend-multiply" aria-hidden="true"></div>
            <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/40 to-transparent" aria-hidden="true"></div>

            <div className="max-w-xl w-full flex flex-col items-center relative z-10 min-h-full justify-between py-12 [@media(max-height:700px)]:py-6 safe-pt">
              <div className="text-center pb-[50px] [@media(max-height:700px)]:pb-6">
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-gradient-to-tr from-theme-primary to-theme-primary-gradient flex items-center justify-center shadow-xl shadow-theme-shadow mx-auto mb-4 animate-float" aria-hidden="true">
                  <span className="material-symbols-outlined text-3xl md:text-4xl text-white">wb_sunny</span>
                </div>
                <h1 className="text-4xl md:text-6xl font-display font-black tracking-tighter text-white italic drop-shadow-lg">NatureGram</h1>
                <p className="text-white/90 font-bold uppercase tracking-[0.4em] text-[11px] mt-2 drop-shadow-md">The Living Field Guide</p>
              </div>

              <div className="w-full flex justify-center py-4 [@media(max-height:700px)]:py-1">
                <button onClick={enterApp} aria-label="Explore the wild" className="wild-orb group flex flex-col items-center gap-4 rounded-full px-6 py-2 text-center">
                  <span className="relative block w-[104px] h-[104px] md:w-[120px] md:h-[120px]" aria-hidden="true">
                    <span className="orb-halo" />
                    <span className="orb-ring" />
                    <span className="orb-ring" />
                    <span className="orb-ring" />
                    <span className="orb-core w-full h-full rounded-full flex items-center justify-center text-white">
                      <Glyph name="leafCompass" size={44} strokeWidth={1.5} className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]" />
                    </span>
                  </span>
                  <span className="block">
                    <span className="block font-display italic font-semibold text-2xl md:text-[28px] leading-tight text-white drop-shadow-md">Explore the wild</span>
                    <span className="orb-hint block text-white/75 text-sm mt-1">Tap to begin</span>
                  </span>
                </button>
              </div>

              <figure
                className="text-center px-6 max-w-md mx-auto cursor-pointer rounded-2xl"
                role="button"
                tabIndex={0}
                aria-label={`"${dailyTheme.quote}" ${dailyTheme.naturalist}. Read about ${dailyTheme.naturalist}, the naturalist of the fortnight.`}
                onClick={openNaturalist}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNaturalist(); } }}
              >
                <blockquote className="text-lg md:text-xl italic font-display text-white leading-relaxed drop-shadow-md pt-[50px] [@media(max-height:700px)]:pt-6">"{dailyTheme.quote}"</blockquote>
                <figcaption className="mt-6 flex flex-col items-center gap-1">
                  <span className="text-white font-bold tracking-widest uppercase text-[11px]">{dailyTheme.naturalist}</span>
                  <span className="flex items-center gap-1 text-white/70 mt-1">
                    <span className="material-symbols-outlined text-[13px]" aria-hidden="true">location_on</span>
                    <span className="text-[11px] tracking-wider uppercase">{dailyTheme.locationName}</span>
                  </span>
                  {dailyTheme.locationCaption && <span className="text-white/60 text-[11px] italic mt-1">{dailyTheme.locationCaption}</span>}
                </figcaption>
              </figure>
            </div>
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
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {showModeSelection && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0 bg-stone-900/80 backdrop-blur-md" onClick={() => setShowModeSelection(false)} aria-hidden="true"></div>
            <section role="dialog" aria-modal="true" aria-labelledby="mode-title" className="relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-slide-up">
              <div className="p-7 text-center">
                <h2 id="mode-title" className="text-2xl font-display font-semibold text-stone-900 mb-1">Who would you like to walk with?</h2>
                <p className="text-sm text-stone-500 mb-6">You can change your mind any time from the Lens.</p>
                <div className="space-y-3">
                  {([
                    { mode: 'conversation', glyph: 'guide', title: 'Walk with a talkative guide', desc: 'Your guide talks with you about what you see as you go, and answers whatever you wonder aloud.' },
                    { mode: 'observation', glyph: 'binoculars', title: 'A quiet companion', desc: 'Your companion keeps quiet and speaks up only when it matters, or when you ask.' },
                  ] as const).map(opt => (
                    <button key={opt.mode} onClick={() => chooseMode(opt.mode)} className="w-full p-5 rounded-3xl border-2 border-stone-100 hover:border-theme-accent hover:bg-theme-accent/5 transition-all text-left group active:scale-95">
                      <span className="flex items-center gap-4 mb-1">
                        <span className="w-11 h-11 rounded-full bg-stone-100 text-theme-accent flex items-center justify-center group-hover:bg-theme-accent group-hover:text-white transition-colors" aria-hidden="true">
                          <Glyph name={opt.glyph} size={24} />
                        </span>
                        <span className="font-display font-semibold text-lg text-stone-900">{opt.title}</span>
                      </span>
                      <span className="block text-sm text-stone-600 leading-relaxed">{opt.desc}</span>
                    </button>
                  ))}
                  <button onClick={() => { setShowModeSelection(false); setShowUploadModal(true); }} className="w-full p-5 rounded-3xl border-2 border-stone-100 hover:border-theme-accent hover:bg-theme-accent/5 transition-all text-left group active:scale-95">
                    <span className="flex items-center gap-4 mb-1">
                      <span className="w-11 h-11 rounded-full bg-stone-100 text-theme-accent flex items-center justify-center group-hover:bg-theme-accent group-hover:text-white transition-colors" aria-hidden="true">
                        <Glyph name="plate" size={24} />
                      </span>
                      <span className="font-display font-semibold text-lg text-stone-900">Bring in from your camera roll</span>
                    </span>
                    <span className="block text-sm text-stone-600 leading-relaxed">Photos, or sound and video clips up to 30 seconds. No live camera needed.</span>
                  </button>
                </div>
                <label className="mt-5 flex items-center justify-center gap-2 text-sm text-stone-600 cursor-pointer">
                  <input type="checkbox" checked={rememberMode} onChange={e => setRememberMode(e.target.checked)} className="w-4 h-4" />
                  Remember my choice
                </label>
                <button onClick={() => setShowModeSelection(false)} className="mt-4 text-sm font-semibold text-stone-500 hover:text-stone-800 py-2 px-4">Cancel</button>
              </div>
            </section>
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
          <div id="main-scroll" className="flex-1 overflow-y-auto overscroll-contain no-scrollbar relative animate-fade-in pb-28 lg:pb-8">
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
        {tourPending && currentView === AppView.COMMUNITY && !isDetailActive && !isNotificationsOpen && !naturalistOpen && !handoverFrom && !personaOffer && !authModal && !authActionUrl && !showModeSelection && !showUploadModal && (
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
