import { apiUrl } from './apiOrigin';
import { appCheckHeaders } from './appCheck';
import { searchTokensFor, queryTokens, sameTokens } from './searchTokens';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  startAt,
  endAt,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  increment,
  writeBatch,
  deleteField,
  collectionGroup,
  Timestamp,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  listAll,
  deleteObject,
} from "firebase/storage";
import {
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  deleteUser,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  linkWithCredential,
  EmailAuthProvider,
} from "firebase/auth";
import { auth, db, storage } from "../firebaseConfig";
import { GeminiConfig, CommunityPost, Snapshot, Comment, NaturalistMemory, UserProfileData, FieldNotification, ExpeditionDraft, NaturalistPersona, Conversation, DirectMessage } from "../types";
import { SYSTEM_INSTRUCTION } from "../constants/prompts";
import { generateThumbnail, reencodeImage } from "../utils";
import { clipStill, imagePreview, isLqip, isTint, mediaPathsOf, ClipStill, MediaPreview } from "./mediaPreview";

export const AI_CLIENT_POLICY_VERSION = "2026.11-1";
const PAGE_SIZE = 18;
const SEED_AUTHORS = ['Jane Goodall', 'Dian Fossey', 'Charles Darwin', 'David Attenborough', 'Jacques-Yves Cousteau'];
/** Legacy demo posts attributed to real naturalists: never shown as genuine observations. */
const isSeedPost = (id: string, data: any) => id.startsWith('seed_') || String(data?.userId || '').startsWith('system_seeder_') || SEED_AUTHORS.includes(data?.userName);
export const ADMIN_EMAIL = "ram@iitj.ac.in";
import { NATURALIST_THEMES } from "../constants/naturalists";

import { DailyTheme } from "./themeService";
import { looksLikeSpam } from '../utils';
import { isTeenProfile } from './guardian';

/** A sighting the server held back, with words the explorer can act on. */
export class PublishError extends Error {
  constructor(message: string, public readonly code: string, public readonly details: { reasons?: string[]; fix?: string; canRequestReview?: boolean } = {}) {
    super(message);
  }
}

// Muted explorers of the signed-in account (users/{me}/muted/{uid}), cached for filtering lists
let mutedCache: { uid: string | null; ids: Set<string>; at: number; loading: Promise<Set<string>> | null } = { uid: null, ids: new Set(), at: 0, loading: null };
const mutedListeners = new Set<() => void>();
const loadMuted = (force = false): Promise<Set<string>> => {
  const me = auth.currentUser?.uid || null;
  if (!me) { mutedCache = { uid: null, ids: new Set(), at: Date.now(), loading: null }; return Promise.resolve(mutedCache.ids); }
  if (!force && mutedCache.uid === me && Date.now() - mutedCache.at < 5 * 60_000) return Promise.resolve(mutedCache.ids);
  if (mutedCache.loading && mutedCache.uid === me) return mutedCache.loading;
  const loading = getDocs(collection(db, 'users', me, 'muted'))
    .then(snap => new Set(snap.docs.map(d => d.id)))
    .catch(() => new Set<string>())
    .then(ids => { mutedCache = { uid: me, ids, at: Date.now(), loading: null }; mutedListeners.forEach(l => l()); return ids; });
  mutedCache = { ...mutedCache, uid: me, loading };
  return loading;
};
/** Synchronous view of the muted set (may be empty until the first load finishes). */
const mutedNow = () => (mutedCache.uid && mutedCache.uid === auth.currentUser?.uid ? mutedCache.ids : new Set<string>());
const withoutMuted = <T extends { userId?: string; senderId?: string }>(list: T[], muted: Set<string> = mutedNow()): T[] =>
  muted.size ? list.filter(x => !muted.has(String(x.userId || x.senderId || ''))) : list;

/**
 * Teen mode: a teenage explorer isn't suggested in search or explorer lists to people who don't
 * follow them (or to anyone at all before a parent has said yes). Their own account and their
 * parent still find them.
 */
const withoutUnfollowedTeens = async (list: UserProfileData[]): Promise<UserProfileData[]> => {
  const me = auth.currentUser?.uid;
  const teens = list.filter(u => isTeenProfile(u) && u.uid !== me && u.guardian?.parentUid !== me);
  if (!teens.length) return list;
  if (!me) return list.filter(u => !teens.includes(u));
  const followed = new Set((await Promise.all(teens.map(async u => {
    if (u.guardian?.status !== 'approved') return null;
    try { return (await getDoc(doc(db, 'users', me, 'following', u.uid))).exists() ? u.uid : null; } catch { return null; }
  }))).filter(Boolean) as string[]);
  return list.filter(u => !teens.includes(u) || followed.has(u.uid));
};

/** What an explorer has left today (same allowance for everyone, set by the admin). */
export const getMyAllowance = async (): Promise<null | { posts: { limit: number; used: number }; liveMinutes: { limit: number; used: number; usedMs?: number }; identifications: { limit: number; used: number }; resetsAt: string }> => {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return null;
    const res = await fetch(apiUrl('/api/me/allowance'), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const j = await res.json();
    return j.available ? j : null;
  } catch { return null; }
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // Removed throw new Error to prevent React app crashes on silent background failures
}


export const getCorsProxyUrl = (url: string) => {
  if (!url) return url;
  if (url.startsWith('http') && url.includes('firebasestorage.googleapis.com')) {
    return apiUrl(`/api/media-proxy?url=${encodeURIComponent(url)}`);
  }
  return url;
};

const DEFAULT_CONFIG: GeminiConfig = {
  model: 'gemini-2.5-flash-native-audio-latest',
  systemInstruction: SYSTEM_INSTRUCTION,
  knowledgeBaseFiles: [],
  trainingExamples: []
};

/**
 * Ask the server to send NatureGram's own account letter (server/authMail.js). 'fallback' means
 * use Firebase's built-in email instead: no mail provider, no link permission, or no server at all.
 */
const brandedAuthMail = async (path: string, body: object, token?: string): Promise<'sent' | 'limited' | 'fallback'> => {
  try {
    const res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (res.status === 429) return 'limited';
    if (!res.ok) return 'fallback';
    const j = await res.json().catch(() => ({}));
    return j.sent ? 'sent' : j.verified ? 'sent' : 'fallback';
  } catch { return 'fallback'; }
};

/**
 * The feed's first tiles, inlined into the page by the server (<script id="ng-first">, see
 * server/media.js). Read synchronously so the first screen paints before any request. They are
 * parsed once and kept until the feed has its real first page (releaseFirstTiles); after that,
 * visits to the feed load normally. Empty when the page carries none.
 */
let firstTiles: CommunityPost[] | null = null;
export const peekFirstTiles = (): CommunityPost[] => {
  if (firstTiles) return firstTiles;
  firstTiles = [];
  if (typeof document === 'undefined') return firstTiles;
  try {
    const el = document.getElementById('ng-first');
    if (!el?.textContent) return firstTiles;
    const j = JSON.parse(el.textContent);
    el.remove();
    // Very old pages (a tab restored hours later) wait for the network instead
    if (!Array.isArray(j?.posts) || (typeof j.at === 'number' && Date.now() - j.at > 60 * 60_000)) return firstTiles;
    firstTiles = withoutMuted(j.posts
      .filter((p: any) => p && typeof p.id === 'string' && !isSeedPost(p.id, p))
      .map((p: any) => ({
        likes: [], tags: [], commentCount: 0, isPublic: true, thumbnailUrl: '', ...p,
        labels: Array.isArray(p.labels) && p.labels.length ? p.labels : (p.title ? [p.title] : ['Nature']),
        timestamp: Timestamp.fromMillis(p.ts || 0),
      }))) as CommunityPost[];
  } catch { /* malformed: load from the network */ }
  return firstTiles;
};
export const releaseFirstTiles = () => { firstTiles = []; };

export const FirebaseService = {
  getUserProfile: async (userId: string): Promise<UserProfileData | null> => {
    try {
      const docRef = doc(db, "users", userId);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? docSnap.data() as UserProfileData : null;
    } catch (e) { return null; }
  },

  getAllUsers: async (): Promise<UserProfileData[]> => {
    try {
      const snap = await getDocs(collection(db, "users"));
      return await withoutUnfollowedTeens(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfileData)));
    } catch (e) {
      console.error("Error fetching all users:", e);
      return [];
    }
  },

  getAllPosts: async (): Promise<CommunityPost[]> => {
    try {
      const snap = await getDocs(collection(db, "ecosystem_feed"));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as CommunityPost));
    } catch (e) {
      console.error("Error fetching all posts:", e);
      return [];
    }
  },

  subscribeToUserProfile: (userId: string, callback: (profile: UserProfileData | null) => void) => {
    const docRef = doc(db, "users", userId);
    return onSnapshot(docRef, (docSnap) => {
      callback(docSnap.exists() ? docSnap.data() as UserProfileData : null);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${userId}`);
    });
  },

  /** @param atCreation fields set only if the profile is being created now (e.g. the age band at sign-up) */
  ensureUserProfile: async (userId: string, email?: string | null, isAnonymous: boolean = false, atCreation: Record<string, any> = {}) => {
    const docRef = doc(db, "users", userId);
    try {
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        const username = (email && email !== "Anonymous" ? email.split('@')[0] : `Explorer-${userId.slice(0, 4)}`).slice(0, 30);
        const profile: any = {
          uid: userId,
          username,
          usernameLower: username.toLowerCase(),
          isAnonymous,
          joinedAt: serverTimestamp(),
          lastVisit: serverTimestamp(),
          stats: { observations: 0, species: 0 },
          ...atCreation,
        };
        try {
          await setDoc(docRef, profile);
          if (auth.currentUser && !auth.currentUser.displayName) {
            await updateProfile(auth.currentUser, { displayName: username });
          }
        } catch (setErr) {
          console.warn("Failed to set initial user profile in ensureUserProfile:", setErr);
        }
        return profile;
      } else {
        // update last visit and location if anonymous
        const data = docSnap.data();
        const updates: any = { lastVisit: serverTimestamp() };
        if (data.isAnonymous && !isAnonymous) updates.isAnonymous = false;
        // Backfill the search key for existing accounts on their next visit (no data rewritten)
        if (data.username && !data.usernameLower) updates.usernameLower = String(data.username).toLowerCase();
        try {
          await updateDoc(docRef, updates);
        } catch (updErr) {
          console.warn("Failed to update user profile in ensureUserProfile:", updErr);
        }
        return { ...data, ...updates } as UserProfileData;
      }
    } catch (e) {
      console.warn("Failed to retrieve user profile in ensureUserProfile:", e);
      const username = (email && email !== "Anonymous" ? email.split('@')[0] : `Explorer-${userId.slice(0, 4)}`).slice(0, 30);
      return {
        uid: userId,
        username,
        isAnonymous,
        stats: { observations: 0, species: 0 }
      } as any;
    }
  },

  updateNaturalistPersona: async (userId: string, persona: NaturalistPersona) => {
    if (!userId || userId === 'explorer_guest' || auth.currentUser?.uid !== userId) return;
    const clean: NaturalistPersona = {
      archetype: String(persona.archetype || '').slice(0, 80),
      taxaInterests: (persona.taxaInterests || []).slice(0, 20).map(x => String(x).slice(0, 60)),
      observationStyles: (persona.observationStyles || []).slice(0, 20).map(x => String(x).slice(0, 60)),
      habitatAffinities: (persona.habitatAffinities || []).slice(0, 20).map(x => String(x).slice(0, 60)),
      customFocus: String(persona.customFocus || '').slice(0, 500),
      curatorPrompt: String(persona.curatorPrompt || '').slice(0, 500),
    };
    try {
      await setDoc(doc(db, "users", userId), { naturalistPersona: { ...clean, updatedAt: serverTimestamp() } }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}`);
    }
  },

  getNaturalistMemory: async (userId: string): Promise<NaturalistMemory | null> => {
    try {
      const docRef = doc(db, "naturalist_memories", userId);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? docSnap.data() as NaturalistMemory : null;
    } catch (e) { return null; }
  },

  updateNaturalistMemory: async (userId: string, memory: Partial<NaturalistMemory>) => {
    const docRef = doc(db, "naturalist_memories", userId);
    await setDoc(docRef, memory, { merge: true });
  },

  getCurrentUserId: () => {
    return auth.currentUser?.uid;
  },

  isCurrentUserAnonymous: () => {
    return auth.currentUser?.isAnonymous ?? true;
  },

  subscribeToAuthChanges: (callback: (user: any) => void) => {
    return onAuthStateChanged(auth, callback);
  },

  loginAnonymous: async () => {
    const cred = await signInAnonymously(auth);
    try {
        await FirebaseService.ensureUserProfile(cred.user.uid, "Anonymous", true);
    } catch (err) {
        console.warn("Silent profile creation error caught during loginAnonymous:", err);
    }
    return cred;
  },

  /**
   * @param opts.ageConfirmed  the explorer passed the 13+ check at sign-up. Only the fact and the
   *   time are stored (never the date of birth).
   * @param opts.ageBand  'teen' (13 to 17, with adultFrom: the first day of the month they turn 18)
   *   or 'adult'. Set once; the rules refuse later changes.
   */
  registerUser: async (email: string, pass: string, username?: string, opts: { ageConfirmed?: boolean; ageBand?: 'teen' | 'adult'; adultFrom?: Timestamp } = {}) => {
    // Upgrade a guest session in place so the explorer keeps the same identity
    const current = auth.currentUser;
    const cred = current && current.isAnonymous
      ? await linkWithCredential(current, EmailAuthProvider.credential(email, pass))
      : await createUserWithEmailAndPassword(auth, email, pass);
    try {
        const band: Record<string, any> = opts.ageBand ? { ageBand: opts.ageBand, ...(opts.ageBand === 'teen' && opts.adultFrom ? { adultFrom: opts.adultFrom } : {}) } : {};
        const existing: any = await FirebaseService.ensureUserProfile(cred.user.uid, email, false, band);
        const desired = (username || '').trim().replace(/[^a-zA-Z0-9_.]/g, '').slice(0, 30);
        // A guest upgrading already has a profile: the band is added to it once
        const updates: any = { isAnonymous: false, ...(existing?.ageBand ? {} : band) };
        if (opts.ageConfirmed) { updates.ageConfirmed = true; updates.ageConfirmedAt = serverTimestamp(); }
        if (desired) { updates.username = desired; updates.usernameLower = desired.toLowerCase(); }
        await updateDoc(doc(db, "users", cred.user.uid), updates);
        if (desired) await updateProfile(cred.user, { displayName: desired });
        else if (!cred.user.displayName) await updateProfile(cred.user, { displayName: email.split('@')[0].slice(0, 30) });
        FirebaseService.sendVerificationEmail().catch(() => {});
    } catch (err) {
        console.warn("Profile setup after registration failed:", err);
    }
    return cred;
  },

  sendPasswordReset: async (email: string) => {
    // NatureGram's own letter first; Firebase's email when the server can't send one
    const r = await brandedAuthMail('/api/auth/send-reset', { email });
    if (r === 'sent') return;
    if (r === 'limited') throw Object.assign(new Error('Too many requests'), { code: 'auth/too-many-requests' });
    await sendPasswordResetEmail(auth, email, { url: apiUrl('/feed') })
      .catch((e) => /continue-uri|domain/.test(e?.code || '') ? sendPasswordResetEmail(auth, email) : Promise.reject(e));
  },

  loginUser: async (email: string, pass: string) => {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    try {
        await FirebaseService.ensureUserProfile(cred.user.uid, email, false);
    } catch (err) {
        console.warn("Silent profile creation error caught during loginUser:", err);
    }
    return cred;
  },

  logout: async () => {
    return await signOut(auth);
  },

  deleteUserAccount: async () => {
    const user = auth.currentUser;
    if (user) {
      return await deleteUser(user);
    }
    throw new Error("No user is currently signed in to delete.");
  },

  getGeminiConfig: async (): Promise<GeminiConfig> => {
    try {
      const docRef = doc(db, "admin_config", "gemini_state");
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data() as GeminiConfig;
        // The server pins the actual Live model; this is only a requested preference.
        if (data.model && (data.model.includes('gemini-2.5-flash-native') || data.model === 'gemini-2.0-flash')) {
          data.model = 'gemini-2.5-flash-native-audio-latest';
        }
        return { ...DEFAULT_CONFIG, ...data };
      }
      return DEFAULT_CONFIG;
    } catch (e) {
      return DEFAULT_CONFIG;
    }
  },

  updateGeminiConfig: async (config: Partial<GeminiConfig>) => {
    const docRef = doc(db, "admin_config", "gemini_state");
    await setDoc(docRef, config, { merge: true });
  },

  /** Admin: save live-guide config with an audit trail entry (who, when, why, previous text). */
  updateGeminiConfigAudited: async (config: GeminiConfig, changeNote: string) => {
    const ref0 = doc(db, "admin_config", "gemini_state");
    const prev = await getDoc(ref0);
    await setDoc(doc(db, "admin_config", `gemini_history_${Date.now()}`), {
      changedBy: auth.currentUser?.email || auth.currentUser?.uid || 'unknown',
      changedAt: serverTimestamp(),
      changeNote: changeNote.slice(0, 200),
      previous: prev.exists() ? prev.data() : null,
    });
    await setDoc(ref0, { ...config, updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email || null, changeNote: changeNote.slice(0, 200) }, { merge: true });
  },

  getDailyTheme: async (dateStr: string): Promise<DailyTheme | null> => {
    try {
      const docRef = doc(db, "daily_themes", dateStr);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data() as DailyTheme;
      }
      return null;
    } catch (e) {
      console.error("Error fetching daily theme:", e);
      return null;
    }
  },

  saveDailyTheme: async (dateStr: string, theme: DailyTheme) => {
    try {
      const docRef = doc(db, "daily_themes", dateStr);
      await setDoc(docRef, theme);
    } catch (e) {
      console.error("Error saving daily theme:", e);
    }
  },

  saveDraft: async (userId: string, inputSnapshots: Snapshot[], summary: string, existingDraftId?: string) => {
    // Media blobs can't live in Firestore: upload them to the owner's private drafts folder first,
    // otherwise drafts would lose their photos/videos/sounds after a reload.
    const canUpload = !!auth.currentUser && !auth.currentUser.isAnonymous && userId === auth.currentUser.uid;
    const persistBlob = async (b: Blob | undefined, kind: 'image' | 'video' | 'audio', fallback?: string) => {
      if (b && canUpload) {
        try { return await FirebaseService.uploadMedia(b, userId, kind, `drafts/${userId}`); } catch (e) { console.warn('Draft media upload failed', e); }
      }
      return fallback && !fallback.startsWith('blob:') ? fallback : '';
    };
    const snapshots: Snapshot[] = await Promise.all(inputSnapshots.map(async (s) => ({
      ...s,
      url: await persistBlob(s.blob, 'image', s.url),
      videoUrl: await persistBlob(s.videoBlob, 'video', s.videoUrl),
      audioUrl: await persistBlob(s.audioBlob, 'audio', s.audioUrl),
      associatedImages: s.associatedImages ? await Promise.all(s.associatedImages.map(async img => ({ url: await persistBlob(img.blob, 'image', img.url) }))) : undefined,
    })));
    // Strip Blobs and non-serializable properties before storing (otherwise setDoc throws)
    const cleanSnapshots = snapshots.map(s => {
      const cleanImg = s.associatedImages ? s.associatedImages.map(img => ({
        url: img.url || null
      })) : null;
      return {
        id: s.id,
        url: s.url || '',
        videoUrl: s.videoUrl || '',
        audioUrl: s.audioUrl || '',
        timestamp: s.timestamp || '',
        labels: s.labels || [],
        behavior: s.behavior || '',
        aiInsight: s.aiInsight || '',
        type: s.type || 'image',
        userId: s.userId || '',
        isHybrid: !!s.isHybrid,
        location: s.location || '',
        locationArea: s.locationArea || '',
        rotation: s.rotation || 0,
        associatedImages: cleanImg,
        aiProposedLabels: s.aiProposedLabels || null,
        aiConfidence: s.aiConfidence || null,
        showLocation: (s as any).showLocation ?? null,
        rawLocation: s.rawLocation || null,
      };
    });

    try {
      if (userId && userId !== 'explorer_guest' && auth.currentUser && auth.currentUser.uid === userId) {
        const draftRef = (existingDraftId && !existingDraftId.startsWith('local_'))
          ? doc(db, "users", userId, "drafts", existingDraftId)
          : doc(collection(db, "users", userId, "drafts"));
        const draftData = {
          userId,
          snapshots: cleanSnapshots,
          summary,
          timestamp: serverTimestamp()
        };
        await setDoc(draftRef, draftData);
        return draftRef.id;
      }
    } catch (e) {
      console.warn("Firestore saveDraft failed:", e);
      handleFirestoreError(e, OperationType.WRITE, `users/${userId}/drafts`);
    }

    // LocalStorage Fallback just in case
    try {
      const localDrafts = JSON.parse(localStorage.getItem(`drafts_${userId}`) || "[]");
      const draftIdToUse = existingDraftId || "local_" + Date.now();
      const newDraft = {
        id: draftIdToUse,
        userId,
        snapshots: cleanSnapshots,
        summary,
        timestamp: { toDate: () => new Date() }
      };
      const filtered = localDrafts.filter((d: any) => d.id !== draftIdToUse);
      filtered.unshift(newDraft);
      localStorage.setItem(`drafts_${userId}`, JSON.stringify(filtered));
      return draftIdToUse;
    } catch (err) {
      console.error("Local draft saving failed:", err);
      return "local_temp";
    }
  },

  getDrafts: async (userId: string): Promise<ExpeditionDraft[]> => {
    let firestoreDrafts: ExpeditionDraft[] = [];
    try {
      if (userId && userId !== 'explorer_guest' && auth.currentUser && auth.currentUser.uid === userId) {
        const q = query(collection(db, "users", userId, "drafts"), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);
        firestoreDrafts = snap.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            timestamp: data.timestamp
          } as ExpeditionDraft;
        });
      }
    } catch (e) {
      console.warn("Firestore getDrafts failed:", e);
      handleFirestoreError(e, OperationType.GET, `users/${userId}/drafts`);
    }

    // Load from local drafts
    let formattedLocal: ExpeditionDraft[] = [];
    try {
      const localDrafts = JSON.parse(localStorage.getItem(`drafts_${userId}`) || "[]");
      formattedLocal = localDrafts.map((d: any) => ({
        ...d,
        timestamp: {
          toDate: () => new Date(d.timestamp?.seconds ? d.timestamp.seconds * 1000 : (typeof d.timestamp === 'string' ? d.timestamp : Date.now()))
        }
      }));
    } catch (err) {
      console.error("Local getDrafts parsing failed", err);
    }

    return [...formattedLocal, ...firestoreDrafts];
  },

  deleteDraft: async (userId: string, draftId: string) => {
    if (draftId && draftId.startsWith("local_")) {
      try {
        const localDrafts = JSON.parse(localStorage.getItem(`drafts_${userId}`) || "[]");
        const updated = localDrafts.filter((d: any) => d.id !== draftId);
        localStorage.setItem(`drafts_${userId}`, JSON.stringify(updated));
      } catch (err) {
        console.error("Local deleteDraft failed", err);
      }
      return;
    }

    try {
      if (userId && userId !== 'explorer_guest' && auth.currentUser && auth.currentUser.uid === userId) {
        await deleteDoc(doc(db, "users", userId, "drafts", draftId));
      }
    } catch (e) {
      console.warn("Firestore deleteDraft failed:", e);
      handleFirestoreError(e, OperationType.DELETE, `users/${userId}/drafts/${draftId}`);
    }
  },

  uploadMedia: async (data: Blob | string, userId: string, type: 'image' | 'video' | 'audio', folderOverride?: string): Promise<string> => {
    let blob: Blob;
    if (typeof data === 'string') {
        // Already-hosted media: reuse it instead of re-uploading
        if (/^https:\/\/firebasestorage\.googleapis\.com\//.test(data)) return data;
        const response = await fetch(getCorsProxyUrl(data));
        blob = await response.blob();
    } else { blob = data; }

    // Privacy: strip EXIF/GPS from every still image before it leaves the device
    if (type === 'image') blob = await reencodeImage(blob);

    const mime = blob.type || (type === 'image' ? 'image/jpeg' : type === 'audio' ? 'audio/webm' : 'video/webm');
    let ext = 'jpg';
    if (type === 'video') ext = mime.includes('mp4') ? 'mp4' : 'webm';
    else if (type === 'audio') ext = mime.includes('mp4') ? 'm4a' : 'webm';
    else if (mime.includes('png')) ext = 'png';
    else if (mime.includes('webp')) ext = 'webp';

    const folder = folderOverride || (type === 'image' ? 'snapshots' : (type === 'audio' ? 'audio' : 'videos'));
    const filename = `${folder}/${userId}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    const storageRef = ref(storage, filename);
    // Immutable, CDN-cacheable media (file names are unique per upload)
    await uploadBytes(storageRef, blob, { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' });
    return await getDownloadURL(storageRef);
  },

  /**
   * Uploads all media for one snapshot and returns the public item (no precise location).
   * Also makes the tile's preview on the device: a blurred 16 px preview, main colour and size for
   * every picture, and for a clip a still frame (uploaded as its thumbnail) and whether it is sound
   * only. None of that can fail or hold up the upload.
   */
  uploadSnapshotItem: async (snapshot: Snapshot, uid: string) => {
      let imageUrl: string | null = null;
      let thumbnailUrl: string | null = null;
      let originalImageUrl: string | null = null;
      let thumbSmallUrl: string | null = null;
      let preview: MediaPreview | null = null;
      let soundOnly = false;
      const uploadSource = snapshot.blob || snapshot.url;
      const isVideo = snapshot.type === 'video';
      // The clip uploads while its still is taken
      const videoUpload = snapshot.videoBlob ? FirebaseService.uploadMedia(snapshot.videoBlob, uid, 'video') : null;
      videoUpload?.catch(() => {});
      const still: Promise<ClipStill | null> = isVideo && snapshot.videoBlob ? clipStill(snapshot.videoBlob).catch(() => null) : Promise.resolve(null);
      if (uploadSource) {
          if (snapshot.blob && snapshot.type === 'image') {
              originalImageUrl = await FirebaseService.uploadMedia(snapshot.blob, uid, 'image');
              const [thumbBlob, smallBlob, pv] = await Promise.all([generateThumbnail(snapshot.blob, 800), generateThumbnail(snapshot.blob, 400), imagePreview(snapshot.blob).catch(() => null)]);
              [thumbnailUrl, thumbSmallUrl] = await Promise.all([
                FirebaseService.uploadMedia(thumbBlob, uid, 'image'),
                FirebaseService.uploadMedia(smallBlob, uid, 'image'),
              ]);
              imageUrl = thumbnailUrl;
              preview = pv;
          } else {
              imageUrl = await FirebaseService.uploadMedia(uploadSource, uid, 'image');
              // A sound's habitat photo: its preview paints the sound tile
              if (!isVideo && snapshot.blob) preview = await imagePreview(snapshot.blob).catch(() => null);
          }
      }
      if (isVideo) {
          try {
              const grab = await still;
              if (grab?.soundOnly) soundOnly = true;
              // The clip's own frame, else the camera still taken with it (live lens)
              const posterBlob = grab?.poster || (snapshot.blob && snapshot.blob.type.startsWith('image/') ? snapshot.blob : null);
              if (posterBlob && !soundOnly) {
                  const [big, small] = await Promise.all([reencodeImage(posterBlob, 800, 'image/jpeg', 0.82), reencodeImage(posterBlob, 400, 'image/jpeg', 0.8)]);
                  [thumbnailUrl, thumbSmallUrl] = await Promise.all([
                    FirebaseService.uploadMedia(big, uid, 'image'),
                    FirebaseService.uploadMedia(small, uid, 'image'),
                  ]);
                  preview = grab?.preview || await imagePreview(posterBlob).catch(() => null);
              }
              // The clip's real size wins over the still's
              if (grab?.w && grab?.h) preview = { ...(preview || {}), w: grab.w, h: grab.h };
          } catch (e) {
              console.warn('Clip still skipped:', e);
          }
      }
      const videoUrl = videoUpload ? await videoUpload : (snapshot.videoUrl && snapshot.videoUrl.startsWith('https://') ? snapshot.videoUrl : null);
      const audioUrl = snapshot.audioBlob ? await FirebaseService.uploadMedia(snapshot.audioBlob, uid, 'audio') : (snapshot.audioUrl && snapshot.audioUrl.startsWith('https://') ? snapshot.audioUrl : null);
      const associatedImageUrls: string[] = snapshot.associatedImages?.length
          ? await Promise.all(snapshot.associatedImages.map(img => FirebaseService.uploadMedia(img.blob || img.url!, uid, 'image')))
          : [];
      return {
        imageUrl,
        thumbnailUrl,
        thumbSmallUrl,
        originalImageUrl,
        videoUrl,
        audioUrl,
        associatedImageUrls,
        mediaType: snapshot.type,
        ...(preview && isLqip(preview.lqip) ? { lqip: preview.lqip } : {}),
        ...(preview && isTint(preview.tint) ? { tint: preview.tint } : {}),
        ...(preview?.w && preview?.h ? { w: preview.w, h: preview.h } : {}),
        ...(soundOnly ? { soundOnly: true } : {}),
        labels: snapshot.labels || [],
        behavior: snapshot.behavior || "Observation.",
        aiInsight: snapshot.aiInsight || null,
        aiConfidence: snapshot.aiConfidence || null,
        aiIdentifications: snapshot.aiIdentifications || null,
        aiFlags: snapshot.aiFlags || null,
        needsExpertReview: !!snapshot.needsExpertReview,
        aiSafetyNote: snapshot.aiSafetyNote || null,
        aiModel: snapshot.aiModel || null,
        aiPromptVersion: snapshot.aiPromptVersion || null,
        aiResultId: snapshot.aiResultId || null,
        // Sensitive species are always obscured (governance rule), regardless of the toggle
        locationArea: ((snapshot as any).showLocation === false || snapshot.aiFlags?.sensitiveSpecies) ? "" : (snapshot.locationArea || ""),
        showLocation: (snapshot as any).showLocation ?? false,
        rotation: snapshot.rotation || 0,
        timeToRecordMs: snapshot.timeToRecordMs || null,
        aiProposedLabels: snapshot.aiProposedLabels || null,
        aiProposedBehavior: snapshot.aiProposedBehavior || null,
        humanDelta: snapshot.humanDelta || false,
        sessionRetakes: snapshot.sessionRetakes || null,
        // When the photo was taken (EXIF, already coarse); the server checks and stores it as observedAt
        takenAtMs: typeof (snapshot as any).takenAtMs === 'number' && Number.isFinite((snapshot as any).takenAtMs) ? (snapshot as any).takenAtMs : null,
      };
  },

  /** Precise coordinates are research data: stored privately, readable only by the owner. */
  savePrivateObservationData: async (uid: string, postId: string, snapshots: Snapshot[]) => {
      const coords = snapshots.map(s => s.rawLocation || null);
      if (!coords.some(Boolean)) return;
      try {
          await setDoc(doc(db, "users", uid, "private", `obs_${postId}`), {
              postId,
              rawLocations: coords,
              createdAt: serverTimestamp(),
          });
      } catch (e) {
          console.warn("Could not store private observation data", e);
      }
  },

  publishPost: async (
      snapshots: Snapshot[],
      userId: string,
      flags: { feed: boolean, journal: boolean },
      tags: string[],
      extra: { caption?: string, title?: string, description?: string, behavior?: string, requestReview?: boolean, reviewNote?: string } = {}
  ) => {
      const effectiveUserId = userId || auth.currentUser?.uid;
      if (!effectiveUserId) throw new Error("No user found.");
      if (!snapshots.length) throw new Error("Nothing to publish.");

      const items = await Promise.all(snapshots.map(s => FirebaseService.uploadSnapshotItem(s, effectiveUserId)));
      const primaryItem = items[0];
      const allLabels = Array.from(new Set(items.flatMap(i => i.labels)));
      const caption = (extra.caption || '').trim().slice(0, 2200);

      // The server checks the sighting, charges the daily allowance and writes it
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(apiUrl('/api/publish'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}`, ...(await appCheckHeaders()) },
        body: JSON.stringify({
          items, tags, caption, feed: flags.feed, journal: flags.journal,
          title: extra.title, description: extra.description, behavior: extra.behavior,
          rawLocations: snapshots.map(s => s.rawLocation || null),
          requestReview: !!extra.requestReview, reviewNote: extra.reviewNote,
        }),
      });
      const out: any = await res.json().catch(() => ({ ok: false, message: 'Could not share right now. Please try again.' }));
      if (!res.ok || !out.ok) throw new PublishError(out.message || 'Could not share right now. Please try again.', out.code || 'unavailable', out);
      const postId: string = out.id;

      if (caption && out.isPublic) FirebaseService.notifyMentions(caption, postId, 'caption').catch(() => {});
      // Research descriptors are generated after publishing so they never delay the explorer
      import('./genAiService').then(({ GenAiService }) =>
        GenAiService.generateEthologicalDescriptors(allLabels, extra.behavior || extra.description || primaryItem.behavior || '', primaryItem.mediaType, primaryItem.locationArea)
      ).then(async (desc) => {
        if (!desc) return;
        await updateDoc(doc(db, "ecosystem_feed", postId), { ethologicalDescriptors: desc }).catch(() => {});
        if (out.isPublic) await updateDoc(doc(db, "feed_thumbnails", postId), { ethologicalDescriptors: desc }).catch(() => {});
      }).catch(() => {});

      try {
        // Species = distinct primary labels across the explorer's sightings (the life list), not labels per post
        const lifeList = await FirebaseService.getMySpeciesSet();
        await updateDoc(doc(db, "users", effectiveUserId), { "stats.species": lifeList.size });
      } catch (statsErr) {
        console.warn("Failed to update user stats:", statsErr);
      }
      return { id: postId, url: primaryItem.imageUrl || undefined, videoUrl: primaryItem.videoUrl || undefined, audioUrl: primaryItem.audioUrl || undefined,
        held: !!out.held, isPublic: !!out.isPublic, message: out.message as string | undefined, note: out.note as string | undefined, left: out.left as number | undefined };
  },

  /**
   * Human-in-the-loop accuracy signal: what the AI proposed vs what the explorer published.
   * Feeds the admin "AI quality" dashboard (correction rate, calibration by confidence).
   */
  logAiFeedback: async (snapshots: Snapshot[], postId: string | null) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const norm = (a?: string[] | null) => (a || []).map(x => x.trim().toLowerCase()).filter(Boolean);
    await Promise.all(snapshots.filter(s => s.aiProposedLabels && s.aiProposedLabels.length).map(s => {
      const ai = norm(s.aiProposedLabels), human = norm(s.labels);
      const corrected = JSON.stringify(ai[0] || '') !== JSON.stringify(human[0] || '');
      return addDoc(collection(db, 'ai_feedback'), {
        userId: uid,
        kind: corrected ? 'correction' : 'confirmation',
        postId: postId || null,
        mediaType: s.type,
        aiLabels: (s.aiProposedLabels || []).slice(0, 6),
        humanLabels: (s.labels || []).slice(0, 6),
        confidence: s.aiConfidence || null,
        needsExpertReview: !!s.needsExpertReview,
        flags: s.aiFlags || null,
        model: s.aiModel || null,
        promptVersion: s.aiPromptVersion || null,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    }));
  },

  /** Admin: recent AI feedback for quality monitoring. */
  getAiFeedback: async (max = 500): Promise<any[]> => {
    const snap = await getDocs(query(collection(db, 'ai_feedback'), orderBy('createdAt', 'desc'), limit(max)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // ------------------------------------------------------------------ community identification
  getIdentifications: async (postId: string): Promise<{ id: string; name: string; scientificName?: string; note?: string; userName?: string; agree?: boolean; thanked?: boolean }[]> => {
    try {
      const snap = await getDocs(collection(db, 'ecosystem_feed', postId, 'identifications'));
      return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    } catch { return []; }
  },
  setIdentification: async (postId: string, data: { name: string; scientificName?: string; note?: string; agree?: boolean }) => {
    const me = auth.currentUser;
    if (!me || me.isAnonymous) throw new Error('Please sign in to identify.');
    const profile = await FirebaseService.getUserProfile(me.uid);
    await setDoc(doc(db, 'ecosystem_feed', postId, 'identifications', me.uid), {
      name: data.name.trim().slice(0, 80),
      scientificName: (data.scientificName || '').trim().slice(0, 80),
      note: (data.note || '').trim().slice(0, 280),
      userName: (profile?.username || me.displayName || 'Explorer').slice(0, 60),
      agree: !!data.agree,
      createdAt: serverTimestamp(),
    }, { merge: true }); // merge keeps a thank-you from the post's author
    // Close the loop for the explorer who posted it: their ID was confirmed or questioned.
    // Best effort: needs the 'identification' notification type in firestore.rules.
    try {
      const postSnap = await getDoc(doc(db, 'ecosystem_feed', postId));
      const post: any = postSnap.exists() ? postSnap.data() : null;
      if (post && post.userId && post.userId !== me.uid) {
        const who = (profile?.username || me.displayName || 'An explorer').slice(0, 60);
        const posted = (post.labels?.[0] || 'sighting').slice(0, 80);
        const said = data.name.trim().slice(0, 80);
        const agrees = !!data.agree || said.toLowerCase() === posted.toLowerCase();
        await FirebaseService.addNotification(post.userId, {
          type: 'identification',
          message: agrees ? `${who} confirmed your ${posted}.` : `${who} thinks your ${posted} may be ${said}. Take another look?`,
          postId, senderId: me.uid, senderName: who,
        });
      }
    } catch (notifErr) {
      console.warn('Identification notification skipped:', notifErr);
    }
  },
  /** The post's author thanks an explorer for their identification (shown as "Thanked"). */
  thankIdentification: async (postId: string, identifierId: string) => {
    const me = auth.currentUser;
    if (!me || me.isAnonymous) throw new Error('Please sign in to thank explorers.');
    if (identifierId === me.uid) return;
    await updateDoc(doc(db, 'ecosystem_feed', postId, 'identifications', identifierId), { thanked: true, thankedAt: serverTimestamp() });
  },
  removeIdentification: async (postId: string) => {
    const me = auth.currentUser?.uid;
    if (me) await deleteDoc(doc(db, 'ecosystem_feed', postId, 'identifications', me));
  },

  /** Writes the lightweight feed index document for a public post. */
  upsertThumbnail: async (postId: string, post: any) => {
      const thumbData: any = {
          id: postId,
          mediaType: post.mediaType || 'image',
          thumbnailUrl: post.thumbnailUrl || post.imageUrl || "",
          thumbSmallUrl: post.thumbSmallUrl || null,
          title: post.title || null,
          caption: post.caption || null,
          description: post.description || null,
          timestamp: post.timestamp || serverTimestamp(),
          userId: post.userId,
          userName: post.userName || null,
          userAvatar: post.userAvatar || null,
          likes: post.likes || [],
          likeCount: post.likeCount || 0,
          commentCount: post.commentCount || 0,
          isPublic: true,
          tags: post.tags || [],
          labels: post.labels || [],
          behavior: post.behavior || "",
          aiInsight: post.aiInsight || null,
          aiConfidence: post.aiConfidence || null,
          locationArea: post.showLocation === false ? "" : (post.locationArea || ""),
          isHybrid: !!post.isHybrid
      };
      await setDoc(doc(db, "feed_thumbnails", postId), thumbData);
  },

  createSessionObservation: async (snapshots: Snapshot[], userId: string, flags: { feed: boolean, journal: boolean }, tags: string[], synthesizedData?: { title: string, description: string }, caption?: string) => {
      return FirebaseService.publishPost(snapshots, userId, flags, tags, {
          caption,
          title: synthesizedData?.title,
          description: synthesizedData?.description,
      });
  },

  createObservation: async (snapshot: Snapshot, userId: string, flags: { feed: boolean, journal: boolean }, synthesis: string, tags: string[], caption?: string) => {
      return FirebaseService.publishPost([snapshot], userId, flags, tags, { caption, behavior: synthesis });
  },

  /**
   * Who has answered a field challenge: distinct explorers among recent public sightings carrying its tag,
   * and whether the current explorer is one of them. Uses the existing tags + isPublic + timestamp index.
   */
  getChallengeProgress: async (tag: string): Promise<{ explorers: number; mine: boolean; capped: boolean }> => {
      const t = tag.startsWith('#') ? tag : `#${tag}`;
      const variants = Array.from(new Set([t, t.toLowerCase(), t.toUpperCase()])).slice(0, 10);
      const snap = await getDocs(query(collection(db, "feed_thumbnails"), where("tags", "array-contains-any", variants), where("isPublic", "==", true), orderBy("timestamp", "desc"), limit(60)));
      const uids = new Set(snap.docs.map(d => d.data().userId).filter(Boolean));
      const me = auth.currentUser?.uid;
      let mine = !!me && uids.has(me);
      // The explorer's own journal-only answers count for them too
      if (me && !mine && !auth.currentUser?.isAnonymous) {
          try {
              const own = await getDocs(query(collection(db, "feed_thumbnails"), where("userId", "==", me), orderBy("timestamp", "desc"), limit(60)));
              mine = own.docs.some(d => (d.data().tags || []).some((x: string) => x.toLowerCase() === t.toLowerCase()));
          } catch { /* best effort */ }
      }
      return { explorers: uids.size, mine, capped: snap.size >= 60 };
  },

  getMorePosts: async (lastVisible: any, searchTag?: string | null, pageSize: number = PAGE_SIZE): Promise<{ posts: CommunityPost[], lastVisible: any }> => {
      const muted = await loadMuted();
      // First page: plain JSON from the server (often already fetched by a preload in index.html)
      if (!lastVisible && !searchTag) {
          try {
              const ctrl = new AbortController();
              const t = setTimeout(() => ctrl.abort(), 4000);
              const res = await fetch(apiUrl('/api/feed/first'), { signal: ctrl.signal });
              clearTimeout(t);
              if (res.ok) {
                  const j = await res.json();
                  if (Array.isArray(j.posts) && j.posts.length) {
                      const posts = j.posts.filter((p: any) => !isSeedPost(p.id, p)).map((p: any) => ({ ...p, timestamp: Timestamp.fromMillis(p.ts || 0) })) as CommunityPost[];
                      const last = j.posts[j.posts.length - 1];
                      return { posts: withoutMuted(posts, muted), lastVisible: j.more ? Timestamp.fromMillis(last.ts || 0) : null };
                  }
              }
          } catch { /* fall back to the database */ }
      }
      const normalizedTag = searchTag
          ? (searchTag.startsWith('#') ? searchTag : `#${searchTag}`).toLowerCase().replace(/\s+/g, '')
          : null;
      // Legacy posts use mixed-case tags (#FIELDGUIDE, #NatureGram): match common case variants
      const tagVariants = normalizedTag ? Array.from(new Set([
          normalizedTag,
          normalizedTag.toUpperCase(),
          '#' + normalizedTag.slice(1, 2).toUpperCase() + normalizedTag.slice(2),
          searchTag && searchTag.startsWith('#') ? searchTag : `#${searchTag || ''}`,
      ])).slice(0, 10) : [];
      const build = (publicOnly: boolean) => {
          const c: any[] = [];
          if (normalizedTag) c.push(where("tags", "array-contains-any", tagVariants));
          if (publicOnly) c.push(where("isPublic", "==", true));
          c.push(orderBy("timestamp", "desc"), limit(pageSize));
          if (lastVisible) c.push(startAfter(lastVisible));
          return query(collection(db, "feed_thumbnails"), ...c);
      };
      let snapshot;
      try {
          snapshot = await getDocs(build(true));
      } catch (error: any) {
          // Composite index not deployed yet: degrade gracefully instead of breaking the feed
          if (error?.code !== 'failed-precondition') {
              handleFirestoreError(error, OperationType.GET, "feed_thumbnails");
              throw error;
          }
          try {
              snapshot = await getDocs(build(false));
          } catch (e2: any) {
              if (!normalizedTag || lastVisible) throw e2;
              // Tag search without ordering (single-field index only); sorted client-side below
              snapshot = await getDocs(query(collection(db, "feed_thumbnails"), where("tags", "array-contains-any", tagVariants), limit(100)));
          }
      }
      const posts: CommunityPost[] = [];
      snapshot.forEach((d) => {
          const data = d.data() as any;
          if (data.isPublic === true && !isSeedPost(d.id, data)) {
              posts.push({ id: d.id, ...data, labels: data.labels || (data.label ? [data.label] : ["Nature"]) } as CommunityPost);
          }
      });
      const toMs = (t: any) => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0);
      posts.sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
      return { posts: withoutMuted(posts, muted), lastVisible: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null };
  },

  subscribeToUserJournal: (userId: string, callback: (posts: CommunityPost[]) => void, opts: { publicOnly?: boolean } = {}) => {
    const publicOnly = opts.publicOnly ?? (auth.currentUser?.uid !== userId);
    const getT = (d: any) => {
      const ts = d.createdAt || d.timestamp;
      if (!ts) return 0;
      if (ts.toMillis) return ts.toMillis();
      if (ts.seconds) return ts.seconds * 1000;
      if (typeof ts === 'number') return ts;
      return new Date(ts).getTime();
    };
    const emit = (snapshot: any) => {
      const posts: CommunityPost[] = [];
      snapshot.forEach((d: any) => {
        const data = d.data();
        if (publicOnly ? data.isPublic === true : data.isJournal !== false) {
          posts.push({ id: d.id, ...data, labels: data.labels || (data.label ? [data.label] : ["Nature"]) } as CommunityPost);
        }
      });
      posts.sort((a: any, b: any) => getT(b) - getT(a));
      callback(posts);
    };
    // Owner view: no orderBy so legacy docs without a timestamp are never hidden
    const primary = publicOnly
      ? query(collection(db, "ecosystem_feed"), where("userId", "==", userId), where("isPublic", "==", true), orderBy("timestamp", "desc"), limit(120))
      : query(collection(db, "ecosystem_feed"), where("userId", "==", userId), limit(500));
    const fallback = query(collection(db, "ecosystem_feed"), where("userId", "==", userId), where("isPublic", "==", true), limit(120));
    let unsub = onSnapshot(primary, emit, (error: any) => {
      if (publicOnly && error?.code === 'failed-precondition') {
        unsub = onSnapshot(fallback, emit, (e2) => handleFirestoreError(e2, OperationType.GET, "ecosystem_feed"));
      } else {
        handleFirestoreError(error, OperationType.GET, "ecosystem_feed");
      }
    });
    return () => unsub();
  },

  deletePost: async (postId: string) => {
      let mainFeedSuccess = false;
      try {
          await deleteDoc(doc(db, "ecosystem_feed", postId));
          mainFeedSuccess = true;
      } catch (e) {
          console.warn("Could not delete from ecosystem_feed (might already be deleted or missing rules):", e);
      }
      
      try {
          await deleteDoc(doc(db, "feed_thumbnails", postId));
      } catch (e) {
          console.warn("Could not delete from feed_thumbnails:", e);
          if (!mainFeedSuccess) {
              throw new Error("Failed to delete post from both feed and thumbnails.");
          }
      }
  },

  getPost: async (postId: string): Promise<CommunityPost | null> => {
      const postSnap = await getDoc(doc(db, "ecosystem_feed", postId));
      if (postSnap.exists()) {
          const data = postSnap.data();
          return {
              id: postSnap.id,
              ...data,
              labels: data.labels || (data.label ? [data.label] : ["Nature"])
          } as CommunityPost;
      }
      return null;
  },

  /** Has the signed-in explorer liked this post via the scalable like documents? */
  hasLiked: async (postId: string): Promise<boolean> => {
    const me = auth.currentUser?.uid;
    if (!me) return false;
    try { return (await getDoc(doc(db, "ecosystem_feed", postId, "likes", me))).exists(); } catch { return false; }
  },

  /**
   * Likes scale via one document per like (posts/{id}/likes/{uid}) plus a likeCount counter
   * the rules only allow to move by exactly one, together with that document.
   * Legacy likes stored in the `likes` array keep working and keep counting.
   * @param isLiked  current state (true = unlike)
   * @param legacy   true when the existing like lives in the legacy array
   */
  toggleLike: async (postId: string, userId: string, isLiked: boolean, legacy = false) => {
    const postRef = doc(db, "ecosystem_feed", postId);
    if (isLiked && legacy) {
      await updateDoc(postRef, { likes: arrayRemove(userId) });
      await updateDoc(doc(db, "feed_thumbnails", postId), { likes: arrayRemove(userId) }).catch(() => {});
    } else {
      const likeRef = doc(db, "ecosystem_feed", postId, "likes", userId);
      const commit = async (withThumb: boolean) => {
        const batch = writeBatch(db);
        const delta = increment(isLiked ? -1 : 1);
        if (isLiked) batch.delete(likeRef);
        else batch.set(likeRef, { userId, createdAt: serverTimestamp() });
        batch.update(postRef, { likeCount: delta });
        // The feed index mirrors the counter atomically (rules verify the like document)
        if (withThumb) batch.update(doc(db, "feed_thumbnails", postId), { likeCount: delta });
        await batch.commit();
      };
      try { await commit(true); } catch { await commit(false); }
    }
    
    if (!isLiked) try {
      const postSnap = await getDoc(postRef);
      if (postSnap.exists()) {
        const postData = postSnap.data();
        if (postData.userId !== userId) {
          const userProfile = await FirebaseService.getUserProfile(userId);
          await FirebaseService.addNotification(postData.userId, {
            type: 'like',
            message: `${userProfile?.username || 'An explorer'} marvelled at your ${postData.labels?.[0] || 'sighting'}.`,
            postId,
            senderId: userId,
            senderName: userProfile?.username || 'Explorer'
          });
        }
      }
    } catch (notifErr) {
      console.warn("Like notification skipped:", notifErr);
    }
  },

  addComment: async (postId: string, userId: string, text: string) => {
    const userProfile = await FirebaseService.getUserProfile(userId);
    const userName = userProfile?.username || auth.currentUser?.displayName || `Explorer-${userId.slice(0, 4)}`;
    const clean = text.trim().slice(0, 1000);
    if (!clean) throw new Error("Comment is empty.");
    if (looksLikeSpam(clean)) throw new Error("Field notes can't contain links or promotions.");
    // The same note twice on one post is almost always spam or a double tap
    try {
      const mine = await getDocs(query(collection(db, "ecosystem_feed", postId, "comments"), where("userId", "==", userId), limit(20)));
      if (mine.docs.some(d => String(d.data().text || '').trim().toLowerCase() === clean.toLowerCase())) throw new Error("You've already added this field note.");
    } catch (dupErr: any) { if (String(dupErr?.message || '').startsWith("You've")) throw dupErr; }
    const commentsRef = collection(db, "ecosystem_feed", postId, "comments");
    const commentData: any = { userId, userName, text: clean, timestamp: serverTimestamp() };
    if (userProfile?.avatarUrl) commentData.avatarUrl = userProfile.avatarUrl;
    await addDoc(commentsRef, commentData);
    await updateDoc(doc(db, "ecosystem_feed", postId), { commentCount: increment(1) });
    try {
        await updateDoc(doc(db, "feed_thumbnails", postId), { commentCount: increment(1) });
    } catch(e) {}

    try {
      const postSnap = await getDoc(doc(db, "ecosystem_feed", postId));
      if (postSnap.exists()) {
        const postData = postSnap.data();
        if (postData.userId !== userId) {
          await FirebaseService.addNotification(postData.userId, {
            type: 'comment',
            message: `${userName} left a field note: "${clean.slice(0, 80)}${clean.length > 80 ? '…' : ''}"`,
            postId,
            senderId: userId,
            senderName: userName
          });
        }
      }
    } catch (notifErr) {
      console.warn("Comment notification skipped:", notifErr);
    }
    FirebaseService.notifyMentions(clean, postId, 'comment').catch(() => {});
  },

  deleteComment: async (postId: string, commentId: string) => {
    await deleteDoc(doc(db, "ecosystem_feed", postId, "comments", commentId));
    try {
      await updateDoc(doc(db, "ecosystem_feed", postId), { commentCount: increment(-1) });
      await updateDoc(doc(db, "feed_thumbnails", postId), { commentCount: increment(-1) });
    } catch (e) { /* counter best-effort */ }
  },

  /** One report per user per post; the post is flagged for moderator review. */
  reportPost: async (postId: string, reason: string, details = "") => {
    const uid = auth.currentUser?.uid;
    if (!uid || auth.currentUser?.isAnonymous) throw new Error("Please sign in to report.");
    const batch = writeBatch(db);
    batch.set(doc(db, "ecosystem_feed", postId, "reports", uid), {
      reason: reason.slice(0, 40),
      details: details.slice(0, 500),
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, "ecosystem_feed", postId), {
      reports: arrayUnion(uid),
      reportStatus: 'pending',
      reportCount: increment(1),
    });
    await batch.commit();
  },

  subscribeToComments: (postId: string, callback: (comments: Comment[]) => void) => {
    const q = query(collection(db, "ecosystem_feed", postId, "comments"), orderBy("timestamp", "asc"));
    return onSnapshot(q, (snapshot) => {
        const comments: Comment[] = [];
        const me = auth.currentUser?.uid;
        snapshot.forEach(doc => {
          const c: any = doc.data();
          if (c.hidden === true && c.userId !== me) return;
          comments.push({ id: doc.id, ...c } as Comment);
        });
        callback(comments);
    }, (error) => {
        handleFirestoreError(error, OperationType.GET, `ecosystem_feed/${postId}/comments`);
    });
  },

  addNotification: async (recipientId: string, data: Partial<FieldNotification>) => {
    const notifsRef = collection(db, "users", recipientId, "notifications");
    const payload: any = {
      type: data.type,
      message: (data.message || '').slice(0, 300),
      senderId: data.senderId,
      senderName: (data.senderName || 'Explorer').slice(0, 60),
      timestamp: serverTimestamp(),
      isRead: false
    };
    if (data.postId) payload.postId = data.postId;
    await addDoc(notifsRef, payload);
  },

  subscribeToNotifications: (userId: string, callback: (notifs: FieldNotification[]) => void) => {
    if (!userId || userId === 'explorer_guest' || !auth.currentUser || auth.currentUser.uid !== userId) {
      callback([]);
      return () => {};
    }
    const q = query(collection(db, "users", userId, "notifications"), orderBy("timestamp", "desc"), limit(20));
    // Notifications from muted explorers are left out (and re-filtered when the muted list changes)
    let last: FieldNotification[] | null = null;
    const emit = () => { if (last) callback(withoutMuted(last as any[]) as FieldNotification[]); };
    const offMuted = FirebaseService.onMutedChange(emit);
    const unsub = onSnapshot(q, (snapshot) => {
      const notifs: FieldNotification[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        notifs.push({ id: doc.id, ...data } as FieldNotification);
      });
      last = notifs;
      emit();
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${userId}/notifications`);
    });
    return () => { offMuted(); unsub(); };
  },

  markNotificationRead: async (userId: string, notifId: string) => {
    if (!userId || auth.currentUser?.uid !== userId) return;
    try {
      await updateDoc(doc(db, "users", userId, "notifications", notifId), { isRead: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/notifications/${notifId}`);
    }
  },

  /** Distinct species already in the signed-in explorer's records (for "new to your life list"). */
  /** The explorer's last seven days: sightings and distinct species (for the weekly field letter). */
  getMyWeek: async (): Promise<{ sightings: number; species: string[] }> => {
    const me = auth.currentUser?.uid;
    if (!me || auth.currentUser?.isAnonymous) return { sightings: 0, species: [] };
    const since = Date.now() - 7 * 864e5;
    try {
      const snap = await getDocs(query(collection(db, "ecosystem_feed"), where("userId", "==", me), orderBy("timestamp", "desc"), limit(50)));
      const recent = snap.docs.map(d => d.data() as any).filter(p => (p.timestamp?.toMillis?.() ?? 0) >= since);
      const species = Array.from(new Set(recent.map(p => String(p.labels?.[0] || '').trim()).filter(l => l && !/^(unknown|nature|unidentified)/i.test(l))));
      return { sightings: recent.length, species };
    } catch { return { sightings: 0, species: [] }; }
  },

  getMySpeciesSet: async (): Promise<Set<string>> => {
    const me = auth.currentUser?.uid;
    const out = new Set<string>();
    if (!me) return out;
    try {
      const snap = await getDocs(query(collection(db, "ecosystem_feed"), where("userId", "==", me), limit(500)));
      snap.forEach(d => { const l = (d.data() as any).labels?.[0]; if (l) out.add(String(l).trim().toLowerCase()); });
    } catch { /* ignore */ }
    return out;
  },

  // ------------------------------------------------------------------ search
  /** Account search by username prefix (server-side, case-insensitive for new accounts). */
  searchUsers: async (term: string, max = 8): Promise<UserProfileData[]> => {
    const q = term.trim().replace(/^@/, '');
    if (q.length < 2) return [];
    const lower = q.toLowerCase();
    const run = async (field: string, value: string) => {
      try {
        const snap = await getDocs(query(collection(db, "users"), orderBy(field), startAt(value), endAt(value + '\uf8ff'), limit(max)));
        return snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) } as UserProfileData));
      } catch { return []; }
    };
    const [a, b, c] = await Promise.all([run('usernameLower', lower), run('username', q), run('username', lower)]);
    const seen = new Set<string>();
    return (await withoutUnfollowedTeens([...a, ...b, ...c].filter(u => !u.isAnonymous && !seen.has(u.uid) && seen.add(u.uid)))).slice(0, max);
  },

  /**
   * Full-text sighting search: array-contains on the longest word's prefix key (`searchTokens`),
   * then every other word is checked here. Falls back to the hashtag search for sightings that
   * have no search keys yet (before the backfill) or when the index isn't deployed.
   */
  searchPosts: async (term: string, max = 40): Promise<CommunityPost[]> => {
    const tokens = queryTokens(term);
    if (!tokens.length) return [];
    const first = [...tokens].sort((a, b) => b.length - a.length)[0];
    const rest = tokens.filter(t => t !== first);
    const muted = await loadMuted();
    const toMs = (t: any) => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0);
    let docs: any[] = [];
    try {
      const snap = await getDocs(query(collection(db, 'feed_thumbnails'), where('searchTokens', 'array-contains', first), where('isPublic', '==', true), orderBy('timestamp', 'desc'), limit(120)));
      docs = snap.docs;
    } catch (e: any) {
      if (e?.code === 'failed-precondition') {
        try { docs = (await getDocs(query(collection(db, 'feed_thumbnails'), where('searchTokens', 'array-contains', first), where('isPublic', '==', true), limit(120)))).docs; } catch { docs = []; }
      }
    }
    let posts = docs
      .map(d => ({ id: d.id, ...(d.data() as any), labels: (d.data() as any).labels || ['Nature'] } as CommunityPost))
      .filter(p => p.isPublic === true && !isSeedPost(p.id, p))
      .filter(p => { const have = new Set((p as any).searchTokens || []); return rest.every(t => have.has(t)); });
    if (posts.length < 5 && tokens.length === 1) {
      // Older sightings without search keys: the original hashtag search
      try {
        const legacy = (await FirebaseService.getMorePosts(null, first, 30)).posts;
        const seen = new Set(posts.map(p => p.id));
        posts = [...posts, ...legacy.filter(p => !seen.has(p.id))];
      } catch { /* keep what we have */ }
    }
    return withoutMuted(posts, muted).sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp)).slice(0, max);
  },

  // ------------------------------------------------------------------ explore
  /** Recent public sightings (for Explore's places, kinds of life and challenge sections). */
  getRecentPublic: async (max = 60): Promise<CommunityPost[]> => {
    const muted = await loadMuted();
    try {
      const snap = await getDocs(query(collection(db, 'feed_thumbnails'), where('isPublic', '==', true), orderBy('timestamp', 'desc'), limit(max)));
      return withoutMuted(snap.docs.map(d => ({ id: d.id, ...(d.data() as any), labels: (d.data() as any).labels || ['Nature'] } as CommunityPost)).filter(p => !isSeedPost(p.id, p)), muted);
    } catch {
      return (await FirebaseService.getMorePosts(null, null, Math.min(max, 30)).catch(() => ({ posts: [] as CommunityPost[] }))).posts;
    }
  },

  /** Public sightings at least two explorers have confirmed, newest first. */
  getRecentlyConfirmed: async (max = 12): Promise<CommunityPost[]> => {
    const muted = await loadMuted();
    const toPost = (d: any) => ({ id: d.id, ...(d.data() as any), labels: (d.data() as any).labels || ['Nature'] } as CommunityPost);
    try {
      // Kept on the post by the syncCommunityVerification Cloud Function
      const snap = await getDocs(query(collection(db, 'feed_thumbnails'), where('communityVerified', '==', true), where('isPublic', '==', true), orderBy('timestamp', 'desc'), limit(max)));
      if (!snap.empty) return withoutMuted(snap.docs.map(toPost).filter(p => !isSeedPost(p.id, p)), muted);
    } catch { /* index or function not deployed yet: work it out below */ }
    // Fallback: check the identifications of recent sightings (same rule as CommunityId: 2+ agree)
    const recent = await FirebaseService.getRecentPublic(30);
    const checked = await Promise.all(recent.map(async p => {
      const ids = await FirebaseService.getIdentifications(p.id);
      const primary = String(p.labels?.[0] || '').trim().toLowerCase();
      return ids.filter(i => String(i.name || '').trim().toLowerCase() === primary).length >= 2 ? p : null;
    }));
    return checked.filter(Boolean).slice(0, max) as CommunityPost[];
  },

  findUserByUsername: async (username: string): Promise<UserProfileData | null> => {
    const u = username.replace(/^@/, '');
    for (const [field, value] of [['usernameLower', u.toLowerCase()], ['username', u]] as const) {
      try {
        const snap = await getDocs(query(collection(db, "users"), where(field, "==", value), limit(1)));
        if (!snap.empty) return { uid: snap.docs[0].id, ...(snap.docs[0].data() as any) } as UserProfileData;
      } catch { /* try next */ }
    }
    return null;
  },

  /** Notify explorers @mentioned in a caption or comment (max 5 per text). */
  notifyMentions: async (text: string, postId: string, context: 'comment' | 'caption') => {
    const me = auth.currentUser;
    if (!me || me.isAnonymous) return;
    const names = Array.from(new Set((text.match(/@([a-zA-Z0-9_.]{3,30})/g) || []).map(m => m.slice(1).toLowerCase()))).slice(0, 5);
    if (!names.length) return;
    const myProfile = await FirebaseService.getUserProfile(me.uid);
    const senderName = myProfile?.username || me.displayName || 'An explorer';
    await Promise.all(names.map(async n => {
      const target = await FirebaseService.findUserByUsername(n);
      if (!target || target.uid === me.uid) return;
      await FirebaseService.addNotification(target.uid, {
        type: 'mention',
        message: `${senderName} mentioned you in a ${context}: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`,
        postId, senderId: me.uid, senderName,
      }).catch(() => {});
    }));
  },

  // ------------------------------------------------------------------ reels
  /** Public video posts, newest first (paginated). */
  getVideoPosts: async (lastVisible: any = null, pageSize = 8): Promise<{ posts: CommunityPost[]; lastVisible: any }> => {
    const build = (ordered: boolean) => {
      const c: any[] = [where('mediaType', '==', 'video'), where('isPublic', '==', true)];
      if (ordered) c.push(orderBy('timestamp', 'desc'));
      c.push(limit(ordered ? pageSize : 60));
      if (ordered && lastVisible) c.push(startAfter(lastVisible));
      return query(collection(db, 'feed_thumbnails'), ...c);
    };
    let snap;
    let ordered = true;
    try { snap = await getDocs(build(true)); }
    catch (e: any) {
      if (e?.code !== 'failed-precondition' || lastVisible) throw e;
      ordered = false; // index still building: one unordered batch, sorted client-side
      snap = await getDocs(build(false));
    }
    const toMs = (t: any) => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0);
    const posts = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as CommunityPost)).filter(p => !isSeedPost(p.id, p));
    if (!ordered) posts.sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
    return { posts: withoutMuted(posts, await loadMuted()), lastVisible: ordered && snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1] : null };
  },

  // ------------------------------------------------------------------ direct messages
  conversationId: (a: string, b: string) => [a, b].sort().join('_'),

  /** Opens (creating if needed) the 1:1 conversation with another explorer. */
  openConversation: async (otherUid: string): Promise<string> => {
    const me = auth.currentUser;
    if (!me || me.isAnonymous) throw new Error('Please sign in to send messages.');
    if (otherUid === me.uid) throw new Error("You can't message yourself.");
    const participants = [me.uid, otherUid].sort();
    const cid = participants.join('_');
    const ref = doc(db, 'conversations', cid);
    const existingSnap = await getDoc(ref).catch(() => null);
    if (!existingSnap || !existingSnap.exists()) {
      const [mine, theirs] = await Promise.all([FirebaseService.getUserProfile(me.uid), FirebaseService.getUserProfile(otherUid)]);
      // Teen mode: letters only between explorers who follow each other, once a parent has said yes
      // (the rules enforce this; here it gets a kind explanation instead of a bare failure)
      const meTeen = isTeenProfile(mine), themTeen = isTeenProfile(theirs);
      if (meTeen && mine?.guardian?.status !== 'approved') throw new Error('Letters open once a grown-up has said yes to your notebook.');
      if (themTeen && theirs?.guardian?.status !== 'approved') throw new Error('This explorer can\'t receive letters yet.');
      if (meTeen || themTeen) {
        const [a, b] = await Promise.all([getDoc(doc(db, 'users', me.uid, 'following', otherUid)).catch(() => null), getDoc(doc(db, 'users', otherUid, 'following', me.uid)).catch(() => null)]);
        if (!a?.exists() || !b?.exists()) throw new Error(meTeen ? 'You can write letters to explorers you both follow.' : 'Letters with this explorer open once you both follow each other.');
      }
      await setDoc(ref, {
        participants,
        participantInfo: {
          [me.uid]: { username: mine?.username || me.displayName || 'Explorer', avatarUrl: mine?.avatarUrl || null },
          [otherUid]: { username: theirs?.username || 'Explorer', avatarUrl: theirs?.avatarUrl || null },
        },
        lastMessage: null,
        updatedAt: serverTimestamp(),
        lastReadAt: { [me.uid]: serverTimestamp() },
      });
    }
    return cid;
  },

  subscribeToInbox: (callback: (convos: Conversation[]) => void) => {
    const me = auth.currentUser?.uid;
    if (!me) { callback([]); return () => {}; }
    const q = query(collection(db, 'conversations'), where('participants', 'array-contains', me), orderBy('updatedAt', 'desc'), limit(50));
    return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Conversation))),
      () => callback([]));
  },

  subscribeToMessages: (cid: string, callback: (msgs: DirectMessage[]) => void) => {
    const q = query(collection(db, 'conversations', cid, 'messages'), orderBy('createdAt', 'desc'), limit(100));
    return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as DirectMessage)).reverse()),
      () => callback([]));
  },

  sendMessage: async (cid: string, text: string, postId?: string) => {
    const me = auth.currentUser;
    if (!me || me.isAnonymous) throw new Error('Please sign in to send messages.');
    const clean = text.trim().slice(0, 2000);
    if (!clean && !postId) return;
    const msg: any = { senderId: me.uid, text: clean, createdAt: serverTimestamp() };
    if (postId) msg.postId = postId;
    await addDoc(collection(db, 'conversations', cid, 'messages'), msg);
    await updateDoc(doc(db, 'conversations', cid), {
      lastMessage: { text: clean || 'Shared a sighting', senderId: me.uid, at: serverTimestamp() },
      updatedAt: serverTimestamp(),
      [`lastReadAt.${me.uid}`]: serverTimestamp(),
    }).catch(() => {});
    // Notify the other participant (push via the existing notification pipeline)
    const other = cid.split('_').find(u => u !== me.uid);
    if (other) {
      const profile = await FirebaseService.getUserProfile(me.uid).catch(() => null);
      const name = profile?.username || me.displayName || 'An explorer';
      FirebaseService.addNotification(other, { type: 'message', message: `${name} sent you a letter: "${(clean || 'a sighting').slice(0, 80)}"`, senderId: me.uid, senderName: name }).catch(() => {});
    }
  },

  markConversationRead: async (cid: string) => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    await updateDoc(doc(db, 'conversations', cid), { [`lastReadAt.${me}`]: serverTimestamp() }).catch(() => {});
  },

  // ------------------------------------------------------------------ social graph
  isFollowing: async (targetUid: string): Promise<boolean> => {
    const me = auth.currentUser?.uid;
    if (!me || me === targetUid) return false;
    try { return (await getDoc(doc(db, "users", me, "following", targetUid))).exists(); } catch { return false; }
  },

  followUser: async (targetUid: string) => {
    const me = auth.currentUser;
    if (!me || me.isAnonymous) throw new Error("Please sign in to follow explorers.");
    if (me.uid === targetUid) return;
    if (await FirebaseService.isFollowing(targetUid)) return;
    // A counter is only moved on a profile document that exists: an update on a missing document fails the whole
    // batch, so following someone whose profile was never written used to fail every time.
    const [mine, theirs] = await Promise.all([
      getDoc(doc(db, "users", me.uid)).then(s => s.exists()).catch(() => false),
      getDoc(doc(db, "users", targetUid)).then(s => s.exists()).catch(() => false),
    ]);
    const batch = writeBatch(db);
    batch.set(doc(db, "users", me.uid, "following", targetUid), { createdAt: serverTimestamp() });
    batch.set(doc(db, "users", targetUid, "followers", me.uid), { createdAt: serverTimestamp() });
    if (theirs) batch.update(doc(db, "users", targetUid), { followersCount: increment(1) });
    if (mine) batch.update(doc(db, "users", me.uid), { followingCount: increment(1) });
    await batch.commit();
    try {
      const myProfile = await FirebaseService.getUserProfile(me.uid);
      const name = myProfile?.username || me.displayName || 'An explorer';
      await FirebaseService.addNotification(targetUid, { type: 'follow', message: `${name} is following your journal.`, senderId: me.uid, senderName: name });
    } catch { /* notification is best-effort */ }
  },

  unfollowUser: async (targetUid: string) => {
    const me = auth.currentUser;
    if (!me || me.uid === targetUid) return;
    if (!(await FirebaseService.isFollowing(targetUid))) return;
    const [mine, theirs] = await Promise.all([
      getDoc(doc(db, "users", me.uid)).then(s => s.exists()).catch(() => false),
      getDoc(doc(db, "users", targetUid)).then(s => s.exists()).catch(() => false),
    ]);
    const batch = writeBatch(db);
    batch.delete(doc(db, "users", me.uid, "following", targetUid));
    batch.delete(doc(db, "users", targetUid, "followers", me.uid));
    if (theirs) batch.update(doc(db, "users", targetUid), { followersCount: increment(-1) });
    if (mine) batch.update(doc(db, "users", me.uid), { followingCount: increment(-1) });
    await batch.commit();
  },

  getFollowingIds: async (uid: string, max = 500): Promise<string[]> => {
    try {
      const snap = await getDocs(query(collection(db, "users", uid, "following"), limit(max)));
      return snap.docs.map(d => d.id);
    } catch { return []; }
  },

  /** People list for followers/following sheets (profiles fetched in parallel). */
  getConnections: async (uid: string, kind: 'followers' | 'following', max = 100): Promise<UserProfileData[]> => {
    try {
      const snap = await getDocs(query(collection(db, "users", uid, kind), limit(max)));
      const profiles = await Promise.all(snap.docs.map(d => FirebaseService.getUserProfile(d.id)));
      return profiles.filter(Boolean).map((p, i) => ({ ...(p as UserProfileData), uid: (p as any)?.uid || snap.docs[i].id }));
    } catch { return []; }
  },

  /** Home timeline: recent public posts from explorers you follow (fan-out on read, 30 ids per query). */
  getFollowingFeed: async (followingIds: string[], perAuthorLimit = 30): Promise<CommunityPost[]> => {
    if (!followingIds.length) return [];
    const chunks: string[][] = [];
    for (let i = 0; i < followingIds.length; i += 30) chunks.push(followingIds.slice(i, i + 30));
    const results = await Promise.all(chunks.map(async ids => {
      try {
        const snap = await getDocs(query(collection(db, "feed_thumbnails"), where("userId", "in", ids), where("isPublic", "==", true), orderBy("timestamp", "desc"), limit(perAuthorLimit)));
        return snap.docs.map(d => ({ id: d.id, ...d.data(), labels: (d.data() as any).labels || ["Nature"] } as CommunityPost));
      } catch (e) {
        console.warn("Following feed chunk failed", e);
        return [];
      }
    }));
    const toMs = (t: any) => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0);
    return withoutMuted(results.flat(), await loadMuted()).sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
  },

  // ------------------------------------------------------------------ safety: block & save
  getBlockedIds: async (): Promise<string[]> => {
    const me = auth.currentUser?.uid;
    if (!me) return [];
    try { return (await getDocs(collection(db, "users", me, "blocked"))).docs.map(d => d.id); } catch { return []; }
  },
  blockUser: async (targetUid: string) => {
    const me = auth.currentUser?.uid;
    if (!me || me === targetUid) return;
    await setDoc(doc(db, "users", me, "blocked", targetUid), { createdAt: serverTimestamp() });
    await FirebaseService.unfollowUser(targetUid).catch(() => {});
  },
  unblockUser: async (targetUid: string) => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    await deleteDoc(doc(db, "users", me, "blocked", targetUid));
  },

  // ------------------------------------------------------------------ safety: mute (quieter than block)
  // Muting hides an explorer's sightings, Moments and notifications from you. Unlike blocking it
  // doesn't unfollow, doesn't stop letters, and they are never told. Stored only under your account.
  getMutedIds: async (): Promise<string[]> => [...(await loadMuted())],
  isMuted: async (targetUid: string): Promise<boolean> => (await loadMuted()).has(targetUid),
  muteUser: async (targetUid: string) => {
    const me = auth.currentUser?.uid;
    if (!me || me === targetUid || auth.currentUser?.isAnonymous) throw new Error('Please sign in to mute explorers.');
    await setDoc(doc(db, "users", me, "muted", targetUid), { createdAt: serverTimestamp() });
    mutedCache.ids = new Set([...mutedNow(), targetUid]); mutedCache.uid = me; mutedCache.at = Date.now();
    mutedListeners.forEach(l => l());
  },
  unmuteUser: async (targetUid: string) => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    await deleteDoc(doc(db, "users", me, "muted", targetUid));
    const next = new Set(mutedNow()); next.delete(targetUid);
    mutedCache.ids = next; mutedCache.at = Date.now();
    mutedListeners.forEach(l => l());
  },
  /**
   * Drop posts, Moments or notifications from muted explorers. Pass `muted` from getMutedIds()
   * for an exact result; without it the cached set is used (loaded on first use).
   */
  filterMuted: <T extends { userId?: string; senderId?: string }>(list: T[], muted?: string[] | Set<string>): T[] =>
    withoutMuted(list, muted ? new Set(muted) : mutedNow()),
  /** Be told when the muted list changes (to re-filter what's on screen). Returns an unsubscribe. */
  onMutedChange: (cb: () => void) => { mutedListeners.add(cb); loadMuted(); return () => { mutedListeners.delete(cb); }; },

  isSaved: async (postId: string): Promise<boolean> => {
    const me = auth.currentUser?.uid;
    if (!me) return false;
    try { return (await getDoc(doc(db, "users", me, "saved", postId))).exists(); } catch { return false; }
  },
  toggleSave: async (postId: string, save: boolean, thumb?: Partial<CommunityPost>) => {
    const me = auth.currentUser?.uid;
    if (!me) throw new Error("Please sign in to save posts.");
    if (save) {
      await setDoc(doc(db, "users", me, "saved", postId), {
        createdAt: serverTimestamp(),
        thumbnailUrl: thumb?.thumbnailUrl || thumb?.imageUrl || null,
        label: thumb?.labels?.[0] || null,
        mediaType: thumb?.mediaType || 'image',
      });
    } else {
      await deleteDoc(doc(db, "users", me, "saved", postId));
    }
  },
  getSavedPosts: async (): Promise<{ id: string; thumbnailUrl?: string; label?: string; mediaType?: string }[]> => {
    const me = auth.currentUser?.uid;
    if (!me) return [];
    try {
      const snap = await getDocs(query(collection(db, "users", me, "saved"), orderBy("createdAt", "desc"), limit(200)));
      return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    } catch { return []; }
  },

  // ------------------------------------------------------------------ profile
  updateMyProfile: async (updates: { username?: string; bio?: string; displayName?: string }) => {
    const me = auth.currentUser;
    if (!me) throw new Error("Not signed in");
    const clean: any = {};
    if (updates.username !== undefined) {
      const u = updates.username.trim().replace(/[^a-zA-Z0-9_.]/g, '').slice(0, 30);
      if (u.length < 3) throw new Error("Usernames need at least 3 letters or numbers.");
      clean.username = u;
      clean.usernameLower = u.toLowerCase();
    }
    if (updates.bio !== undefined) clean.bio = updates.bio.trim().slice(0, 300);
    if (updates.displayName !== undefined) clean.displayName = updates.displayName.trim().slice(0, 60);
    await updateDoc(doc(db, "users", me.uid), clean);
    if (clean.username) await updateProfile(me, { displayName: clean.username }).catch(() => {});
  },

  uploadAvatar: async (file: Blob): Promise<string> => {
    const me = auth.currentUser;
    if (!me) throw new Error("Not signed in");
    const square = await reencodeImage(file, 512, 'image/jpeg', 0.88);
    const r = ref(storage, `avatars/${me.uid}/avatar_${Date.now()}.jpg`);
    await uploadBytes(r, square, { contentType: 'image/jpeg' });
    const url = await getDownloadURL(r);
    await updateDoc(doc(db, "users", me.uid), { avatarUrl: url });
    await updateProfile(me, { photoURL: url }).catch(() => {});
    return url;
  },

  // ------------------------------------------------------------------ data rights (GDPR/CCPA)
  exportMyData: async (): Promise<Blob> => {
    const me = auth.currentUser;
    if (!me) throw new Error("Not signed in");
    const uid = me.uid;
    const safe = async <T,>(fn: () => Promise<T>, fallback: T) => { try { return await fn(); } catch { return fallback; } };
    const docsOf = (snap: any) => snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    const [profile, posts, following, followers, saved, drafts, privateDocs, comments, memory] = await Promise.all([
      safe(() => FirebaseService.getUserProfile(uid), null),
      safe(async () => docsOf(await getDocs(query(collection(db, "ecosystem_feed"), where("userId", "==", uid)))), []),
      safe(async () => docsOf(await getDocs(collection(db, "users", uid, "following"))), []),
      safe(async () => docsOf(await getDocs(collection(db, "users", uid, "followers"))), []),
      safe(async () => docsOf(await getDocs(collection(db, "users", uid, "saved"))), []),
      safe(async () => docsOf(await getDocs(collection(db, "users", uid, "drafts"))), []),
      safe(async () => docsOf(await getDocs(collection(db, "users", uid, "private"))), []),
      safe(async () => docsOf(await getDocs(query(collectionGroup(db, "comments"), where("userId", "==", uid)))), []),
      safe(() => FirebaseService.getNaturalistMemory(uid), null),
    ]);
    const data = {
      exportedAt: new Date().toISOString(),
      account: { uid, email: me.email, emailVerified: me.emailVerified, createdAt: me.metadata.creationTime },
      profile, posts, comments, following, followers, saved, drafts, privateObservationData: privateDocs, naturalistMemory: memory,
    };
    return new Blob([JSON.stringify(data, (_k, v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v), 2)], { type: 'application/json' });
  },

  /**
   * Permanently deletes the signed-in explorer's account and everything they created.
   * Requires a recent login (Firebase); throws 'auth/requires-recent-login' otherwise.
   */
  deleteMyAccount: async (onProgress?: (step: string) => void) => {
    const me = auth.currentUser;
    if (!me) throw new Error("Not signed in");
    const uid = me.uid;
    const step = (s: string) => onProgress?.(s);

    step('Removing your posts…');
    const posts = await getDocs(query(collection(db, "ecosystem_feed"), where("userId", "==", uid)));
    for (const p of posts.docs) {
      try {
        const cs = await getDocs(collection(db, "ecosystem_feed", p.id, "comments"));
        await Promise.all(cs.docs.map(c => deleteDoc(c.ref).catch(() => {})));
      } catch { /* continue */ }
      await deleteDoc(doc(db, "feed_thumbnails", p.id)).catch(() => {});
      await deleteDoc(p.ref).catch(() => {});
    }

    step('Removing your comments…');
    try {
      const myComments = await getDocs(query(collectionGroup(db, "comments"), where("userId", "==", uid)));
      for (const c of myComments.docs) {
        await deleteDoc(c.ref).catch(() => {});
        const postId = c.ref.parent.parent?.id;
        if (postId) {
          await updateDoc(doc(db, "ecosystem_feed", postId), { commentCount: increment(-1) }).catch(() => {});
          await updateDoc(doc(db, "feed_thumbnails", postId), { commentCount: increment(-1) }).catch(() => {});
        }
      }
    } catch (e) { console.warn("Comment cleanup incomplete", e); }

    step('Removing your likes…');
    try {
      const myLikes = await getDocs(query(collectionGroup(db, "likes"), where("userId", "==", uid), limit(1000)));
      for (const l of myLikes.docs) {
        const postId = l.ref.parent.parent?.id;
        if (!postId) continue;
        const b = writeBatch(db);
        b.delete(l.ref);
        b.update(doc(db, "ecosystem_feed", postId), { likeCount: increment(-1) });
        await b.commit().catch(() => {});
        await updateDoc(doc(db, "feed_thumbnails", postId), { likeCount: increment(-1) }).catch(() => {});
      }
    } catch (e) { console.warn("Like-document cleanup incomplete", e); }
    try {
      const liked = await getDocs(query(collection(db, "feed_thumbnails"), where("isPublic", "==", true), where("likes", "array-contains", uid), limit(500)));
      for (const l of liked.docs) {
        await updateDoc(doc(db, "ecosystem_feed", l.id), { likes: arrayRemove(uid) }).catch(() => {});
        await updateDoc(l.ref, { likes: arrayRemove(uid) }).catch(() => {});
      }
    } catch (e) { console.warn("Like cleanup incomplete", e); }

    step('Removing follows…');
    for (const target of await FirebaseService.getFollowingIds(uid, 1000)) {
      await FirebaseService.unfollowUser(target).catch(() => {});
    }
    try {
      const followers = await getDocs(collection(db, "users", uid, "followers"));
      // Follower docs live under our own profile; removing them is enough (their counters self-heal on next follow)
      await Promise.all(followers.docs.map(f => deleteDoc(f.ref).catch(() => {})));
    } catch { /* ignore */ }

    step('Removing private data…');
    for (const sub of ['drafts', 'private', 'notifications', 'saved', 'blocked', 'following']) {
      try {
        const snap = await getDocs(collection(db, "users", uid, sub));
        await Promise.all(snap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
      } catch { /* ignore */ }
    }
    await deleteDoc(doc(db, "naturalist_memories", uid)).catch(() => {});

    step('Removing uploaded media…');
    for (const folder of ['snapshots', 'videos', 'audio', 'avatars', 'drafts']) {
      try {
        const listing = await listAll(ref(storage, `${folder}/${uid}`));
        await Promise.all(listing.items.map(i => deleteObject(i).catch(() => {})));
      } catch { /* folder may not exist */ }
    }

    step('Closing your account…');
    await deleteDoc(doc(db, "users", uid)).catch(() => {});
    await deleteUser(me);
    try { localStorage.removeItem(`drafts_${uid}`); } catch { /* ignore */ }
  },

  /** Admin = custom claim `admin`, or the owner email once verified (matches security rules). */
  getAdminStatus: async (): Promise<{ isAdmin: boolean; needsVerification: boolean }> => {
    const u = auth.currentUser;
    if (!u || u.isAnonymous) return { isAdmin: false, needsVerification: false };
    try {
      const tok = await u.getIdTokenResult();
      if (tok.claims.admin === true) return { isAdmin: true, needsVerification: false };
    } catch { /* ignore */ }
    // Admin is the server-set custom claim only; the server checks again on every admin request
    return { isAdmin: false, needsVerification: false };
  },

  sendVerificationEmail: async () => {
    const u = auth.currentUser;
    if (!u) return;
    const r = await brandedAuthMail('/api/auth/send-verification', {}, await u.getIdToken(true).catch(() => ''));
    if (r === 'sent') return;
    if (r === 'limited') throw Object.assign(new Error('Too many requests'), { code: 'auth/too-many-requests' });
    await sendEmailVerification(u, { url: apiUrl('/welcome') })
      .catch((e) => /continue-uri|domain/.test(e?.code || '') ? sendEmailVerification(u) : Promise.reject(e));
  },

  /** Report a letters conversation; only then can the admin read it (through the server). */
  reportConversation: async (cid: string, reason: string, details?: string) => {
    const me = auth.currentUser?.uid;
    if (!me) throw new Error('Not signed in');
    await addDoc(collection(db, 'letter_reports'), { cid, reporterId: me, reason: reason.slice(0, 40), details: (details || '').slice(0, 500), status: 'open', createdAt: serverTimestamp() });
  },

  /** Report reasons are stored privately per reporter (admin-readable only). */
  getReportReasons: async (postId: string): Promise<{ reason: string; details?: string; createdAt?: any }[]> => {
    try {
      const snap = await getDocs(collection(db, "ecosystem_feed", postId, "reports"));
      return snap.docs.map(d => d.data() as any);
    } catch { return []; }
  },

  /**
   * One-time privacy migration (admin): moves precise GPS from public post documents
   * into the owner's private area. Nothing is deleted; coordinates are preserved privately.
   */
  migratePublicLocationsToPrivate: async (onProgress?: (done: number, total: number) => void): Promise<number> => {
    const snap = await getDocs(collection(db, "ecosystem_feed"));
    const targets = snap.docs.filter(d => {
      const data: any = d.data();
      return data.rawLocation || (Array.isArray(data.items) && data.items.some((i: any) => i && i.rawLocation));
    });
    let done = 0;
    for (const d of targets) {
      const data: any = d.data();
      const coords = Array.isArray(data.items) && data.items.length
        ? data.items.map((i: any) => i?.rawLocation || null)
        : [data.rawLocation || null];
      if (!coords[0] && data.rawLocation) coords[0] = data.rawLocation;
      if (data.userId) {
        await setDoc(doc(db, "users", data.userId, "private", `obs_${d.id}`), {
          postId: d.id, rawLocations: coords, migratedAt: serverTimestamp(),
        }, { merge: true });
      }
      const updates: any = { rawLocation: deleteField() };
      if (Array.isArray(data.items)) {
        updates.items = data.items.map((i: any) => { if (!i) return i; const { rawLocation, ...rest } = i; return rest; });
      }
      await updateDoc(doc(db, "ecosystem_feed", d.id), updates);
      done++;
      onProgress?.(done, targets.length);
    }
    return done;
  },

  getReportedPosts: async (): Promise<CommunityPost[]> => {
      const q = query(collection(db, "ecosystem_feed"), where("reportStatus", "==", "pending"));
      const snapshot = await getDocs(q);
      const posts: CommunityPost[] = [];
      snapshot.forEach(doc => {
          const data = doc.data();
          posts.push({ 
            id: doc.id, 
            ...data,
            labels: data.labels || (data.label ? [data.label] : ["Nature"])
          } as CommunityPost);
      });
      return posts;
  },

  dismissReports: async (postId: string) => {
      await updateDoc(doc(db, "ecosystem_feed", postId), { reports: [], reportStatus: 'safe' });
  },

  seedThemesMigration: async (): Promise<void> => {
    let processedCount = 0;
    const errors: string[] = [];

    for (const localTheme of NATURALIST_THEMES) {
      const id = localTheme.id;
      const url = localTheme.imageUrl;
      try {
        const docRef = doc(db, 'themes', id);
        
        let firebaseUrl = "";
        if (url) {
            const proxiedUrl = apiUrl(`/api/media-proxy?url=${encodeURIComponent(url)}`);
            
            let res: Response | null = null;
            try {
              res = await fetch(proxiedUrl, { cache: 'no-store' });
            } catch (xhrError: any) {
              console.warn(`Proxy fetch failed for theme ${id}, trying direct...`, xhrError);
            }

            // Direct fetch fallback if proxy failed or returned an error status
            if (!res || !res.ok) {
              console.log(`Fallback direct fetch for theme ${id}...`);
              res = await fetch(url, { cache: 'no-store' });
            }

            if (res && res.ok) {
               const blob = await res.blob();
               const storageRef = ref(storage, `themes/${id}.jpg`);
               await uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg' });
               firebaseUrl = await getDownloadURL(storageRef);
            } else {
               console.warn(`Could not fetch image for theme ${id}, seeding metadata only.`);
            }
        }

        const updatedFields: any = {
          id,
          naturalist: localTheme.naturalist || "",
          quote: localTheme.quote || "",
          locationName: localTheme.locationName || "",
          locationCaption: localTheme.locationCaption || "",
          colors: localTheme.colors || null,
          updatedAt: new Date().toISOString()
        };
        if (firebaseUrl) {
          updatedFields.imageUrl = firebaseUrl;
        }

        await setDoc(docRef, updatedFields, { merge: true });
        processedCount++;
      } catch (e: any) {
        console.error(`Failed to seed theme ${id}:`, e);
        errors.push(`${id}: ${e.message}`);
      }
    }
    
    if (processedCount === 0) {
      throw new Error(`Theme seeding failed completely! Details:\n${errors.slice(0, 3).join('\n')}`);
    }
    
    if (errors.length > 0) {
      console.warn(`Theme seeding finished with partial failures: ${errors.length} errors`);
    }
  },

  /** Admin: remove legacy demo posts that impersonated real naturalists. */
  purgeSeedObservations: async (): Promise<number> => {
    let n = 0;
    for (const id of ["seed_goodall_1", "seed_fossey_1", "seed_darwin_1", "seed_attenborough_1", "seed_cousteau_1"]) {
      try { await deleteDoc(doc(db, "feed_thumbnails", id)); } catch { /* may not exist */ }
      try { await deleteDoc(doc(db, "ecosystem_feed", id)); n++; } catch { /* may not exist */ }
    }
    return n;
  },

  getFullPost: async (postId: string): Promise<CommunityPost | null> => {
    try {
      const docRef = doc(db, "ecosystem_feed", postId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) return null;
      return { id: docSnap.id, ...docSnap.data() } as CommunityPost;
    } catch (e) {
      console.error("getFullPost failed:", e);
      return null;
    }
  },
  /** Share to the feed or keep journal-only. Joining the feed goes through the server's checks. */
  setPostVisibility: async (postId: string, isPublic: boolean): Promise<void> => {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(apiUrl(`/api/posts/${encodeURIComponent(postId)}/visibility`), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}`, ...(await appCheckHeaders()) },
        body: JSON.stringify({ isPublic }),
      });
      const out: any = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new PublishError(out.message || 'Could not change visibility.', out.code || 'unavailable', out);
  },

  updatePost: async (postId: string, updates: Partial<CommunityPost>) => {
      const MEDIA = ['imageUrl', 'videoUrl', 'audioUrl', 'thumbnailUrl', 'thumbSmallUrl', 'rotation'];
      const mediaChanged = Object.keys(updates).some(k => MEDIA.includes(k));
      if ('isPublic' in updates && !mediaChanged) {
          const { isPublic, ...rest } = updates as any;
          if (Object.keys(rest).length) await FirebaseService.updatePost(postId, rest);
          return FirebaseService.setPostVisibility(postId, !!isPublic);
      }
      if (mediaChanged) {
          // A changed picture leaves the feed until the server has checked it again
          const before = await getDoc(doc(db, "ecosystem_feed", postId));
          const wasPublic = before.exists() && before.data().isPublic === true;
          // The poster function finds a post by its clips' paths: keep them in step with a new clip
          const paths = before.exists() ? mediaPathsOf({ ...before.data(), ...updates }) : [];
          const withPaths = paths.length ? { mediaPaths: paths } : {};
          await updateDoc(doc(db, "ecosystem_feed", postId), { ...updates, ...withPaths, isPublic: false, moderation: { status: 'edited' } } as any);
          try { await deleteDoc(doc(db, "feed_thumbnails", postId)); } catch { /* may not exist */ }
          if (wasPublic) await FirebaseService.setPostVisibility(postId, true);
          return;
      }
      await updateDoc(doc(db, "ecosystem_feed", postId), updates);
      try {
          const allowed = ['caption', 'title', 'description', 'tags', 'labels', 'behavior', 'ethologicalDescriptors', 'locationArea', 'userName', 'userAvatar'];
          const thumbUpdates: any = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
          if (Object.keys(thumbUpdates).length > 0) {
              await updateDoc(doc(db, "feed_thumbnails", postId), thumbUpdates);
          }
      } catch (e) {
          /* journal-only sightings have no feed entry */
      }
      // Keep the search keys in step with the words (best effort: never undoes the edit above)
      if (['caption', 'title', 'tags', 'labels', 'locationArea', 'showLocation'].some(k => k in updates)) {
          try {
              const snap = await getDoc(doc(db, "ecosystem_feed", postId));
              if (snap.exists()) {
                  const tokens = searchTokensFor(snap.data());
                  if (!sameTokens(tokens, snap.data().searchTokens)) {
                      await updateDoc(doc(db, "ecosystem_feed", postId), { searchTokens: tokens });
                      await updateDoc(doc(db, "feed_thumbnails", postId), { searchTokens: tokens }).catch(() => {});
                  }
              }
          } catch { /* rules not deployed yet, or offline: the admin backfill catches up */ }
      }
  }
};
