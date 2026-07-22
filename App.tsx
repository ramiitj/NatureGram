
import React, { useState, useEffect, useRef } from 'react';
import LiveLens from './components/LiveLens.tsx';
import Journal from './components/Journal.tsx';
import Community from './components/Community.tsx';
import AdminConsole from './components/AdminConsole.tsx';
import PostSessionView from './components/PostSessionView.tsx';
import UserProfile from './components/UserProfile.tsx';
import DraftsTray from './components/DraftsTray.tsx';
import SharedPostView from './components/SharedPostView.tsx';
import AuthModal from './components/AuthModal.tsx';
import { Snapshot, AppView, GeminiConfig, UserMode, FieldNotification, ExpeditionDraft } from './types.ts';
import { FirebaseService, getCorsProxyUrl } from './services/firebaseService.ts';
import { GeminiLiveService } from './services/geminiLiveService.ts';
import { AnimatePresence } from 'motion/react';
import { hapticFeedback } from './utils.ts';
import { ThemeService, DailyTheme } from './services/themeService.ts';
import { getDailyTheme as getFallbackTheme } from './constants/naturalists.ts';

const getInitialView = () => {
  if (new URLSearchParams(window.location.search).has('post')) return AppView.SHARED_POST;
  const p = window.location.pathname;
  if (p === '/') return AppView.LANDING;
  if (p.startsWith('/feed')) return AppView.COMMUNITY;
  if (p.startsWith('/journal')) return AppView.JOURNAL;
  if (p.startsWith('/profile')) return AppView.USER_PROFILE;
  if (p.startsWith('/admin')) return AppView.ADMIN;
  if (p.startsWith('/drafts')) return AppView.DRAFTS;
  if (p.startsWith('/lens')) return AppView.LENS;
  return AppView.COMMUNITY; // fallback
};

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(getInitialView());
  const currentViewRef = useRef<AppView>(currentView);
  const [targetProfileId, setTargetProfileId] = useState<string | null>(new URLSearchParams(window.location.search).get('user') || null);
  
  useEffect(() => {
    currentViewRef.current = currentView;
    const pathMap: Record<AppView, string> = {
      [AppView.LANDING]: '/',
      [AppView.COMMUNITY]: '/feed',
      [AppView.JOURNAL]: '/journal',
      [AppView.USER_PROFILE]: '/profile',
      [AppView.ADMIN]: '/admin',
      [AppView.DRAFTS]: '/drafts',
      [AppView.LENS]: '/lens',
      [AppView.POST_SESSION]: '/post-session',
      [AppView.SHARED_POST]: '/shared-post'
    };
    
    if (currentView !== AppView.SHARED_POST) {
        let newPath = pathMap[currentView] || '/';
        if (currentView === AppView.USER_PROFILE && targetProfileId) {
            newPath += `?user=${targetProfileId}`;
        }
        if (window.location.pathname !== newPath && window.location.pathname + window.location.search !== newPath) {
             window.history.pushState({}, '', newPath);
        }
    }
  }, [currentView, targetProfileId]);

  useEffect(() => {
    const handlePopState = () => {
      const p = window.location.pathname;
      if (p === '/') setCurrentView(AppView.LANDING);
      else if (p.startsWith('/feed')) setCurrentView(AppView.COMMUNITY);
      else if (p.startsWith('/journal')) setCurrentView(AppView.JOURNAL);
      else if (p.startsWith('/profile')) {
          const userParams = new URLSearchParams(window.location.search);
          if (userParams.has('user')) setTargetProfileId(userParams.get('user'));
          setCurrentView(AppView.USER_PROFILE);
      }
      else if (p.startsWith('/admin')) setCurrentView(AppView.ADMIN);
      else if (p.startsWith('/drafts')) setCurrentView(AppView.DRAFTS);
      else if (p.startsWith('/lens')) setCurrentView(AppView.LENS);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [returnView, setReturnView] = useState<AppView | null>(null);
  const [isInitializingDeepLink, setIsInitializingDeepLink] = useState(
      new URLSearchParams(window.location.search).has('post')
  );
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [currentSessionSnapshots, setCurrentSessionSnapshots] = useState<Snapshot[]>([]);
  const [config, setConfig] = useState<GeminiConfig | null>(null);
  const [userMode, setUserMode] = useState<UserMode | null>({ type: 'anonymous', userId: 'explorer_guest', isAnonymous: true });
  const [sessionSummary, setSessionSummary] = useState("");
  const [dailyTheme, setDailyTheme] = useState<DailyTheme | any>(getFallbackTheme());
  
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [authType, setAuthType] = useState<'signin' | 'signup' | null>(null);
  const [showGlobalAuthModal, setShowGlobalAuthModal] = useState(false);
  const [notifications, setNotifications] = useState<FieldNotification[]>([]);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [isDetailActive, setIsDetailActive] = useState(false);
  
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [activeDraftsCount, setActiveDraftsCount] = useState(0);

  const refreshDraftsCount = React.useCallback(async () => {
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

  useEffect(() => {
    refreshDraftsCount();
  }, [userMode?.userId, refreshDraftsCount]);

  const [showModeSelection, setShowModeSelection] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'observation' | 'conversation'>('conversation');

  const geminiServiceRef = useRef<GeminiLiveService | null>(null);
  const pendingSnapshotIdRef = useRef<string | null>(null);

  const updateSnapshot = React.useCallback((id: string, updates: Partial<Snapshot>) => {
      setCurrentSessionSnapshots(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
      setSnapshots(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  useEffect(() => {
    FirebaseService.getGeminiConfig().then(setConfig);
    const checkFirstTime = async () => {
        const hasSeen = localStorage.getItem('naturegram_has_seen_tour');
        if (!hasSeen) setIsFirstTime(true);
    };
    checkFirstTime();

    const unsubscribeAuth = FirebaseService.subscribeToAuthChanges((user) => {
        if (user) {
            setUserMode({
                type: 'community',
                userId: user.uid,
                isAnonymous: user.isAnonymous,
                email: user.email,
                displayName: user.displayName
            });
            FirebaseService.getDrafts(user.uid).then(d => setActiveDraftsCount(d.length));
            
            // Background migration
            import('./firebaseConfig').then(({ auth }) => {
                if (auth.currentUser) {
                    FirebaseService.runThumbnailMigration().then(count => {
                        if (count && count > 0) {
                            console.log(`Migrated ${count} missing thumbnails in background.`);
                        }
                    }).catch(e => console.warn("Silent thumbnail migration failed:", e));
                }
            });

            // Auto-redirect from landing to community if already logged in (only on initial load)
            if (currentViewRef.current === AppView.LANDING && !user.isAnonymous) {
                setCurrentView(AppView.COMMUNITY);
            }
        } else {
            setUserMode(currentViewRef.current !== AppView.LANDING ? { type: 'anonymous', userId: 'explorer_guest', isAnonymous: true } : null);
            setActiveDraftsCount(0);
        }
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (userMode?.userId && userMode.userId !== 'explorer_guest') {
      setNotificationsError(null);
      const unsubscribe = FirebaseService.subscribeToNotifications(userMode.userId, (notifs) => {
        setNotifications(notifs);
        setNotificationsError(null);
      }, (err) => {
        setNotificationsError(err instanceof Error ? err.message : String(err));
      });
      return () => unsubscribe();
    } else {
      setNotifications([]);
      setNotificationsError(null);
    }
  }, [userMode?.userId]);

  useEffect(() => {
    const loadTheme = async () => {
      // Background full seed
      ThemeService.seedAllThemes().catch(console.error);
      FirebaseService.seedDefaultObservationsIfNeeded().catch(console.error);

      let theme = await ThemeService.getDailyTheme();
      if (!theme) {
        theme = await ThemeService.generateAndSaveDailyTheme();
      }
      if (theme) {
        setDailyTheme(theme);
        ThemeService.applyThemeToDOM(theme);
      }
    };
    loadTheme();
  }, []);

  // Robust Deep Link Handler: monitors the URL and displays SharedPostView immediately for deep links
  useEffect(() => {
    const checkDeepLink = () => {
      const params = new URLSearchParams(window.location.search);
      const postId = params.get('post');
      if (postId) {
        setSelectedPostId(postId);
        setCurrentView(AppView.SHARED_POST);
        setIsInitializingDeepLink(false);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    };

    // Run check immediately on mount/update
    checkDeepLink();

    // Register listeners for dynamic history/navigation events
    window.addEventListener('popstate', checkDeepLink);
    window.addEventListener('hashchange', checkDeepLink);

    // Periodically monitor the URL at brief intervals in case transitions or proxy redirects are silent
    const interval = setInterval(checkDeepLink, 300);

    return () => {
      window.removeEventListener('popstate', checkDeepLink);
      window.removeEventListener('hashchange', checkDeepLink);
      clearInterval(interval);
    };
  }, []);

  const handleCapture = (snap: Snapshot) => {
    setSnapshots(prev => [...prev, snap]);
    setCurrentSessionSnapshots(prev => [...prev, snap]);
  };

  const handleEndSession = (summary: string) => {
      setSessionSummary(summary);
      setIsFinalizing(false);
      setCurrentView(AppView.POST_SESSION);
  };

  const handleSaveDraft = async () => {
    let activeUserId = userMode?.userId;
    if (userMode?.isAnonymous) {
        setShowGlobalAuthModal(true);
        return;
    }

    if (activeUserId && currentSessionSnapshots.length > 0) {
        try {
            await FirebaseService.saveDraft(activeUserId, currentSessionSnapshots, sessionSummary || "Unfinished expedition.");
        } catch (e) {
            console.error("Failed to save draft:", e);
        }
        setCurrentSessionSnapshots([]);
        setSnapshots([]);
        setSessionSummary("");
        refreshDraftsCount();
        setCurrentView(AppView.COMMUNITY);
    }
  };

  const handleResumeDraft = async (draft: ExpeditionDraft) => {
      setCurrentSessionSnapshots(draft.snapshots);
      setSnapshots(draft.snapshots);
      setSessionSummary(draft.summary);
      if (userMode?.userId) {
          try {
              await FirebaseService.deleteDraft(userMode.userId, draft.id);
          } catch (e) {
              console.error("Failed to delete draft:", e);
          }
          refreshDraftsCount();
      }
      await initAudioContext();
      setCurrentView(AppView.LENS);
  };

  const handleNavigationRequest = async (targetView: AppView, params?: any) => {
      // Require authentication for certain routes
      if (userMode?.isAnonymous) {
          if (
              targetView === AppView.JOURNAL || 
              targetView === AppView.DRAFTS || 
              (targetView === AppView.USER_PROFILE && (!params || params.userId === userMode.userId))
          ) {
              setShowGlobalAuthModal(true);
              return;
          }
      }

      hapticFeedback(10);
      setIsDetailActive(false);
      setSelectedPostId(null);
      
      if (targetView === AppView.COMMUNITY || targetView === AppView.LANDING) {
          if (geminiServiceRef.current) {
              geminiServiceRef.current.disconnect();
              geminiServiceRef.current = null;
          }
      }

      if (targetView === AppView.LENS) {
          await initAudioContext();
          setShowModeSelection(true);
          return;
      }

      if (targetView === AppView.USER_PROFILE) {
          if (params?.userId && params.userId !== userMode?.userId) {
              setTargetProfileId(params.userId);
          } else {
              setTargetProfileId(null);
          }
          setCurrentView(AppView.USER_PROFILE);
      } else if (targetView === AppView.LANDING) {
          setUserMode({ type: 'anonymous', userId: 'explorer_guest', isAnonymous: true });
          FirebaseService.logout();
          setCurrentView(AppView.LANDING);
      } else {
          setCurrentView(targetView);
          setReturnView(null);
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

  const handleNotificationClick = async (alert: FieldNotification) => {
      if (userMode?.userId) await FirebaseService.markNotificationRead(userMode.userId, alert.id);
      setIsNotificationsOpen(false);
      if (currentView !== AppView.COMMUNITY) setReturnView(currentView);
      if (alert.postId) {
          setSelectedPostId(alert.postId);
          setCurrentView(AppView.COMMUNITY);
          setIsDetailActive(true);
      } else {
          setCurrentView(AppView.COMMUNITY);
      }
  };

  const handlePostClose = () => {
      setSelectedPostId(null);
      setIsDetailActive(false);
      if (returnView) {
          setCurrentView(returnView);
          setReturnView(null);
      }
  };

  const selectMode = async (mode: 'anonymous' | 'community') => {
    await initAudioContext();
    if (!FirebaseService.getCurrentUserId()) {
        try {
            await FirebaseService.loginAnonymous();
        } catch (e) {
            console.error("Anonymous login failed, using guest fallback:", e);
            setUserMode({ type: mode, userId: 'explorer_guest', isAnonymous: true });
        }
    }
    setCurrentView(AppView.COMMUNITY);
  };

  const isDashboardMode = currentView === AppView.COMMUNITY || currentView === AppView.JOURNAL || currentView === AppView.DRAFTS || currentView === AppView.USER_PROFILE;

  if (isInitializingDeepLink) {
      return (
          <div className="fixed inset-0 bg-[#0ea5e9] flex flex-col items-center justify-center p-6 text-white font-body">
              <h1 className="text-3xl font-display font-black italic tracking-tight mb-4">NatureGram</h1>
              <div className="flex gap-2">
                  <div className="w-2 h-2 bg-white rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-white rounded-full animate-bounce delay-100"></div>
                  <div className="w-2 h-2 bg-white rounded-full animate-bounce delay-200"></div>
              </div>
          </div>
      );
  }

  return (
    <div className="fixed inset-0 bg-day-bg text-text-main font-body flex overflow-hidden h-[100dvh]">

      {isNotificationsOpen && (
          <div className="fixed inset-0 z-[100] flex justify-end animate-fade-in">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsNotificationsOpen(false)}></div>
              <div className="relative w-full max-w-sm bg-white h-full shadow-2xl flex flex-col animate-slide-in-right">
                  <header className="p-8 pb-4 flex items-center justify-between border-b border-stone-100 shrink-0">
                      <div><h2 className="text-2xl font-display font-black italic text-text-main">Field Alerts</h2><p className="catalog-label text-[9px]">Platform Updates</p></div>
                      <button onClick={() => setIsNotificationsOpen(false)} aria-label="Close alerts panel" className="w-10 h-10 rounded-full bg-stone-50 text-theme-accent flex items-center justify-center"><span className="material-symbols-outlined">close</span></button>
                  </header>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar">
                      {notificationsError ? (
                          <div className="flex flex-col items-center justify-center h-40 text-center px-4 gap-2">
                              <span className="material-symbols-outlined text-4xl text-red-400">cloud_off</span>
                              <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Couldn't Load Alerts</p>
                              <button onClick={() => window.location.reload()} className="mt-2 text-[10px] font-black uppercase tracking-widest text-theme-accent">Retry</button>
                          </div>
                      ) : notifications.length === 0 ? <div className="flex flex-col items-center justify-center h-40 opacity-30"><span className="material-symbols-outlined text-4xl mb-2">notifications_off</span><p className="text-xs font-bold uppercase tracking-widest">No Alerts</p></div> : notifications.map(alert => (
                          <button key={alert.id} onClick={() => handleNotificationClick(alert)} className={`w-full p-5 rounded-2xl text-left border flex items-start gap-4 ${alert.isRead ? 'bg-white border-stone-50 opacity-60' : 'bg-stone-50/50 border-stone-100 shadow-sm'}`}>
                              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-stone-100 text-theme-accent"><span className="material-symbols-outlined text-sm">{alert.type === 'sighting' ? 'park' : alert.type === 'comment' ? 'chat_bubble' : 'favorite'}</span></div>
                              <div className="flex-1"><div className="flex justify-between items-start mb-1"><p className="catalog-label text-[8px]">{alert.senderName || 'Platform'}</p></div><p className="text-sm font-medium text-text-main leading-tight">{alert.message}</p></div>
                          </button>
                      ))}
                  </div>
              </div>
          </div>
      )}

      {isDashboardMode && !isDetailActive && (
          <aside className="hidden md:flex md:flex-col w-20 lg:w-64 shrink-0 border-r border-stone-100 bg-white h-full py-8 px-2 lg:px-4 gap-1 overflow-y-auto no-scrollbar">
              <div className="flex items-center gap-2 px-2 lg:px-3 mb-8">
                  <span className="material-symbols-outlined text-2xl text-theme-accent shrink-0">wb_sunny</span>
                  <span className="hidden lg:block font-display font-black italic text-xl text-theme-primary tracking-tight truncate">NatureGram</span>
              </div>

              {[
                  { view: AppView.COMMUNITY, icon: 'home', label: 'Feed' },
                  { view: AppView.JOURNAL, icon: 'fingerprint', label: 'My Journal' },
              ].map(({ view, icon, label }) => (
                  <button
                      key={view}
                      onClick={() => handleNavigationRequest(view)}
                      aria-label={label}
                      aria-current={currentView === view ? 'page' : undefined}
                      className={`flex items-center gap-4 px-2 lg:px-3 py-3 rounded-2xl transition-all duration-200 ${currentView === view ? 'bg-stone-100 text-stone-900 font-bold' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-800'}`}
                  >
                      <span className={`material-symbols-outlined text-2xl shrink-0 ${currentView === view ? 'icon-fill' : ''}`}>{icon}</span>
                      <span className="hidden lg:block text-sm truncate">{label}</span>
                  </button>
              ))}

              <button
                  onClick={() => handleNavigationRequest(AppView.LENS)}
                  aria-label="Start new expedition"
                  className="flex items-center gap-4 px-2 lg:px-3 py-3 rounded-2xl bg-theme-accent text-white font-bold shadow-lg shadow-theme-accent/20 hover:opacity-90 active:scale-[0.98] transition-all my-2"
              >
                  <span className="material-symbols-outlined text-2xl shrink-0 font-black">add</span>
                  <span className="hidden lg:block text-sm truncate">New Expedition</span>
              </button>

              <button
                  onClick={() => {
                      if (userMode?.isAnonymous) {
                          setShowGlobalAuthModal(true);
                          return;
                      }
                      setIsNotificationsOpen(true);
                  }}
                  aria-label={`Field alerts${notifications.filter(n => !n.isRead).length > 0 ? ' (unread)' : ''}`}
                  className={`relative flex items-center gap-4 px-2 lg:px-3 py-3 rounded-2xl transition-all duration-200 ${isNotificationsOpen ? 'bg-stone-100 text-stone-900 font-bold' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-800'}`}
              >
                  <span className="relative shrink-0">
                      <span className={`material-symbols-outlined text-2xl ${isNotificationsOpen ? 'icon-fill' : ''}`}>favorite</span>
                      {notifications.filter(n => !n.isRead).length > 0 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-theme-accent rounded-full"></span>}
                  </span>
                  <span className="hidden lg:block text-sm truncate">Field Alerts</span>
              </button>

              <button
                  onClick={() => handleNavigationRequest(AppView.USER_PROFILE, { userId: userMode?.userId })}
                  aria-label="My Profile"
                  aria-current={currentView === AppView.USER_PROFILE ? 'page' : undefined}
                  className={`flex items-center gap-4 px-2 lg:px-3 py-3 rounded-2xl transition-all duration-200 ${currentView === AppView.USER_PROFILE ? 'bg-stone-100 text-stone-900 font-bold' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-800'}`}
              >
                  <span className={`material-symbols-outlined text-2xl shrink-0 ${currentView === AppView.USER_PROFILE ? 'icon-fill' : ''}`}>person</span>
                  <span className="hidden lg:block text-sm truncate">Profile</span>
              </button>
          </aside>
      )}

      <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
      <main className="flex-1 relative overflow-hidden flex flex-col">
         {currentView === AppView.LANDING && (
             <div className="absolute inset-0 bg-stone-900 flex flex-col items-center justify-center p-6 z-[60] overflow-hidden">
                <div className="absolute inset-0 bg-cover bg-center transition-opacity duration-1000" style={{ backgroundImage: `url('${getCorsProxyUrl(dailyTheme.imageUrl)}')`, opacity: 0.6 }}></div>
                <div className={`absolute inset-0 bg-gradient-to-t from-theme-primary-gradient to-theme-primary opacity-40 mix-blend-multiply`}></div>
                <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/40 to-transparent"></div>
                
                <div className="max-w-xl w-full flex flex-col items-center relative z-10 animate-slide-up h-full justify-between py-12">
                    <div className="text-center pb-[50px] pl-[2px]">
                        <div className={`w-16 h-16 md:w-20 md:h-20 rounded-full bg-gradient-to-tr from-theme-primary to-theme-primary-gradient flex items-center justify-center shadow-xl shadow-theme-shadow mx-auto mb-4 animate-float`}>
                            <span className="material-symbols-outlined text-3xl md:text-4xl text-white">wb_sunny</span>
                        </div>
                        <h1 className="text-4xl md:text-6xl font-display font-black tracking-tighter text-white italic drop-shadow-lg">NatureGram</h1>
                        <p className={`text-theme-text font-bold uppercase tracking-[0.4em] text-[10px] mt-2 drop-shadow-md`}>The Living Field Guide</p>
                    </div>
                    
                    <button type="button" className="w-full max-w-xs px-6 cursor-pointer" onClick={() => selectMode('community')}>
                        <div className="w-full bg-white/10 backdrop-blur-xl p-8 rounded-[2.5rem] flex flex-col items-center gap-5 text-center transition-all hover:scale-[1.02] active:scale-95 group shadow-2xl border border-white/20">
                            <div className="w-16 h-16 rounded-[1.5rem] bg-theme-primary text-white flex items-center justify-center shrink-0 shadow-lg shadow-theme-shadow">
                                <span className="material-symbols-outlined text-3xl">explore</span>
                            </div>
                            <div>
                                <h3 className="font-bold text-2xl leading-tight font-display italic text-white">Explore Wild</h3>
                                <p className="text-white/70 text-[11px] mt-2 tracking-[0.4em] uppercase font-bold">Begin Expedition</p>
                            </div>
                        </div>
                    </button>
                    
                    <div className="text-center px-6 max-w-md mx-auto">
                        <p className="text-lg md:text-xl italic font-display text-white leading-relaxed drop-shadow-md pt-[50px]">"{dailyTheme.quote}"</p>
                        <div className="mt-6 flex flex-col items-center gap-1">
                            <p className="text-white font-bold tracking-widest uppercase text-[10px]">{dailyTheme.naturalist}</p>
                            <div className="flex items-center gap-1 text-white/60 mt-1">
                                <span className="material-symbols-outlined text-[12px]">location_on</span>
                                <p className="text-[10px] tracking-wider uppercase">{dailyTheme.locationName}</p>
                            </div>
                            <p className="text-white/40 text-[9px] italic mt-1">{dailyTheme.locationCaption}</p>
                        </div>
                    </div>
                </div>
            </div>
         )}

         {authType !== null && (
             <AuthModal 
                 onClose={() => setAuthType(null)} 
                 onSuccess={() => {
                     setAuthType(null);
                     setCurrentView(AppView.COMMUNITY);
                 }}
                 initialIsSignUp={authType === 'signup'}
             />
         )}

        {currentView === AppView.LENS && config && userMode && (
            <div className="flex-1 relative z-50">
                <LiveLens 
                    onCapture={handleCapture} 
                    onEndSession={handleEndSession}
                    onExit={() => handleNavigationRequest(AppView.COMMUNITY)}
                    config={config} 
                    userMode={userMode} 
                    audioContext={audioContext} 
                    isFirstTime={isFirstTime}
                    isFinalizing={isFinalizing}
                    geminiServiceRef={geminiServiceRef}
                    updateSnapshot={updateSnapshot}
                    pendingSnapshotIdRef={pendingSnapshotIdRef}
                    selectedMode={selectedMode}
                    initialAudioMode={selectedMode === 'observation' ? 'silent' : 'voice'}
                />
            </div>
        )}

        {showModeSelection && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
                <div className="absolute inset-0 bg-stone-900/80 backdrop-blur-md" onClick={() => setShowModeSelection(false)}></div>
                <div className="relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-slide-up">
                    <div className="p-8 text-center">
                        <h2 className="text-2xl font-display font-black italic text-stone-900 mb-2">Select Expedition Mode</h2>
                        <p className="text-xs text-stone-500 mb-8 uppercase tracking-widest font-bold">How should the agent behave?</p>
                        
                        <div className="space-y-4">
                            <button 
                                onClick={() => {
                                    setSelectedMode('observation');
                                    setShowModeSelection(false);
                                    setCurrentView(AppView.LENS);
                                }}
                                className="w-full p-6 rounded-3xl border-2 border-stone-100 hover:border-theme-accent hover:bg-theme-accent/5 transition-all text-left group active:scale-95"
                            >
                                <div className="flex items-center gap-4 mb-2">
                                    <div className="w-10 h-10 rounded-full bg-stone-100 text-theme-accent flex items-center justify-center group-hover:bg-theme-accent group-hover:text-white transition-colors">
                                        <span className="material-symbols-outlined">visibility</span>
                                    </div>
                                    <h3 className="font-bold text-lg text-stone-900">Observation</h3>
                                </div>
                                <p className="text-xs text-stone-600 leading-relaxed">
                                    The agent acts as a silent observer, providing insights only when significant events occur or when asked.
                                </p>
                            </button>

                            <button 
                                onClick={() => {
                                    setSelectedMode('conversation');
                                    setShowModeSelection(false);
                                    setCurrentView(AppView.LENS);
                                }}
                                className="w-full p-6 rounded-3xl border-2 border-stone-100 hover:border-theme-accent hover:bg-theme-accent/5 transition-all text-left group active:scale-95"
                            >
                                <div className="flex items-center gap-4 mb-2">
                                    <div className="w-10 h-10 rounded-full bg-stone-100 text-theme-accent flex items-center justify-center group-hover:bg-theme-accent group-hover:text-white transition-colors">
                                        <span className="material-symbols-outlined">forum</span>
                                    </div>
                                    <h3 className="font-bold text-lg text-stone-900">Conversation</h3>
                                </div>
                                <p className="text-xs text-stone-600 leading-relaxed">
                                    The agent is an active companion, engaging in real-time dialogue about your surroundings and findings.
                                </p>
                            </button>
                        </div>

                        <button 
                            onClick={() => setShowModeSelection(false)}
                            className="mt-8 text-xs font-bold text-stone-400 uppercase tracking-widest hover:text-stone-600 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        )}

        {currentView === AppView.SHARED_POST && selectedPostId && (
            <SharedPostView postId={selectedPostId} onGoToApp={() => {
                setSelectedPostId(null);
                setCurrentView(AppView.COMMUNITY);
                window.history.replaceState({}, document.title, window.location.pathname);
            }} />
        )}
      
        {isDashboardMode && (
          <div className="flex-1 overflow-y-auto no-scrollbar relative animate-fade-in pb-28">
             {currentView === AppView.COMMUNITY && userMode && (
                 <Community 
                     currentUserMode={userMode} 
                     selectedPostId={selectedPostId} 
                     onPostClose={handlePostClose} 
                     onPostOpen={() => setIsDetailActive(true)} 
                     backLabel={returnView === AppView.JOURNAL ? "Archive" : "Feed"} 
                     onViewProfile={(uid) => handleNavigationRequest(AppView.USER_PROFILE, { userId: uid })} 
                     activeDraftsCount={activeDraftsCount}
                     onViewDrafts={() => setCurrentView(AppView.DRAFTS)}
                     onLogoClick={() => handleNavigationRequest(AppView.LANDING)}
                 />
             )}
             {currentView === AppView.JOURNAL && userMode && <Journal 
                     userId={userMode.userId!} 
                     activeDraftsCount={activeDraftsCount}
                     onViewDrafts={() => setCurrentView(AppView.DRAFTS)}
                     onViewProfile={(uid) => handleNavigationRequest(AppView.USER_PROFILE, { userId: uid })}
                     onPostOpen={() => setIsDetailActive(true)}
                     onPostClose={handlePostClose}
                     onLogoClick={() => handleNavigationRequest(AppView.LANDING)}
                     onStartExpedition={() => handleNavigationRequest(AppView.LENS)}
                 />}
             {currentView === AppView.DRAFTS && userMode && <DraftsTray userId={userMode.userId!} onResume={handleResumeDraft} onBack={() => { refreshDraftsCount(); setCurrentView(AppView.COMMUNITY); }} />}
             {currentView === AppView.USER_PROFILE && userMode && (
                 <UserProfile userId={targetProfileId || userMode.userId!} currentUserId={userMode.userId} isAnonymous={userMode.isAnonymous} onBack={() => handleNavigationRequest(AppView.COMMUNITY)} onSignOut={() => handleNavigationRequest(AppView.LANDING)} onViewJournal={() => handleNavigationRequest(AppView.JOURNAL)} onAdminConsole={() => setCurrentView(AppView.ADMIN)} />
             )}
          </div>
        )}

        {currentView === AppView.ADMIN && <AdminConsole onBack={() => setCurrentView(AppView.USER_PROFILE)} />}
        
        <AnimatePresence>
        {currentView === AppView.POST_SESSION && userMode && (
             <PostSessionView 
                 snapshots={currentSessionSnapshots} 
                 summary={sessionSummary} 
                 userMode={userMode} 
                 onClose={() => { setCurrentSessionSnapshots([]); setSnapshots([]); setSessionSummary(""); setCurrentView(AppView.COMMUNITY); }} 
                 onViewFeed={() => { setCurrentSessionSnapshots([]); setSnapshots([]); setSessionSummary(""); setCurrentView(AppView.COMMUNITY); }} 
                 onSaveDraft={handleSaveDraft} 
                 geminiServiceRef={geminiServiceRef}
                 updateSnapshot={updateSnapshot}
                 pendingSnapshotIdRef={pendingSnapshotIdRef}
             />
        )}
        </AnimatePresence>
        
        {showGlobalAuthModal && (
            <AuthModal 
                onClose={() => setShowGlobalAuthModal(false)}
                onSuccess={() => setShowGlobalAuthModal(false)}
            />
        )}
      </main>

      {isDashboardMode && !isDetailActive && (
          <div className="md:hidden absolute bottom-0 left-0 right-0 z-[40] pointer-events-none transition-all duration-300 translate-y-0 opacity-100 animate-fade-in pb-[env(safe-area-inset-bottom)] bg-white border-t border-stone-100">
              <nav className="h-16 flex justify-around items-center px-2 pointer-events-auto max-w-md mx-auto transition-all">
                <button onClick={() => handleNavigationRequest(AppView.COMMUNITY)} aria-label="Feed" aria-current={currentView === AppView.COMMUNITY ? 'page' : undefined} className={`flex flex-col items-center gap-1 transition-all duration-300 ${currentView === AppView.COMMUNITY ? 'text-stone-900 scale-110' : 'text-stone-400 hover:text-stone-600'}`}><span className={`material-symbols-outlined text-2xl ${currentView === AppView.COMMUNITY ? 'icon-fill' : ''}`}>home</span></button>
                <button onClick={() => handleNavigationRequest(AppView.JOURNAL)} aria-label="My Journal" aria-current={currentView === AppView.JOURNAL ? 'page' : undefined} className={`flex flex-col items-center gap-1 transition-all duration-300 ${currentView === AppView.JOURNAL ? 'text-stone-900 scale-110' : 'text-stone-400 hover:text-stone-600'}`}><span className={`material-symbols-outlined text-2xl ${currentView === AppView.JOURNAL ? 'icon-fill' : ''}`}>fingerprint</span></button>
                <button onClick={() => handleNavigationRequest(AppView.LENS)} aria-label="Start new expedition" className="group relative w-12 h-12 rounded-full flex items-center justify-center shadow-lg bg-theme-accent text-white active:scale-95 transition-all"><span className="material-symbols-outlined text-2xl font-black">add</span></button>
                <button onClick={() => {
                    if (userMode?.isAnonymous) {
                        setShowGlobalAuthModal(true);
                        return;
                    }
                    setIsNotificationsOpen(true);
                }} aria-label={`Field alerts${notifications.filter(n => !n.isRead).length > 0 ? ' (unread)' : ''}`} className={`relative flex flex-col items-center gap-1 transition-all duration-300 ${isNotificationsOpen ? 'text-stone-900 scale-110' : 'text-stone-400 hover:text-stone-600'}`}>
                    <span className={`material-symbols-outlined text-2xl ${isNotificationsOpen ? 'icon-fill' : ''}`}>favorite</span>
                    {notifications.filter(n => !n.isRead).length > 0 && <span className="absolute -top-1 -right-1 w-2 h-2 bg-theme-accent rounded-full"></span>}
                </button>
                <button onClick={() => handleNavigationRequest(AppView.USER_PROFILE, { userId: userMode?.userId })} aria-label="My Profile" aria-current={currentView === AppView.USER_PROFILE ? 'page' : undefined} className={`flex flex-col items-center gap-1 transition-all duration-300 ${currentView === AppView.USER_PROFILE ? 'text-stone-900 scale-110' : 'text-stone-400 hover:text-stone-600'}`}><span className={`material-symbols-outlined text-2xl ${currentView === AppView.USER_PROFILE ? 'icon-fill' : ''}`}>person</span></button>
              </nav>
          </div>
      )}
      </div>
    </div>
  );
};

export default App;
