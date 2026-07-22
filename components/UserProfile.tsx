
// @importmap-lock - DO NOT AUTO-ADD IMPORTS. All imports must remain below.

import React, { useState, useEffect } from 'react';
import { CommunityPost, UserProfileData } from '../types';
import { FirebaseService } from '../services/firebaseService';
import { auth } from '../firebaseConfig';
import AuthModal from './AuthModal';

interface UserProfileProps {
  userId: string;
  currentUserId?: string;
  isAnonymous?: boolean;
  onBack: () => void;
  onSignOut: () => void;
  onViewJournal: () => void;
  onAdminConsole?: () => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ userId, currentUserId, isAnonymous, onBack, onSignOut, onViewJournal, onAdminConsole }) => {
  const [profileData, setProfileData] = useState<UserProfileData | null>(null);
  const [journalStats, setJournalStats] = useState({ count: 0, species: 0 });
  // Reflects actual browser permission state rather than assuming enabled —
  // this toggle used to be purely cosmetic local state with no effect.
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );
  const [isTogglingNotifications, setIsTogglingNotifications] = useState(false);
  const [stealthMode, setStealthMode] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const isOwnProfile = userId === currentUserId;

  const handleToggleNotifications = async () => {
    if (!currentUserId || isTogglingNotifications) return;
    setIsTogglingNotifications(true);
    try {
      if (!notificationsEnabled) {
        const granted = await FirebaseService.requestPushPermission(currentUserId);
        setNotificationsEnabled(granted);
      } else {
        await FirebaseService.disablePushNotifications(currentUserId);
        setNotificationsEnabled(false);
      }
    } finally {
      setIsTogglingNotifications(false);
    }
  };

  useEffect(() => {
    if (isAnonymous && isOwnProfile) {
        setIsLoading(false);
        return;
    }

    setIsLoading(true);
    const unsubscribeProfile = FirebaseService.subscribeToUserProfile(userId, (data) => {
        setProfileData(data);
    });
    
    // Load journal stats (only public if not own profile)
    const unsubscribeJournal = FirebaseService.subscribeToUserJournal(userId, (posts) => {
        const filteredPosts = isOwnProfile ? posts : posts.filter(p => p.isPublic);
        const uniqueSpecies = new Set(filteredPosts.flatMap(p => p.labels || []).map(l => l.toLowerCase())).size;
        setJournalStats({ count: filteredPosts.length, species: uniqueSpecies });
        setIsLoading(false);
    });

    return () => {
        unsubscribeProfile();
        unsubscribeJournal();
    };
  }, [userId, isOwnProfile, isAnonymous]);

  const handleArchive = () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
          user: userId,
          exportDate: new Date().toISOString(),
          stats: journalStats
      }));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "naturegram_archive.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
  };

  const handleDeleteAccount = async () => {
      if (confirm("Are you sure? This will permanently delete your profile and authentication data.")) {
          setIsDeleting(true);
          try {
              await FirebaseService.deleteUserAccount();
              onSignOut();
          } catch (e) {
              alert("Failed to delete account. Re-authenticate and try again.");
              setIsDeleting(false);
          }
      }
  };

  if (isLoading) {
      return (
          <div className="h-full bg-day-bg flex items-center justify-center animate-fade-in">
              <div className="w-8 h-8 border-2 border-theme-accent border-t-transparent animate-spin rounded-full"></div>
          </div>
      );
  }

  if (isAnonymous && isOwnProfile) {
      return (
          <div className="h-full bg-day-bg flex flex-col font-body animate-slide-in-right">
              <header className="px-6 py-4 flex items-center justify-between bg-white/50 backdrop-blur-md border-b border-theme-primary/10 shrink-0 safe-pt">
                  <button
                      onClick={onBack}
                      aria-label="Back"
                      className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-theme-accent shadow-sm hover:opacity-70 transition-colors"
                  >
                      <span className="material-symbols-outlined">arrow_back</span>
                  </button>
                  <h1 className="font-display font-black italic text-lg text-text-main">Profile</h1>
                  <div className="w-10"></div>
              </header>
              <main className="flex-1 overflow-y-auto no-scrollbar p-6 flex flex-col items-center justify-center">
                  <AuthModal 
                      inline={true}
                      onSuccess={() => {}}
                  />
              </main>
          </div>
      );
  }

  return (
    <div className="h-full bg-day-bg flex flex-col font-body animate-slide-in-right">
        <header className="px-6 py-4 flex items-center justify-between bg-white/50 backdrop-blur-md border-b border-theme-primary/10 shrink-0 safe-pt">
            <button
                onClick={onBack}
                aria-label="Back"
                className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-theme-accent shadow-sm hover:opacity-70 transition-colors"
            >
                <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <h1 className="font-display font-black italic text-lg text-text-main">{isOwnProfile ? 'Explorer Profile' : 'Explorer Portfolio'}</h1>
            <div className="w-10"></div>
        </header>

        <main className="flex-1 overflow-y-auto no-scrollbar p-6">
            <div className="bg-white rounded-[2.5rem] p-8 shadow-xl shadow-theme-primary/20/50 mb-8 flex flex-col items-center text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-theme-accent/10 to-transparent"></div>
                
                <div className="w-24 h-24 rounded-full bg-theme-primary/10 border-4 border-white shadow-lg relative z-10 flex items-center justify-center text-theme-accent mb-4 overflow-hidden">
                    {profileData?.avatarUrl ? (
                        <img src={profileData.avatarUrl} className="w-full h-full object-cover" />
                    ) : (
                        <span className="material-symbols-outlined text-4xl">person</span>
                    )}
                </div>
                
                <h2 className="text-2xl font-display font-black text-text-main italic">
                    {profileData?.username || 'Explorer'}
                </h2>
                <p className="catalog-label text-[8px] opacity-60 mt-1">
                    Expert Naturalist • Since {profileData?.joinedAt?.toDate?.()?.getFullYear() || 2025}
                </p>

                <div className="flex gap-8 mt-8 w-full justify-center">
                    <div className="text-center cursor-pointer hover:opacity-70 transition-opacity" onClick={isOwnProfile ? onViewJournal : undefined}>
                        <div className="text-2xl font-black text-theme-accent">{journalStats.count}</div>
                        <div className="catalog-label text-[8px]">Sightings</div>
                    </div>
                    <div className="w-px h-10 bg-theme-primary/10"></div>
                    <div className="text-center">
                        <div className="text-2xl font-black text-theme-accent">{journalStats.species}</div>
                        <div className="catalog-label text-[8px]">Species</div>
                    </div>
                </div>
            </div>

            {isOwnProfile && (
                <>
                    {auth.currentUser?.email === 'ram@iitj.ac.in' && onAdminConsole && (
                        <div className="mb-8">
                            <h3 className="catalog-label text-[9px] mb-4 ml-2 text-theme-accent font-bold">Admin Privileges</h3>
                            <div className="bg-stone-900 border border-white/10 rounded-3xl overflow-hidden shadow-xl shadow-stone-900/40">
                                <button 
                                    onClick={onAdminConsole} 
                                    className="w-full p-5 flex items-center gap-4 hover:bg-white/5 transition-colors text-left"
                                >
                                    <div className="w-10 h-10 rounded-full bg-[#10b981] text-stone-950 flex items-center justify-center">
                                        <span className="material-symbols-outlined text-md">admin_panel_settings</span>
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-bold text-sm text-white">Central Admin Console</p>
                                        <p className="text-[10px] text-white/50">Configure core AI brain & analyze platform logs</p>
                                    </div>
                                    <span className="material-symbols-outlined text-white/40">chevron_right</span>
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="mb-8">
                        <h3 className="catalog-label text-[9px] mb-4 ml-2">Preferences</h3>
                        <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-theme-primary/10">
                            <div className="p-4 flex items-center justify-between border-b border-theme-primary/5">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-theme-accent/10 text-theme-accent flex items-center justify-center">
                                        <span className="material-symbols-outlined">notifications</span>
                                    </div>
                                    <div>
                                        <p className="font-bold text-sm text-text-main">Field Alerts</p>
                                        <p className="text-[10px] text-text-muted">Real-time platform updates</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleToggleNotifications}
                                    disabled={isTogglingNotifications}
                                    className={`w-12 h-7 rounded-full p-1 transition-colors duration-300 disabled:opacity-50 ${notificationsEnabled ? 'bg-theme-accent' : 'bg-theme-primary/20'}`}
                                >
                                    <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-300 ${notificationsEnabled ? 'translate-x-5' : 'translate-x-0'}`}></div>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="mb-8">
                        <h3 className="catalog-label text-[9px] mb-4 ml-2">Data & Account</h3>
                        <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-theme-primary/10">
                            <button onClick={handleArchive} className="w-full p-4 flex items-center gap-4 hover:bg-theme-primary/5 transition-colors text-left border-b border-theme-primary/5">
                                <div className="w-10 h-10 rounded-full bg-theme-accent/10 text-theme-accent flex items-center justify-center">
                                    <span className="material-symbols-outlined">inventory_2</span>
                                </div>
                                <div className="flex-1">
                                    <p className="font-bold text-sm text-text-main">Archive Field Data</p>
                                    <p className="text-[10px] text-text-muted">Download your persistent record</p>
                                </div>
                                <span className="material-symbols-outlined text-theme-accent/50">chevron_right</span>
                            </button>

                            <button onClick={handleDeleteAccount} className="w-full p-4 flex items-center gap-4 hover:bg-red-50 transition-colors text-left group">
                                <div className="w-10 h-10 rounded-full bg-red-100 text-red-500 flex items-center justify-center group-hover:bg-red-500 group-hover:text-white transition-colors">
                                    <span className="material-symbols-outlined">delete_forever</span>
                                </div>
                                <div className="flex-1">
                                    <p className="font-bold text-sm text-red-600">Delete Profile</p>
                                    <p className="text-[10px] text-red-400">Permanently remove account</p>
                                </div>
                            </button>
                        </div>
                    </div>

                    <button 
                        onClick={onSignOut} 
                        className="w-full py-4 rounded-2xl bg-theme-accent/10 text-theme-accent font-bold hover:bg-theme-accent/20 transition-colors flex items-center justify-center gap-2 border border-theme-accent/20"
                    >
                        <span className="material-symbols-outlined">logout</span>
                        Sign Out
                    </button>
                </>
            )}
            
            <p className="text-center text-[10px] text-theme-primary/30 font-bold uppercase tracking-widest mt-8">
                NatureGram v2.5.0 • Persistent Explorer
            </p>
        </main>
    </div>
  );
};

export default UserProfile;
