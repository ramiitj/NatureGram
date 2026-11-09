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
import { weekKey, seasonNote } from './components/Wonder.tsx';
import { identify, track } from './services/analytics.ts';
import { registerToken, showLocalNotification } from './services/push.ts';

// Heavy, rarely-first views are loaded on demand to keep first paint fast
const LiveLens = lazy(() => import('./components/LiveLens.tsx'));
const AdminConsole = lazy(() => import('./components/AdminConsole.tsx'));
const PostSessionView = lazy(() => import('./components/PostSessionView.tsx'));
const UserProfile = lazy(() => import('./components/UserProfile.tsx'));
const DraftsTray = lazy(() => import('./components/DraftsTray.tsx'));
const Messages = lazy(() => import('./components/Messages.tsx'));
const Reels = lazy(() => import('./components/Reels.tsx'));
const SharedPostView = lazy(() => import('./components/SharedPostView.tsx'));

const ViewLoader: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <div className={`flex-1 flex items-center justify-center ${dark ? 'bg-black' : ''}`} role="status" aria-live="polite">
    <span className={`material-symbols-outlined text-4xl animate-spin ${dark ? 'text-white/60' : 'text-theme-primary/40'}`} aria-hidden="true">progress_activity</span>
    <span className="sr-only">Loading…</span>
  </div>
);

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
};

const pathId = (p: string, prefix: string) => (p.startsWith(prefix) ? decodeURIComponent(p.slice(prefix.length).split('/')[0] || '') || null : null);
const getInitialPostId = () => pathId(window.location.pathname, '/post/') || new URLSearchParams(window.location.search).get('p');
const getInitialProfileId = () => pathId(window.location.pathname, '/profile/') || new URLSearchParams(window.location.search).get('user');

const viewFromPath = (p: string): AppView => {
  if (p === '/' || p === '') return AppView.LANDING;
  if (p.startsWith('/post/')) return AppView.COMMUNITY;
  if (p.startsWith('/journal')) return AppView.JOURNAL;
  if (p.startsWith('/profile')) return AppView.USER_PROFILE;
  if (p.startsWith('/admin')) return AppView.ADMIN;
  if (p.startsWith('/drafts')) return AppView.DRAFTS;
  if (p.startsWith('/messages')) return AppView.MESSAGES;
  if (p.startsWith('/reels')) return AppView.REELS;
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
    if (here !== newPath && !onPostUrl) {
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
  // Weekly field letter: shown at the top of Activity, marked new once a week
  const thisWeek = weekKey();
  const [letterSeenWeek, setLetterSeenWeek] = useState<string>(() => { try { return localStorage.getItem('naturegram_letter_week') || ''; } catch { return ''; } });
  const [myWeek, setMyWeek] = useState<{ sightings: number; species: string[] } | null>(null);
  useEffect(() => {
    if (!isNotificationsOpen) return;
    setLetterSeenWeek(thisWeek);
    try { localStorage.setItem('naturegram_letter_week', thisWeek); } catch { /* storage blocked */ }
    if (!userMode?.isAnonymous) FirebaseService.getMyWeek().then(setMyWeek).catch(() => setMyWeek({ sightings: 0, species: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNotificationsOpen]);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [activeDraftsCount, setActiveDraftsCount] = useState(0);

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
    if (!localStorage.getItem('naturegram_has_seen_tour')) setIsFirstTime(true);

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
    // The very first time, Explore Wild opens the Lens with the guide talking: wonder first, setup later.
    // The mode choice and the tour wait for a later visit.
    let firstLook = false;
    try { firstLook = !localStorage.getItem(FIRST_LOOK_KEY); } catch { /* storage blocked */ }
    if (firstLook && allowSession('conversation')) {
      try { localStorage.setItem(FIRST_LOOK_KEY, '1'); } catch { /* storage blocked */ }
      track('lens_open', { mode: 'conversation', first_look: true });
      setSkipTourOnce(true);
      setSelectedMode('conversation');
      setCurrentView(AppView.LENS);
      return;
    }
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
  const showNav = (isDashboardMode || currentView === AppView.USER_PROFILE || currentView === AppView.REELS) && !isDetailActive;
  const darkNav = currentView === AppView.REELS;
  const openActivity = () => setIsNotificationsOpen(true);
  const openMessages = (cid?: string) => { setOpenConversationId(cid || null); handleNavigationRequest(AppView.MESSAGES); };
  const unreadCount = notifications.filter(n => !n.isRead).length;
  const letterUnread = letterSeenWeek !== thisWeek;
  const period = getThemePeriod();
  const extra = getNaturalistExtra(dailyTheme?.id);

  const navItems: { key: string; label: string; icon: string; active: boolean; onClick: () => void; badge?: number }[] = [
    { key: 'feed', label: 'Wild', icon: 'forest', active: currentView === AppView.COMMUNITY, onClick: () => currentView === AppView.COMMUNITY ? scrollFeedToTop() : handleNavigationRequest(AppView.COMMUNITY) },
    { key: 'reels', label: 'Moments', icon: 'wb_twilight', active: currentView === AppView.REELS, onClick: () => handleNavigationRequest(AppView.REELS) },
    { key: 'capture', label: 'Lens', icon: 'camera', active: false, onClick: () => handleNavigationRequest(AppView.LENS) },
    { key: 'journal', label: 'Journal', icon: 'fingerprint', active: currentView === AppView.JOURNAL, onClick: () => handleNavigationRequest(AppView.JOURNAL) },
    { key: 'profile', label: 'You', icon: 'person', active: currentView === AppView.USER_PROFILE && !targetProfileId, onClick: () => handleNavigationRequest(AppView.USER_PROFILE, { userId: userMode?.userId }) },
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
                <p className="text-xs text-stone-500">Week of {new Date(Date.now() - ((new Date().getDay() + 6) % 7) * 864e5).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}</p>
                <h3 id="field-letter-title" className="font-display text-xl font-semibold text-theme-primary mt-0.5">Your field letter</h3>
                <p className="text-[15px] font-display text-stone-800 mt-3 leading-relaxed">{seasonNote()}</p>
                <p className="text-sm text-stone-700 mt-3 leading-relaxed">
                  {userMode?.isAnonymous
                    ? null
                    : !myWeek ? 'Counting your week…'
                    : myWeek.sightings === 0 ? 'No sightings yet this week. One good look is enough.'
                    : `This week you recorded ${myWeek.sightings} sighting${myWeek.sightings === 1 ? '' : 's'}${myWeek.species.length ? `, including ${myWeek.species.slice(0, 3).join(', ')}` : ''}.`}
                </p>
              </article>
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center px-8 text-stone-500">
                  <span className="material-symbols-outlined text-4xl mb-3 text-theme-accent/60" aria-hidden="true">nest_eco_leaf</span>
                  <p className="font-display text-lg text-stone-800">Quiet in the woods</p>
                </div>
              ) : notifications.map(alert => (
                <button key={alert.id} onClick={() => handleNotificationClick(alert)} className={`w-full p-4 rounded-2xl text-left flex items-start gap-3 transition-colors ${alert.isRead ? 'bg-white hover:bg-stone-50' : 'bg-theme-accent/5 hover:bg-theme-accent/10'}`}>
                  <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-stone-100 text-theme-accent" aria-hidden="true">
                    <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>{alert.type === 'comment' || alert.type === 'reply' ? 'history_edu' : alert.type === 'follow' ? 'nature_people' : alert.type === 'mention' ? 'alternate_email' : alert.type === 'message' ? 'mail' : alert.type === 'identification' ? 'how_to_reg' : alert.type === 'sighting' ? 'park' : 'flare'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-main leading-snug"><span className="font-bold">{alert.senderName || 'NatureGram'}</span> {alert.message?.replace(alert.senderName || '', '').trim()}</p>
                    <p className="text-xs text-stone-500 mt-1">{timeAgo(alert.timestamp)}</p>
                  </div>
                  {!alert.isRead && <span className="w-2.5 h-2.5 rounded-full bg-theme-accent mt-2 shrink-0" aria-label="Unread"></span>}
                </button>
              ))}
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

            <div className="max-w-xl w-full flex flex-col items-center relative z-10 min-h-full justify-between py-12 safe-pt">
              <div className="text-center pb-[50px]">
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-gradient-to-tr from-theme-primary to-theme-primary-gradient flex items-center justify-center shadow-xl shadow-theme-shadow mx-auto mb-4 animate-float" aria-hidden="true">
                  <span className="material-symbols-outlined text-3xl md:text-4xl text-white">wb_sunny</span>
                </div>
                <h1 className="text-4xl md:text-6xl font-display font-black tracking-tighter text-white italic drop-shadow-lg">NatureGram</h1>
                <p className="text-white/90 font-bold uppercase tracking-[0.4em] text-[11px] mt-2 drop-shadow-md">The Living Field Guide</p>
              </div>

              <div className="w-full max-w-xs px-6">
                <button onClick={enterApp} className="w-full bg-white/10 backdrop-blur-xl p-8 rounded-[2.5rem] flex flex-col items-center gap-5 text-center transition-all hover:scale-[1.02] active:scale-95 shadow-2xl border border-white/20">
                  <span className="w-16 h-16 rounded-[1.5rem] bg-theme-primary text-white flex items-center justify-center shrink-0 shadow-lg shadow-theme-shadow" aria-hidden="true">
                    <span className="material-symbols-outlined text-3xl">explore</span>
                  </span>
                  <span>
                    <span className="block font-bold text-2xl leading-tight font-display italic text-white">Explore Wild</span>
                    <span className="block text-white/75 text-[11px] mt-2 tracking-[0.4em] uppercase font-bold">Begin Expedition</span>
                  </span>
                </button>
              </div>

              <figure className="text-center px-6 max-w-md mx-auto">
                <blockquote className="text-lg md:text-xl italic font-display text-white leading-relaxed drop-shadow-md pt-[50px]">"{dailyTheme.quote}"</blockquote>
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
                      handleEndSession(sessionSummary || 'Exploration concluded.');
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
                <h2 id="mode-title" className="text-2xl font-display font-semibold text-stone-900 mb-1">How should your guide behave?</h2>
                <p className="text-sm text-stone-500 mb-6">You can change this any time from the lens.</p>
                <div className="space-y-3">
                  {([
                    { mode: 'conversation', icon: 'forum', title: 'Talk with me', desc: 'Your guide chats with you in real time about what you see and answers your questions.' },
                    { mode: 'observation', icon: 'visibility', title: 'Quiet observer', desc: 'Your guide stays silent and only speaks up for notable moments or when you ask.' },
                  ] as const).map(opt => (
                    <button key={opt.mode} onClick={() => chooseMode(opt.mode)} className="w-full p-5 rounded-3xl border-2 border-stone-100 hover:border-theme-accent hover:bg-theme-accent/5 transition-all text-left group active:scale-95">
                      <span className="flex items-center gap-4 mb-1">
                        <span className="w-11 h-11 rounded-full bg-stone-100 text-theme-accent flex items-center justify-center group-hover:bg-theme-accent group-hover:text-white transition-colors" aria-hidden="true">
                          <span className="material-symbols-outlined">{opt.icon}</span>
                        </span>
                        <span className="font-bold text-lg text-stone-900">{opt.title}</span>
                      </span>
                      <span className="block text-sm text-stone-600 leading-relaxed">{opt.desc}</span>
                    </button>
                  ))}
                  <button onClick={() => { setShowModeSelection(false); setShowUploadModal(true); }} className="w-full p-5 rounded-3xl border-2 border-stone-100 hover:border-theme-accent hover:bg-theme-accent/5 transition-all text-left group active:scale-95">
                    <span className="flex items-center gap-4 mb-1">
                      <span className="w-11 h-11 rounded-full bg-stone-100 text-theme-accent flex items-center justify-center group-hover:bg-theme-accent group-hover:text-white transition-colors" aria-hidden="true">
                        <span className="material-symbols-outlined">upload_file</span>
                      </span>
                      <span className="font-bold text-lg text-stone-900">Upload from gallery</span>
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
                  backLabel={returnView === AppView.JOURNAL ? "Journal" : returnView === AppView.REELS ? "Moments" : returnView === AppView.MESSAGES ? "Letters" : "Wild"}
                  onViewProfile={(uid) => handleNavigationRequest(AppView.USER_PROFILE, { userId: uid })}
                  activeDraftsCount={activeDraftsCount}
                  onViewDrafts={() => setCurrentView(AppView.DRAFTS)}
                  onLogoClick={() => handleNavigationRequest(AppView.LANDING)}
                  onRequireAccount={requireAccount}
                  dailyTheme={dailyTheme}
                  onOpenActivity={openActivity}
                  onOpenMessages={() => openMessages()}
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
                  onMessage={async (uid: string) => {
                    if (userMode?.isAnonymous) { requireAccount('Create a free account to write letters to explorers.'); return; }
                    try { const cid = await FirebaseService.openConversation(uid); openMessages(cid); } catch { /* shown in profile */ }
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
      </main>

      {currentView !== AppView.LANDING && currentView !== AppView.LENS && <ConsentBanner />}

      {showNav && (
        <div className={`absolute bottom-0 left-0 right-0 z-[48] animate-fade-in pb-[env(safe-area-inset-bottom)] backdrop-blur border-t lg:top-0 lg:right-auto lg:w-24 lg:border-t-0 lg:border-r lg:pb-0 land:top-0 land:right-auto land:w-20 land:border-t-0 land:border-r land:pb-0 land:pl-[env(safe-area-inset-left)] ${darkNav ? 'bg-black/80 border-white/10' : 'bg-day-bg/95 border-theme-primary/10'}`}>
          <nav aria-label="Main" className="h-16 flex justify-around items-center px-2 max-w-md mx-auto lg:h-full lg:flex-col lg:justify-center lg:gap-6 lg:max-w-none lg:px-0 land:h-full land:flex-col land:justify-center land:gap-1 land:max-w-none land:px-0">
            {navItems.map(item => item.key === 'capture' ? (
              <button key={item.key} onClick={item.onClick} aria-label="Open the lens to look at something new" className="lens-breath relative w-14 h-14 -mt-3 lg:mt-0 land:mt-0 land:w-12 land:h-12 rounded-full flex items-center justify-center shadow-lg shadow-theme-accent/30 bg-gradient-to-br from-theme-accent to-theme-primary text-white active:scale-95 transition-all">
                <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">camera</span>
              </button>
            ) : (
              <button
                key={item.key}
                onClick={item.onClick}
                aria-label={item.badge ? `${item.label}, ${item.badge} new` : item.label}
                aria-current={item.active ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 min-w-[56px] h-14 land:h-12 rounded-xl transition-colors duration-300 ${darkNav ? (item.active ? 'text-white' : 'text-white/65 hover:text-white') : (item.active ? 'text-theme-primary' : 'text-stone-500 hover:text-stone-800')}`}
              >
                <span className={`material-symbols-outlined text-[25px] transition-transform duration-300 ${item.active ? '-translate-y-px' : ''}`} style={{ fontVariationSettings: item.active ? "'FILL' 1, 'wght' 400" : "'FILL' 0, 'wght' 300" }} aria-hidden="true">{item.icon}</span>
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

export default App;
