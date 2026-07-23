
// @importmap-lock - DO NOT AUTO-ADD IMPORTS. All imports must remain below.

import React, { useState, useEffect } from 'react';
import { CommunityPost, UserProfileData } from '../types';
import { FirebaseService } from '../services/firebaseService';
import { auth } from '../firebaseConfig';
import AuthModal from './AuthModal';
import { reputationTier, REPUTATION_TIER_LABELS } from '../services/reputationService';

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
  // Y3: contribution identity — beyond raw sightings, the stats that
  // reward genuine contribution (community-confirmed IDs, rare/protected
  // finds) and drive return.
  const [journalStats, setJournalStats] = useState({ count: 0, species: 0, confirmed: 0, rare: 0 });
  // Reflects actual browser permission state rather than assuming enabled —
  // this toggle used to be purely cosmetic local state with no effect.
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );
  const [isTogglingNotifications, setIsTogglingNotifications] = useState(false);
  const [stealthMode, setStealthMode] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // W3: was a hardcoded `auth.currentUser?.email === 'ram@iitj.ac.in'`
  // check — now reflects the same `admin` custom claim AdminConsole.tsx
  // and firestore.rules check, resolved async since claims live in the ID
  // token (getIdTokenResult), not on the currentUser object synchronously.
  const [isAdminUser, setIsAdminUser] = useState(false);
  // Y1: follow graph state — counts (computed server-side) + whether the
  // viewer follows this profile.
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [showFollowAuth, setShowFollowAuth] = useState(false);

  const isOwnProfile = userId === currentUserId;

  // Y1: load follower/following counts, and (for other people's profiles)
  // whether the current viewer already follows them.
  useEffect(() => {
    if (isAnonymous && isOwnProfile) return;
    let active = true;
    FirebaseService.getFollowerCount(userId).then(c => { if (active) setFollowerCount(c); });
    FirebaseService.getFollowingCount(userId).then(c => { if (active) setFollowingCount(c); });
    if (currentUserId && !isOwnProfile) {
      FirebaseService.isFollowing(currentUserId, userId).then(f => { if (active) setIsFollowing(f); });
    }
    return () => { active = false; };
  }, [userId, currentUserId, isOwnProfile, isAnonymous]);

  const handleToggleFollow = async () => {
    if (isOwnProfile || followBusy || !currentUserId) return;
    if (isAnonymous) { setShowFollowAuth(true); return; }
    setFollowBusy(true);
    try {
      if (isFollowing) {
        await FirebaseService.unfollowUser(currentUserId, userId);
        setIsFollowing(false);
        setFollowerCount(c => Math.max(0, c - 1));
      } else {
        const me = await FirebaseService.getUserProfile(currentUserId);
        await FirebaseService.followUser(
          { uid: currentUserId, username: me?.username || 'Explorer', avatarUrl: me?.avatarUrl },
          { uid: userId, username: profileData?.username || 'Explorer', avatarUrl: profileData?.avatarUrl },
        );
        setIsFollowing(true);
        setFollowerCount(c => c + 1);
      }
    } catch (e) {
      console.error('Follow toggle failed:', e);
    } finally {
      setFollowBusy(false);
    }
  };

  useEffect(() => {
    if (!isOwnProfile) return;
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    currentUser.getIdTokenResult()
      .then(tokenResult => setIsAdminUser(tokenResult.claims.admin === true))
      .catch(() => setIsAdminUser(false));
  }, [isOwnProfile]);

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
        // Y3: count crowd-verified identifications (community-confirmed or
        // the stronger research-grade) and rare/protected finds.
        const confirmed = filteredPosts.filter(p => p.verificationState === 'confirmed' || p.verificationState === 'research-grade').length;
        const rare = filteredPosts.filter(p => p.isSensitiveSpecies).length;
        setJournalStats({ count: filteredPosts.length, species: uniqueSpecies, confirmed, rare });
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
                
                <h2 className="text-2xl font-display font-black text-text-main italic flex items-center gap-1.5">
                    {profileData?.username || 'Explorer'}
                    {profileData?.isExpert && (
                        <span className="material-symbols-outlined text-theme-accent text-lg icon-fill" title="Verified Expert">verified</span>
                    )}
                </h2>
                {/* Y3: real reputation tier (X1), replacing the old hardcoded
                    "Expert Naturalist" label that mislabelled every user. */}
                <p className="catalog-label text-[8px] opacity-60 mt-1">
                    {REPUTATION_TIER_LABELS[reputationTier(profileData?.reputationScore || 0, !!profileData?.isExpert)]} • Since {profileData?.joinedAt?.toDate?.()?.getFullYear() || 2025}
                </p>

                <div className="flex gap-6 mt-8 w-full justify-center flex-wrap">
                    <div className="text-center cursor-pointer hover:opacity-70 transition-opacity" onClick={isOwnProfile ? onViewJournal : undefined}>
                        <div className="text-2xl font-black text-theme-accent">{journalStats.count}</div>
                        <div className="catalog-label text-[8px]">Sightings</div>
                    </div>
                    <div className="w-px h-10 bg-theme-primary/10"></div>
                    <div className="text-center">
                        <div className="text-2xl font-black text-theme-accent">{journalStats.species}</div>
                        <div className="catalog-label text-[8px]">Species</div>
                    </div>
                    <div className="w-px h-10 bg-theme-primary/10"></div>
                    {/* Y3: community-verified identifications — the contribution
                        that actually signals credibility, not just volume. */}
                    <div className="text-center">
                        <div className="text-2xl font-black text-theme-accent">{journalStats.confirmed}</div>
                        <div className="catalog-label text-[8px]">Confirmed</div>
                    </div>
                    <div className="w-px h-10 bg-theme-primary/10"></div>
                    {/* Y1: follow graph counts */}
                    <div className="text-center">
                        <div className="text-2xl font-black text-theme-accent">{followerCount}</div>
                        <div className="catalog-label text-[8px]">Followers</div>
                    </div>
                    <div className="w-px h-10 bg-theme-primary/10"></div>
                    <div className="text-center">
                        <div className="text-2xl font-black text-theme-accent">{followingCount}</div>
                        <div className="catalog-label text-[8px]">Following</div>
                    </div>
                </div>

                {/* Y3: rare/protected finds — a badge of genuine field
                    contribution, shown only when the explorer has any. */}
                {journalStats.rare > 0 && (
                    <div className="mt-5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/20">
                        <span className="material-symbols-outlined text-[14px]">shield</span>
                        <span className="text-[9px] font-black uppercase tracking-widest">{journalStats.rare} rare / protected find{journalStats.rare === 1 ? '' : 's'}</span>
                    </div>
                )}

                {/* Y1: follow / unfollow — only on other people's profiles */}
                {!isOwnProfile && (
                    <button
                        onClick={handleToggleFollow}
                        disabled={followBusy}
                        aria-pressed={isFollowing}
                        className={`mt-6 px-8 py-3 rounded-full font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent focus-visible:ring-offset-2 flex items-center gap-2 ${
                            isFollowing
                                ? 'bg-theme-primary/5 text-theme-primary border border-theme-primary/15 hover:bg-theme-primary/10'
                                : 'bg-theme-accent text-white shadow-lg shadow-theme-accent/20 hover:opacity-90'
                        }`}
                    >
                        <span className="material-symbols-outlined text-sm">{isFollowing ? 'how_to_reg' : 'person_add'}</span>
                        {isFollowing ? 'Following' : 'Follow'}
                    </button>
                )}
            </div>

            {isOwnProfile && (
                <>
                    {isAdminUser && onAdminConsole && (
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

        {/* Y1: anonymous viewers must sign in to follow — following is a
            persistent social relationship, not an ephemeral guest action. */}
        {showFollowAuth && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 animate-fade-in font-body">
                <AuthModal
                    onClose={() => setShowFollowAuth(false)}
                    onSuccess={() => setShowFollowAuth(false)}
                />
            </div>
        )}
    </div>
  );
};

export default UserProfile;
