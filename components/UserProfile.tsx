import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CommunityPost, UserProfileData } from '../types';
import { FirebaseService } from '../services/firebaseService';
import { auth } from '../firebaseConfig';
import AuthModal from './AuthModal';
import NaturalistPersonaModal from './NaturalistPersonaModal';
import { PUBLIC_ORIGIN, timeAgo } from '../utils';
import { track } from '../services/analytics';
import { enablePush, disablePush, pushEnabled, pushSupported } from '../services/push';

/** "Exploring since March 2026", tolerant of Firestore Timestamps, {seconds} objects, ISO strings and millis. */
const exploringSince = (t: any): string => {
  const ms = t?.toMillis?.() ?? (typeof t?.seconds === 'number' ? t.seconds * 1000 : typeof t === 'string' || typeof t === 'number' ? new Date(t).getTime() : NaN);
  return Number.isFinite(ms) ? `Exploring since ${new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` : 'Explorer';
};

interface UserProfileProps {
  userId: string;
  currentUserId?: string;
  isAnonymous?: boolean;
  onBack: () => void;
  onSignOut: () => void;
  onViewJournal: () => void;
  onAdminConsole?: () => void;
  onOpenPost?: (postId: string) => void;
  onViewProfile?: (uid: string) => void;
  onRequireAccount?: (reason: string, then?: () => void) => void;
  onMessage?: (uid: string) => void;
}

type Tab = 'posts' | 'lifelist' | 'saved';

const Avatar: React.FC<{ url?: string | null; name?: string; size?: number }> = ({ url, name, size = 88 }) => (
  url
    ? <img src={url} alt={`${name || 'Explorer'}'s profile photo`} className="rounded-full object-cover bg-stone-100" style={{ width: size, height: size }} />
    : <div className="rounded-full bg-theme-accent/10 text-theme-accent flex items-center justify-center font-display font-bold" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">{(name || '?').charAt(0).toUpperCase()}</div>
);

const Sheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center animate-fade-in" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-[2rem] sm:rounded-[2rem] max-h-[85dvh] flex flex-col animate-slide-up pb-[env(safe-area-inset-bottom)]">
        <header className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <h2 className="text-lg font-bold text-stone-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-stone-100">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
};

/** "23 species since March 2026. Your first was the House Sparrow." in one quiet line. */
const lifeListSummary = (count: number, first: any, own: boolean): string => {
  const ms = first?.toMillis?.() ?? (typeof first?.seconds === 'number' ? first.seconds * 1000 : NaN);
  const since = Number.isFinite(ms) ? ` since ${new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` : '';
  return `${count} species${since}. ${own ? 'Each one is something you saw with your own eyes.' : 'Each one seen first-hand.'}`;
};

const UserProfile: React.FC<UserProfileProps> = ({ userId, currentUserId, isAnonymous, onBack, onSignOut, onViewJournal, onAdminConsole, onOpenPost, onViewProfile, onRequireAccount, onMessage }) => {
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('posts');
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [saved, setSaved] = useState<{ id: string; thumbnailUrl?: string; label?: string }[] | null>(null);
  const [sheet, setSheet] = useState<null | 'settings' | 'edit' | 'followers' | 'following' | 'delete' | 'menu'>(null);
  const [people, setPeople] = useState<UserProfileData[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [toast, setToast] = useState('');
  const [personaOpen, setPersonaOpen] = useState(false);

  const isOwnProfile = userId === currentUserId;

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    if (isAnonymous && isOwnProfile) { setIsLoading(false); return; }
    setIsLoading(true);
    const unsubProfile = FirebaseService.subscribeToUserProfile(userId, setProfile);
    const unsubPosts = FirebaseService.subscribeToUserJournal(userId, (p) => {
      setPosts(p);
      setIsLoading(false);
    }, { publicOnly: !isOwnProfile });
    if (!isOwnProfile) {
      FirebaseService.isFollowing(userId).then(setFollowing);
      FirebaseService.getBlockedIds().then(ids => setBlocked(ids.includes(userId)));
    } else {
      FirebaseService.getAdminStatus().then(s => { setIsAdmin(s.isAdmin); });
      setNeedsVerification(!!auth.currentUser && !auth.currentUser.isAnonymous && !auth.currentUser.emailVerified);
    }
    return () => { unsubProfile(); unsubPosts(); };
  }, [userId, isOwnProfile, isAnonymous]);

  useEffect(() => {
    if (tab === 'saved' && saved === null) FirebaseService.getSavedPosts().then(setSaved);
  }, [tab, saved]);

  useEffect(() => {
    if (sheet === 'followers' || sheet === 'following') {
      setPeople(null);
      FirebaseService.getConnections(userId, sheet).then(setPeople);
    }
  }, [sheet, userId]);

  // Life list: every distinct species this explorer has recorded, with first sighting
  const lifeList = useMemo(() => {
    const map = new Map<string, { name: string; first: any; count: number; thumb?: string; postId: string }>();
    const toMs = (t: any) => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0);
    [...posts].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp)).forEach(p => {
      const name = (p.labels?.[0] || '').trim();
      if (!name || /^(unknown|nature|unidentified|observation)/i.test(name)) return;
      const key = name.toLowerCase();
      const e = map.get(key);
      if (e) e.count++;
      else map.set(key, { name, first: p.timestamp, count: 1, thumb: p.thumbnailUrl || p.imageUrl, postId: p.id });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [posts]);

  const username = profile?.username || (isOwnProfile ? auth.currentUser?.displayName : '') || 'Explorer';
  const visiblePosts = isOwnProfile ? posts : posts.filter(p => p.isPublic);

  const toggleFollow = async () => {
    if (!currentUserId || isAnonymous) {
      onRequireAccount?.(`Create a free account to follow ${username}.`, toggleFollow);
      return;
    }
    setFollowBusy(true);
    const was = following;
    setFollowing(!was); // optimistic
    try {
      if (was) await FirebaseService.unfollowUser(userId);
      else await FirebaseService.followUser(userId);
      track(was ? 'unfollow' : 'follow');
    } catch (e) {
      setFollowing(was);
      showToast('Could not update follow. Please try again.');
    } finally {
      setFollowBusy(false);
    }
  };

  const toggleBlock = async () => {
    setSheet(null);
    if (!blocked && !window.confirm(`Block ${username}? You won't see their posts or comments, and they'll be removed from your followers list.`)) return;
    try {
      if (blocked) { await FirebaseService.unblockUser(userId); setBlocked(false); showToast(`${username} unblocked`); }
      else { await FirebaseService.blockUser(userId); setBlocked(true); setFollowing(false); showToast(`${username} blocked`); }
    } catch { showToast('Something went wrong. Please try again.'); }
  };

  const shareProfile = async () => {
    const url = `${PUBLIC_ORIGIN}/profile?user=${encodeURIComponent(userId)}`;
    try {
      if (navigator.share) await navigator.share({ title: `${username} on NatureGram`, url });
      else { await navigator.clipboard.writeText(url); showToast('Profile link copied'); }
    } catch { /* cancelled */ }
  };

  const downloadData = async () => {
    showToast('Preparing your data…');
    try {
      const blob = await FirebaseService.exportMyData();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `naturegram-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      showToast('Your data has been downloaded');
    } catch { showToast('Export failed. Please try again.'); }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" role="status">
        <div className="w-8 h-8 border-2 border-theme-accent border-t-transparent animate-spin rounded-full" aria-hidden="true"></div>
        <span className="sr-only">Loading profile…</span>
      </div>
    );
  }

  if (isAnonymous && isOwnProfile) {
    return (
      <div className="flex-1 overflow-y-auto no-scrollbar bg-day-bg pb-28 safe-pt">
        <section className="px-5 pt-8 pb-4 max-w-lg mx-auto">
          <div className="flex items-center gap-4">
            <span className="shrink-0 w-20 h-20 rounded-full border border-dashed border-theme-accent/50 flex items-center justify-center text-theme-accent/70" aria-hidden="true">
              <span className="material-symbols-outlined text-4xl" style={{ fontVariationSettings: "'wght' 200" }}>fingerprint</span>
            </span>
            <div>
              <p className="text-2xl font-display italic font-bold text-theme-primary leading-tight">Your field page</p>
              <p className="text-sm text-stone-500 mt-0.5">Exploring as a guest</p>
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 border-y border-theme-primary/10 divide-x divide-theme-primary/10">
            <div className="py-3 text-center"><dd className="text-xl font-display font-bold text-theme-primary/40 tabular">0</dd><dt className="text-xs text-stone-500">species</dt></div>
            <div className="py-3 text-center"><dd className="text-xl font-display font-bold text-theme-primary/40 tabular">0</dd><dt className="text-xs text-stone-500">sightings</dt></div>
          </dl>
          <p className="text-[15px] font-display italic text-stone-700 mt-6 leading-relaxed">
            Every creature you identify joins your life list, with the day you first saw it. Your journal keeps every sighting, including the ones you keep to yourself.
          </p>
          <button onClick={() => onRequireAccount?.('Create a free account to keep your journal and life list.')} className="mt-6 w-full py-3.5 rounded-2xl bg-theme-primary text-white font-bold">Start my field page</button>
          <p className="text-xs text-stone-500 mt-3 text-center">Free. You can keep exploring as a guest.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-day-bg overflow-hidden animate-fade-in">
      <header className="px-3 py-2 flex items-center justify-between bg-day-bg/90 backdrop-blur border-b border-theme-primary/10 shrink-0 safe-pt">
        {!isOwnProfile ? (
          <button onClick={onBack} aria-label="Back" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-stone-100">
            <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          </button>
        ) : <span className="w-11" />}
        <h1 className="font-display italic font-bold text-lg text-theme-primary truncate">{username}</h1>
        <button onClick={() => setSheet(isOwnProfile ? 'settings' : 'menu')} aria-label={isOwnProfile ? 'Settings' : 'More options'} className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-stone-100">
          <span className="material-symbols-outlined" aria-hidden="true">{isOwnProfile ? 'menu' : 'more_horiz'}</span>
        </button>
      </header>

      <main className="flex-1 overflow-y-auto no-scrollbar pb-24">
        <section className="px-5 pt-6 pb-4">
          <div className="flex items-center gap-4">
            <button onClick={() => isOwnProfile && setSheet('edit')} disabled={!isOwnProfile} aria-label={isOwnProfile ? 'Change profile photo' : undefined} className="shrink-0 rounded-full p-[3px] border border-theme-accent/40">
              <Avatar url={profile?.avatarUrl} name={username} />
            </button>
            <div className="min-w-0">
              <p className="text-2xl font-display italic font-bold text-theme-primary leading-tight truncate">{profile?.displayName || username}</p>
              <p className="text-sm text-stone-500 mt-0.5">{exploringSince(profile?.joinedAt)}</p>
            </div>
          </div>
          {profile?.bio ? <p className="text-[15px] font-display italic text-stone-700 mt-4 whitespace-pre-line leading-relaxed">{profile.bio}</p> : isOwnProfile && (
            <button onClick={() => setSheet('edit')} className="text-sm text-theme-accent font-semibold mt-4">Add a line about the wild things you love</button>
          )}
          <dl className="mt-5 grid grid-cols-4 border-y border-theme-primary/10 divide-x divide-theme-primary/10">
            <button onClick={() => setTab('lifelist')} className="py-3 text-center hover:bg-theme-primary/5"><dd className="text-xl font-display font-bold text-theme-primary tabular">{lifeList.length}</dd><dt className="text-xs text-stone-500">species</dt></button>
            <button onClick={() => setTab('posts')} className="py-3 text-center hover:bg-theme-primary/5"><dd className="text-xl font-display font-bold text-theme-primary tabular">{visiblePosts.length}</dd><dt className="text-xs text-stone-500">sightings</dt></button>
            <button onClick={() => setSheet('followers')} className="py-3 text-center hover:bg-theme-primary/5"><dd className="text-xl font-display font-bold text-theme-primary tabular">{profile?.followersCount || 0}</dd><dt className="text-xs text-stone-500">followers</dt></button>
            <button onClick={() => setSheet('following')} className="py-3 text-center hover:bg-theme-primary/5"><dd className="text-xl font-display font-bold text-theme-primary tabular">{profile?.followingCount || 0}</dd><dt className="text-xs text-stone-500">following</dt></button>
          </dl>
          <div className="flex gap-2 mt-4">
            {isOwnProfile ? (
              <>
                <button onClick={() => setSheet('edit')} className="flex-1 py-2.5 rounded-xl border border-theme-primary/15 hover:bg-theme-primary/5 text-sm font-bold text-theme-primary">Edit profile</button>
                <button onClick={onViewJournal} className="flex-1 py-2.5 rounded-xl border border-theme-primary/15 hover:bg-theme-primary/5 text-sm font-bold text-theme-primary flex items-center justify-center gap-1.5"><span className="material-symbols-outlined text-lg" aria-hidden="true">fingerprint</span>Journal</button>
                <button onClick={shareProfile} aria-label="Share profile" className="w-11 py-2.5 rounded-xl border border-theme-primary/15 hover:bg-theme-primary/5 text-theme-primary flex items-center justify-center"><span className="material-symbols-outlined text-xl" aria-hidden="true">share</span></button>
              </>
            ) : blocked ? (
              <button onClick={toggleBlock} className="flex-1 py-2.5 rounded-xl border border-theme-primary/15 text-sm font-bold text-theme-primary">Unblock</button>
            ) : (
              <>
                <button onClick={toggleFollow} disabled={followBusy} aria-pressed={following} className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${following ? 'border border-theme-primary/15 text-theme-primary hover:bg-theme-primary/5' : 'bg-theme-primary text-white hover:opacity-90'}`}>
                  {following ? 'Following' : 'Follow'}
                </button>
                <button onClick={() => onMessage?.(userId)} className="flex-1 py-2.5 rounded-xl border border-theme-primary/15 hover:bg-theme-primary/5 text-sm font-bold text-theme-primary flex items-center justify-center gap-1.5"><span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">mail</span>Write a letter</button>
                <button onClick={shareProfile} aria-label="Share profile" className="w-11 py-2.5 rounded-xl border border-theme-primary/15 hover:bg-theme-primary/5 text-theme-primary flex items-center justify-center"><span className="material-symbols-outlined text-xl" aria-hidden="true">share</span></button>
              </>
            )}
          </div>
          {isOwnProfile && needsVerification && (
            <div className="mt-4 p-3 rounded-xl bg-amber-50 text-amber-900 text-sm flex items-center gap-3">
              <span className="material-symbols-outlined" aria-hidden="true">mark_email_unread</span>
              <span className="flex-1">Verify your email to secure your account.</span>
              <button onClick={async () => { await FirebaseService.sendVerificationEmail(); showToast('Verification email sent'); }} className="font-bold">Send link</button>
            </div>
          )}
        </section>

        {blocked && !isOwnProfile ? (
          <p className="text-center text-stone-500 py-16 px-8">You've blocked this explorer. Unblock to see their posts.</p>
        ) : (
          <>
            <div role="tablist" aria-label="Profile sections" className="flex bg-day-bg/95 backdrop-blur border-b border-theme-primary/10 sticky top-0 z-10">
              {([
                { key: 'posts', icon: 'landscape', label: 'Sightings' },
                { key: 'lifelist', icon: 'eco', label: 'Life list' },
                ...(isOwnProfile ? [{ key: 'saved', icon: 'filter_vintage', label: 'Kept' }] : []),
              ] as { key: Tab; icon: string; label: string }[]).map(t => (
                <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`flex-1 py-3 flex items-center justify-center gap-1.5 text-sm border-b-2 transition-colors ${tab === t.key ? 'border-theme-accent text-theme-primary font-display italic font-bold text-[15px]' : 'border-transparent text-stone-500 font-semibold'}`}>
                  <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: tab === t.key ? "'FILL' 1" : "'wght' 300" }} aria-hidden="true">{t.icon}</span>{t.label}
                </button>
              ))}
            </div>

            {tab === 'posts' && (
              visiblePosts.length === 0 ? (
                <div className="text-center py-16 px-8 text-stone-500">
                  <span className="material-symbols-outlined text-5xl mb-3 text-theme-accent/60" style={{ fontVariationSettings: "'wght' 200" }} aria-hidden="true">camera</span>
                  <p className="font-display italic text-xl text-stone-800">{isOwnProfile ? 'Your first sighting is out there' : 'No public sightings yet'}</p>
                  {isOwnProfile && <p className="text-sm mt-1 max-w-xs mx-auto">Open the Lens and point it at anything alive. Your guide will tell you what it is and why it behaves that way.</p>}
                </div>
              ) : (
                <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3" role="list">
                  {visiblePosts.map(p => (
                    <li key={p.id} className="relative aspect-[4/5] bg-theme-primary/10 rounded-lg overflow-hidden border border-theme-primary/10">
                      <button onClick={() => onOpenPost?.(p.id)} className="group w-full h-full" aria-label={`Open ${p.labels?.[0] || 'sighting'}`}>
                        {(p.thumbnailUrl || p.imageUrl)
                          ? <img src={p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl!} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                          : <span className="w-full h-full flex items-center justify-center text-stone-400"><span className="material-symbols-outlined text-3xl" aria-hidden="true">{p.mediaType === 'audio' ? 'graphic_eq' : 'movie'}</span></span>}
                        {p.mediaType === 'video' && <span className="absolute top-1.5 right-1.5 material-symbols-outlined text-white text-lg drop-shadow" aria-hidden="true">play_circle</span>}
                        {p.items && p.items.length > 1 && <span className="absolute top-1.5 right-1.5 material-symbols-outlined text-white text-lg drop-shadow" aria-hidden="true">collections</span>}
                        {(p.labels?.[0] || p.title) && <span className="absolute inset-x-0 bottom-0 px-2.5 pt-6 pb-2 bg-gradient-to-t from-black/70 to-transparent text-left text-white text-[13px] font-display italic font-semibold leading-tight truncate">{p.labels?.[0] || p.title}</span>}
                        {isOwnProfile && !p.isPublic && <span className="absolute top-1.5 left-1.5 bg-black/60 text-white text-[11px] font-semibold rounded-full px-2 py-0.5 flex items-center gap-1"><span className="material-symbols-outlined text-xs" aria-hidden="true">lock</span>Journal</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}

            {tab === 'lifelist' && (
              lifeList.length === 0 ? (
                <p className="text-center text-stone-500 py-16 px-8 max-w-sm mx-auto">Every species {isOwnProfile ? 'you identify' : 'this explorer identifies'} is added here, with the day it was first seen.</p>
              ) : (
                <>
                <p className="px-5 pt-4 pb-2 text-sm font-display italic text-stone-600">{lifeListSummary(lifeList.length, lifeList[0]?.first, isOwnProfile)}</p>
                <ul className="divide-y divide-theme-primary/10" role="list">
                  {lifeList.map((s, i) => (
                    <li key={s.name}>
                      <button onClick={() => onOpenPost?.(s.postId)} className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-theme-primary/5">
                        <span className="w-8 text-sm text-stone-400 tabular">{i + 1}</span>
                        {s.thumb ? <img src={s.thumb} alt="" loading="lazy" className="w-12 h-12 rounded-xl object-cover bg-stone-100" /> : <span className="w-12 h-12 rounded-xl bg-stone-100" />}
                        <span className="flex-1 min-w-0">
                          <span className="block font-display italic font-semibold text-[17px] text-theme-primary truncate">{s.name}</span>
                          <span className="block text-xs text-stone-500">First seen {timeAgo(s.first)}{s.count > 1 ? ` · ${s.count} sightings` : ''}</span>
                        </span>
                        <span className="material-symbols-outlined text-stone-300" aria-hidden="true">chevron_right</span>
                      </button>
                    </li>
                  ))}
                </ul>
                </>
              )
            )}

            {tab === 'saved' && isOwnProfile && (
              saved === null ? <p className="text-center text-stone-500 py-12">Loading…</p> :
              saved.length === 0 ? (
                <p className="text-center text-stone-500 py-16 px-8 max-w-sm mx-auto">Tap Keep on any sighting you want to come back to. Only you can see what you've kept.</p>
              ) : (
                <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3" role="list">
                  {saved.map(s => (
                    <li key={s.id} className="aspect-[4/5] bg-theme-primary/10 rounded-lg overflow-hidden border border-theme-primary/10">
                      <button onClick={() => onOpenPost?.(s.id)} className="w-full h-full" aria-label={`Open kept ${s.label || 'sighting'}`}>
                        {s.thumbnailUrl && <img src={s.thumbnailUrl} alt="" loading="lazy" className="w-full h-full object-cover" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </>
        )}
      </main>

      {sheet === 'edit' && <EditProfileSheet profile={profile} onClose={() => setSheet(null)} onSaved={(m) => { setSheet(null); showToast(m); }} />}

      {(sheet === 'followers' || sheet === 'following') && (
        <Sheet title={sheet === 'followers' ? 'Followers' : 'Following'} onClose={() => setSheet(null)}>
          {people === null ? <p className="text-stone-500 text-center py-6">Loading…</p> :
            people.length === 0 ? <p className="text-stone-500 text-center py-6">{sheet === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</p> : (
              <ul className="space-y-1" role="list">
                {people.map(p => (
                  <li key={p.uid}>
                    <button onClick={() => { setSheet(null); onViewProfile?.(p.uid); }} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-stone-50 text-left">
                      <Avatar url={p.avatarUrl} name={p.username} size={44} />
                      <span className="flex-1 min-w-0"><span className="block font-semibold text-stone-900 truncate">{p.username}</span>{p.bio && <span className="block text-xs text-stone-500 truncate">{p.bio}</span>}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </Sheet>
      )}

      {sheet === 'menu' && !isOwnProfile && (
        <Sheet title={username} onClose={() => setSheet(null)}>
          <div className="flex flex-col gap-1">
            <button onClick={shareProfile} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">ios_share</span>Share profile</button>
            {currentUserId && !isAnonymous && (
              <button onClick={toggleBlock} className="text-left p-3 rounded-xl hover:bg-red-50 font-semibold text-red-700 flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">block</span>{blocked ? 'Unblock' : 'Block'} {username}</button>
            )}
          </div>
        </Sheet>
      )}

      {sheet === 'settings' && isOwnProfile && (
        <Sheet title="Settings" onClose={() => setSheet(null)}>
          <nav className="flex flex-col gap-1" aria-label="Account settings">
            <button onClick={() => setSheet('edit')} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">edit</span>Edit profile</button>
            <button onClick={() => { setSheet(null); setPersonaOpen(true); }} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">psychology</span><span className="flex-1">Naturalist persona<span className="block text-xs font-normal text-stone-500">{profile?.naturalistPersona?.archetype || 'Personalise your feed and guide'}</span></span></button>
            {pushSupported() && <PushToggle onToast={showToast} />}
            <button onClick={downloadData} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">download</span>Download my data</button>
            {isAdmin && onAdminConsole && (
              <button onClick={() => { setSheet(null); onAdminConsole(); }} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">admin_panel_settings</span>Admin console</button>
            )}
            {!isAdmin && onAdminConsole && auth.currentUser?.email === 'ram@iitj.ac.in' && (
              <button onClick={() => { setSheet(null); onAdminConsole(); }} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">admin_panel_settings</span>Admin console (verify email)</button>
            )}
            <a href="/privacy.html" target="_blank" rel="noopener" className="p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">shield</span>Privacy policy</a>
            <a href="/terms.html" target="_blank" rel="noopener" className="p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">description</span>Terms & community guidelines</a>
            <hr className="my-2 border-stone-100" />
            <button onClick={() => { setSheet(null); onSignOut(); }} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">logout</span>Log out</button>
            <button onClick={() => setSheet('delete')} className="text-left p-3 rounded-xl hover:bg-red-50 font-semibold text-red-700 flex items-center gap-3"><span className="material-symbols-outlined" aria-hidden="true">delete_forever</span>Delete account</button>
          </nav>
        </Sheet>
      )}

      {isOwnProfile && (
        <NaturalistPersonaModal
          userId={userId}
          initialPersona={profile?.naturalistPersona}
          isOpen={personaOpen}
          onClose={() => setPersonaOpen(false)}
          onSave={(updated: any) => { setProfile(prev => prev ? { ...prev, naturalistPersona: updated } : prev); setPersonaOpen(false); showToast('Persona saved'); }}
        />
      )}

      {sheet === 'delete' && <DeleteAccountSheet username={username} onClose={() => setSheet(null)} onDeleted={onSignOut} />}

      {toast && <div role="status" className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[130] bg-stone-900 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg animate-fade-in">{toast}</div>}
    </div>
  );
};

const PushToggle: React.FC<{ onToast: (m: string) => void }> = ({ onToast }) => {
  const [on, setOn] = useState(pushEnabled());
  const toggle = async () => {
    if (on) { disablePush(); setOn(false); onToast('Notifications turned off'); return; }
    const r = await enablePush();
    if (r === 'granted') { setOn(true); onToast('Notifications on'); }
    else if (r === 'denied') onToast('Notifications are blocked in your browser settings');
    else onToast('This browser does not support notifications');
  };
  return (
    <button role="switch" aria-checked={on} onClick={toggle} className="text-left p-3 rounded-xl hover:bg-stone-50 font-semibold flex items-center gap-3">
      <span className="material-symbols-outlined" aria-hidden="true">notifications</span>
      <span className="flex-1">Notifications<span className="block text-xs font-normal text-stone-500">When explorers marvel, leave field notes, follow or mention you</span></span>
      <span className={`w-11 h-6 rounded-full relative transition-colors ${on ? 'bg-theme-accent' : 'bg-stone-300'}`} aria-hidden="true"><span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} /></span>
    </button>
  );
};

const EditProfileSheet: React.FC<{ profile: UserProfileData | null; onClose: () => void; onSaved: (msg: string) => void }> = ({ profile, onClose, onSaved }) => {
  const [username, setUsername] = useState(profile?.username || '');
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); }, [avatarPreview]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (avatarFile) await FirebaseService.uploadAvatar(avatarFile);
      await FirebaseService.updateMyProfile({ username, bio, displayName });
      onSaved('Profile updated');
    } catch (err: any) {
      setError(err?.message?.includes('Usernames') ? err.message : 'Could not save your profile. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <Sheet title="Edit profile" onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <Avatar url={avatarPreview || profile?.avatarUrl} name={username} size={96} />
          <button type="button" onClick={() => fileRef.current?.click()} className="text-sm font-bold text-theme-accent">Change photo</button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => {
            const f = e.target.files?.[0];
            if (f) { setAvatarFile(f); setAvatarPreview(URL.createObjectURL(f)); }
          }} />
        </div>
        <label className="block">
          <span className="block text-sm font-semibold text-stone-700 mb-1.5">Name</span>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={60} autoComplete="name" className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-base" />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold text-stone-700 mb-1.5">Username</span>
          <input value={username} onChange={e => setUsername(e.target.value)} maxLength={30} required minLength={3} pattern="[a-zA-Z0-9_.]{3,30}" autoComplete="username" className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-base" />
          <span className="block text-xs text-stone-500 mt-1">Letters, numbers, dots and underscores.</span>
        </label>
        <label className="block">
          <span className="block text-sm font-semibold text-stone-700 mb-1.5">Bio</span>
          <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={300} rows={3} placeholder="Birder in the Thar desert. Moth enthusiast." className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-base resize-none" />
          <span className="block text-xs text-stone-500 mt-1 text-right">{bio.length}/300</span>
        </label>
        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 p-3 rounded-xl">{error}</p>}
        <button type="submit" disabled={busy} className="w-full py-3.5 rounded-xl bg-stone-900 text-white font-bold disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Sheet>
  );
};

const DeleteAccountSheet: React.FC<{ username: string; onClose: () => void; onDeleted: () => void }> = ({ username, onClose, onDeleted }) => {
  const [confirmText, setConfirmText] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const busy = !!progress && !error;

  const run = async () => {
    setError('');
    try {
      await FirebaseService.deleteMyAccount(setProgress);
      onDeleted();
    } catch (e: any) {
      if (e?.code === 'auth/requires-recent-login') {
        setNeedsReauth(true);
        setError('For your security, please log in again, then delete your account.');
      } else {
        setError('Deletion could not finish. Please try again. Anything already removed stays removed.');
      }
      setProgress('');
    }
  };

  return (
    <Sheet title="Delete account" onClose={busy ? () => {} : onClose}>
      {needsReauth ? (
        <AuthModal inline initialIsSignUp={false} reason="Log in again to confirm it's you." onSuccess={() => { setNeedsReauth(false); setError(''); run(); }} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-stone-700 leading-relaxed">This permanently deletes <strong>{username}</strong>: your profile, every post and its media, comments, likes, follows, drafts and private records. <strong>This cannot be undone.</strong></p>
          <p className="text-sm text-stone-600">Tip: download your data first from Settings.</p>
          <label className="block">
            <span className="block text-sm font-semibold text-stone-700 mb-1.5">Type DELETE to confirm</span>
            <input value={confirmText} onChange={e => setConfirmText(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-base" autoCapitalize="characters" />
          </label>
          {progress && <p role="status" className="text-sm text-stone-700">{progress}</p>}
          {error && <p role="alert" className="text-sm text-red-700 bg-red-50 p-3 rounded-xl">{error}</p>}
          <button onClick={run} disabled={confirmText !== 'DELETE' || busy} className="w-full py-3.5 rounded-xl bg-red-700 text-white font-bold disabled:opacity-40">{busy ? 'Deleting…' : 'Permanently delete my account'}</button>
        </div>
      )}
    </Sheet>
  );
};

export default UserProfile;
