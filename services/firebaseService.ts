
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
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  increment,
  writeBatch,
  deleteField,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
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
} from "firebase/auth";
import { auth, db, storage } from "../firebaseConfig";
import { GeminiConfig, CommunityPost, Snapshot, Comment, NaturalistMemory, UserProfileData, FieldNotification, ExpeditionDraft } from "../types";
import { SYSTEM_INSTRUCTION } from "../constants";
import { generateThumbnail, reencodeImage } from "../utils";

export const AI_CLIENT_POLICY_VERSION = "2026.11-1";
const PAGE_SIZE = 30;
export const ADMIN_EMAIL = "ram@iitj.ac.in";
import { NATURALIST_THEMES } from "../constants/naturalists";

import { DailyTheme } from "./themeService";

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
    return `/api/media-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
};

const DEFAULT_CONFIG: GeminiConfig = {
  model: 'gemini-2.5-flash-native-audio-latest',
  systemInstruction: SYSTEM_INSTRUCTION,
  knowledgeBaseFiles: [],
  trainingExamples: []
};

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
      return snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfileData));
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

  ensureUserProfile: async (userId: string, email?: string | null, isAnonymous: boolean = false) => {
    const docRef = doc(db, "users", userId);
    try {
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        const username = (email && email !== "Anonymous" ? email.split('@')[0] : `Explorer-${userId.slice(0, 4)}`).slice(0, 30);
        const profile: any = {
          uid: userId,
          username,
          isAnonymous,
          joinedAt: serverTimestamp(),
          lastVisit: serverTimestamp(),
          stats: { observations: 0, species: 0 }
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

  registerUser: async (email: string, pass: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    try {
        await FirebaseService.ensureUserProfile(cred.user.uid, email, false);
    } catch (err) {
        console.warn("Silent profile creation error caught during registerUser:", err);
    }
    return cred;
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

  saveDraft: async (userId: string, snapshots: Snapshot[], summary: string) => {
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
        associatedImages: cleanImg
      };
    });

    try {
      if (userId && userId !== 'explorer_guest' && auth.currentUser) {
        const draftRef = doc(collection(db, "users", userId, "drafts"));
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
      const newDraft = {
        id: "local_" + Date.now(),
        userId,
        snapshots: cleanSnapshots,
        summary,
        timestamp: { toDate: () => new Date() }
      };
      localDrafts.unshift(newDraft);
      localStorage.setItem(`drafts_${userId}`, JSON.stringify(localDrafts));
      return newDraft.id;
    } catch (err) {
      console.error("Local draft saving failed:", err);
      return "local_temp";
    }
  },

  getDrafts: async (userId: string): Promise<ExpeditionDraft[]> => {
    let firestoreDrafts: ExpeditionDraft[] = [];
    try {
      if (userId && userId !== 'explorer_guest' && auth.currentUser) {
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
      if (userId && userId !== 'explorer_guest' && auth.currentUser) {
        await deleteDoc(doc(db, "users", userId, "drafts", draftId));
      }
    } catch (e) {
      console.warn("Firestore deleteDraft failed:", e);
      handleFirestoreError(e, OperationType.DELETE, `users/${userId}/drafts/${draftId}`);
    }
  },

  uploadMedia: async (data: Blob | string, userId: string, type: 'image' | 'video' | 'audio'): Promise<string> => {
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
    else if (type === 'audio') ext = 'webm';
    else if (mime.includes('png')) ext = 'png';
    else if (mime.includes('webp')) ext = 'webp';

    const folder = type === 'image' ? 'snapshots' : (type === 'audio' ? 'audio' : 'videos');
    const filename = `${folder}/${userId}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    const storageRef = ref(storage, filename);
    await uploadBytes(storageRef, blob, { contentType: mime });
    return await getDownloadURL(storageRef);
  },

  /** Uploads all media for one snapshot and returns the public item (no precise location). */
  uploadSnapshotItem: async (snapshot: Snapshot, uid: string) => {
      let imageUrl: string | null = null;
      let thumbnailUrl: string | null = null;
      let originalImageUrl: string | null = null;
      const uploadSource = snapshot.blob || snapshot.url;
      if (uploadSource) {
          if (snapshot.blob && snapshot.type === 'image') {
              originalImageUrl = await FirebaseService.uploadMedia(snapshot.blob, uid, 'image');
              const thumbBlob = await generateThumbnail(snapshot.blob, 800);
              thumbnailUrl = await FirebaseService.uploadMedia(thumbBlob, uid, 'image');
              imageUrl = thumbnailUrl;
          } else {
              imageUrl = await FirebaseService.uploadMedia(uploadSource, uid, 'image');
          }
      }
      const videoUrl = snapshot.videoBlob ? await FirebaseService.uploadMedia(snapshot.videoBlob, uid, 'video') : (snapshot.videoUrl && snapshot.videoUrl.startsWith('https://') ? snapshot.videoUrl : null);
      const audioUrl = snapshot.audioBlob ? await FirebaseService.uploadMedia(snapshot.audioBlob, uid, 'audio') : (snapshot.audioUrl && snapshot.audioUrl.startsWith('https://') ? snapshot.audioUrl : null);
      const associatedImageUrls: string[] = snapshot.associatedImages?.length
          ? await Promise.all(snapshot.associatedImages.map(img => FirebaseService.uploadMedia(img.blob || img.url!, uid, 'image')))
          : [];
      return {
        imageUrl,
        thumbnailUrl,
        originalImageUrl,
        videoUrl,
        audioUrl,
        associatedImageUrls,
        mediaType: snapshot.type,
        labels: snapshot.labels || [],
        behavior: snapshot.behavior || "Observation.",
        aiInsight: snapshot.aiInsight || null,
        aiConfidence: snapshot.aiConfidence || null,
        locationArea: (snapshot as any).showLocation === false ? "" : (snapshot.locationArea || ""),
        showLocation: (snapshot as any).showLocation ?? false,
        rotation: snapshot.rotation || 0,
        timeToRecordMs: snapshot.timeToRecordMs || null,
        aiProposedLabels: snapshot.aiProposedLabels || null,
        aiProposedBehavior: snapshot.aiProposedBehavior || null,
        humanDelta: snapshot.humanDelta || false,
        sessionRetakes: snapshot.sessionRetakes || null,
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
      extra: { caption?: string, title?: string, description?: string, behavior?: string } = {}
  ) => {
      const effectiveUserId = userId || auth.currentUser?.uid;
      if (!effectiveUserId) throw new Error("No user found.");
      if (!snapshots.length) throw new Error("Nothing to publish.");

      const userProfile = await FirebaseService.getUserProfile(effectiveUserId);
      const userName = userProfile?.username || auth.currentUser?.displayName || `Explorer-${effectiveUserId.slice(0, 4)}`;

      const items = await Promise.all(snapshots.map(s => FirebaseService.uploadSnapshotItem(s, effectiveUserId)));
      const primaryItem = items[0];
      const allLabels = Array.from(new Set(items.flatMap(i => i.labels)));
      const cleanTags = Array.from(new Set(tags.map(t => (t.startsWith('#') ? t : `#${t}`).toLowerCase().replace(/\s+/g, '')))).slice(0, 30);
      const caption = (extra.caption || '').trim().slice(0, 2200);

      const postData: any = {
        userId: effectiveUserId,
        userName,
        userAvatar: userProfile?.avatarUrl || null,
        imageUrl: primaryItem.imageUrl,
        thumbnailUrl: primaryItem.thumbnailUrl,
        originalImageUrl: primaryItem.originalImageUrl,
        videoUrl: primaryItem.videoUrl,
        audioUrl: primaryItem.audioUrl,
        associatedImageUrls: primaryItem.associatedImageUrls,
        mediaType: primaryItem.mediaType,
        labels: allLabels,
        behavior: extra.behavior || extra.description || primaryItem.behavior,
        aiInsight: primaryItem.aiInsight,
        aiConfidence: primaryItem.aiConfidence,
        aiPolicyVersion: AI_CLIENT_POLICY_VERSION,
        locationArea: primaryItem.locationArea,
        showLocation: primaryItem.showLocation,
        tags: cleanTags,
        caption: caption || null,
        timestamp: serverTimestamp(),
        likes: [],
        commentCount: 0,
        isPublic: flags.feed,
        isJournal: flags.journal,
        reportStatus: 'safe',
        reports: [],
        isHybrid: snapshots.some(s => s.isHybrid || (s.associatedImages && s.associatedImages.length > 0)),
        items,
        rotation: primaryItem.rotation || 0,
        timeToRecordMs: primaryItem.timeToRecordMs || null,
        sessionRetakes: primaryItem.sessionRetakes || null,
        humanDelta: items.some(i => i.humanDelta),
      };
      if (extra.title) postData.title = extra.title.slice(0, 200);
      if (extra.description) postData.description = extra.description.slice(0, 5000);

      const docRef = await addDoc(collection(db, "ecosystem_feed"), postData);

      if (flags.feed) {
        await FirebaseService.upsertThumbnail(docRef.id, { ...postData, timestamp: postData.timestamp });
      }
      await FirebaseService.savePrivateObservationData(effectiveUserId, docRef.id, snapshots);

      try {
        await updateDoc(doc(db, "users", effectiveUserId), {
          "stats.observations": increment(items.length),
          "stats.species": increment(allLabels.length)
        });
      } catch (statsErr) {
        console.warn("Failed to update user stats:", statsErr);
      }
      return { id: docRef.id, url: primaryItem.imageUrl || undefined, videoUrl: primaryItem.videoUrl || undefined, audioUrl: primaryItem.audioUrl || undefined };
  },

  /** Writes the lightweight feed index document for a public post. */
  upsertThumbnail: async (postId: string, post: any) => {
      const thumbData: any = {
          id: postId,
          mediaType: post.mediaType || 'image',
          thumbnailUrl: post.thumbnailUrl || post.imageUrl || "",
          title: post.title || null,
          caption: post.caption || null,
          description: post.description || null,
          timestamp: post.timestamp || serverTimestamp(),
          userId: post.userId,
          userName: post.userName || null,
          userAvatar: post.userAvatar || null,
          likes: post.likes || [],
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

  getMorePosts: async (lastVisible: any, searchTag?: string | null): Promise<{ posts: CommunityPost[], lastVisible: any }> => {
      const normalizedTag = searchTag
          ? (searchTag.startsWith('#') ? searchTag : `#${searchTag}`).toLowerCase().replace(/\s+/g, '')
          : null;
      const build = (publicOnly: boolean) => {
          const c: any[] = [];
          if (normalizedTag) c.push(where("tags", "array-contains", normalizedTag));
          if (publicOnly) c.push(where("isPublic", "==", true));
          c.push(orderBy("timestamp", "desc"), limit(PAGE_SIZE));
          if (lastVisible) c.push(startAfter(lastVisible));
          return query(collection(db, "feed_thumbnails"), ...c);
      };
      let snapshot;
      try {
          snapshot = await getDocs(build(true));
      } catch (error: any) {
          // Index still building: fall back to an unfiltered query (works only under legacy rules)
          if (error?.code === 'failed-precondition') {
              snapshot = await getDocs(build(false));
          } else {
              handleFirestoreError(error, OperationType.GET, "feed_thumbnails");
              throw error;
          }
      }
      const posts: CommunityPost[] = [];
      snapshot.forEach((d) => {
          const data = d.data() as any;
          if (data.isPublic === true) {
              posts.push({ id: d.id, ...data, labels: data.labels || (data.label ? [data.label] : ["Nature"]) } as CommunityPost);
          }
      });
      return { posts, lastVisible: snapshot.docs.length === PAGE_SIZE ? snapshot.docs[snapshot.docs.length - 1] : null };
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

  toggleLike: async (postId: string, userId: string, isLiked: boolean) => {
    const postRef = doc(db, "ecosystem_feed", postId);
    await updateDoc(postRef, {
        likes: isLiked ? arrayRemove(userId) : arrayUnion(userId)
    });
    try {
        await updateDoc(doc(db, "feed_thumbnails", postId), {
            likes: isLiked ? arrayRemove(userId) : arrayUnion(userId)
        });
    } catch(e) {}
    
    if (!isLiked) try {
      const postSnap = await getDoc(postRef);
      if (postSnap.exists()) {
        const postData = postSnap.data();
        if (postData.userId !== userId) {
          const userProfile = await FirebaseService.getUserProfile(userId);
          await FirebaseService.addNotification(postData.userId, {
            type: 'like',
            message: `${userProfile?.username || 'An explorer'} liked your sighting of ${postData.labels?.[0] || 'Nature'}.`,
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
            message: `${userName} commented: "${clean.slice(0, 80)}${clean.length > 80 ? '…' : ''}"`,
            postId,
            senderId: userId,
            senderName: userName
          });
        }
      }
    } catch (notifErr) {
      console.warn("Comment notification skipped:", notifErr);
    }
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
        snapshot.forEach(doc => comments.push({ id: doc.id, ...doc.data() } as Comment));
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
    const q = query(collection(db, "users", userId, "notifications"), orderBy("timestamp", "desc"), limit(20));
    return onSnapshot(q, (snapshot) => {
      const notifs: FieldNotification[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        notifs.push({ id: doc.id, ...data } as FieldNotification);
      });
      callback(notifs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${userId}/notifications`);
    });
  },

  markNotificationRead: async (userId: string, notifId: string) => {
    await updateDoc(doc(db, "users", userId, "notifications", notifId), { isRead: true });
  },

  /** Admin = custom claim `admin`, or the owner email once verified (matches security rules). */
  getAdminStatus: async (): Promise<{ isAdmin: boolean; needsVerification: boolean }> => {
    const u = auth.currentUser;
    if (!u || u.isAnonymous) return { isAdmin: false, needsVerification: false };
    try {
      const tok = await u.getIdTokenResult();
      if (tok.claims.admin === true) return { isAdmin: true, needsVerification: false };
    } catch { /* ignore */ }
    if (u.email === ADMIN_EMAIL) return { isAdmin: u.emailVerified, needsVerification: !u.emailVerified };
    return { isAdmin: false, needsVerification: false };
  },

  sendVerificationEmail: async () => {
    if (auth.currentUser) await sendEmailVerification(auth.currentUser);
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
            const proxiedUrl = `/api/media-proxy?url=${encodeURIComponent(url)}`;
            
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

  seedDefaultObservationsIfNeeded: async (): Promise<void> => {
    try {
      const q = query(collection(db, "feed_thumbnails"), limit(5));
      const snap = await getDocs(q);
      if (snap.size >= 3) {
        return; // Content density is healthy; skip seeding
      }
      
      console.log("Low density or no observations found in feed_thumbnails. Seeding default observations...");
      
      const seedItems = [
        {
          id: "seed_goodall_1",
          userId: "system_seeder_goodall",
          userName: "Jane Goodall",
          imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Gombe_Stream_NP_Mutter_und_Kind.jpg/1280px-Gombe_Stream_NP_Mutter_und_Kind.jpg",
          thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Gombe_Stream_NP_Mutter_und_Kind.jpg/1280px-Gombe_Stream_NP_Mutter_und_Kind.jpg",
          mediaType: "image",
          labels: ["Chimpanzee", "Primate", "Hominidae"],
          behavior: "Observed mother chimpanzee protective behavior with infant in the lush forests of Gombe. Fascinating social hierarchy dynamics.",
          aiInsight: "This high-fidelity sighting confirms a strong emotional and physical bond between primate mother and offspring, showcasing mutual grooming and behavioral feedback loops.",
          locationArea: "Gombe Stream, Tanzania",
          showLocation: true,
          tags: ["#chimpanzee", "#primate", "#gombe", "#wildlife"],
          timestamp: new Date(Date.now() - 3600000 * 5), // 5 hours ago
          likes: [],
          commentCount: 0,
          isPublic: true,
          isJournal: true,
          reportStatus: "safe",
          reports: [],
          isHybrid: false
        },
        {
          id: "seed_fossey_1",
          userId: "system_seeder_fossey",
          userName: "Dian Fossey",
          imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Virunga_National_Park_Landscape.jpg/1280px-Virunga_National_Park_Landscape.jpg",
          thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Virunga_National_Park_Landscape.jpg/1280px-Virunga_National_Park_Landscape.jpg",
          mediaType: "image",
          labels: ["Mountain Gorilla", "Silverback", "Primates"],
          behavior: "Observed an adult Silverback Mountain Gorilla maintaining a defensive posture while feeding on celery stalks in dense foliage.",
          aiInsight: "Sighting of key sentinel silverback gorilla signaling group boundaries and territory cohesion in the bamboo zone of the Virungas.",
          locationArea: "Virunga Mountains, Rwanda",
          showLocation: true,
          tags: ["#gorilla", "#silverback", "#virunga", "#primates"],
          timestamp: new Date(Date.now() - 3600000 * 12), // 12 hours ago
          likes: [],
          commentCount: 0,
          isPublic: true,
          isJournal: true,
          reportStatus: "safe",
          reports: [],
          isHybrid: false
        },
        {
          id: "seed_darwin_1",
          userId: "system_seeder_darwin",
          userName: "Charles Darwin",
          imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Lobo_marino_%28Zalophus_californianus_wollebaeki%29%2C_Punta_Pitt%2C_isla_de_San_Crist%C3%B3bal%2C_islas_Gal%C3%A1pagos%2C_Ecuador%2C_2015-07-24%2C_DD_11.JPG/1280px-Lobo_marino_%28Zalophus_californianus_wollebaeki%29%2C_Punta_Pitt%2C_isla_de_San_Crist%C3%B3bal%2C_islas_Gal%C3%A1pagos%2C_Ecuador%2C_2015-07-24%2C_DD_11.JPG",
          thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Lobo_marino_%28Zalophus_californianus_wollebaeki%29%2C_Punta_Pitt%2C_isla_de_San_Crist%C3%B3bal%2C_islas_Gal%C3%A1pagos%2C_Ecuador%2C_2015-07-24%2C_DD_11.JPG/1280px-Lobo_marino_%28Zalophus_californianus_wollebaeki%29%2C_Punta_Pitt%2C_isla_de_San_Crist%C3%B3bal%2C_islas_Gal%C3%A1pagos%2C_Ecuador%2C_2015-07-24%2C_DD_11.JPG",
          mediaType: "image",
          labels: ["Galapagos Sea Lion", "Otariidae", "Marine Mammal"],
          behavior: "Sighted Galapagos sea lion resting on volcanic stones at Punta Pitt. Exibits remarkable thermal dissipation adaptations.",
          aiInsight: "Sea lion hauling-out behavior on volcanic shoreline illustrates adaptive thermoregulation in micro-climate coastal conditions.",
          locationArea: "Galápagos Islands, Ecuador",
          showLocation: true,
          tags: ["#sealion", "#galapagos", "#evolution", "#marinelife"],
          timestamp: new Date(Date.now() - 3600000 * 24), // 24 hours ago
          likes: [],
          commentCount: 0,
          isPublic: true,
          isJournal: true,
          reportStatus: "safe",
          reports: [],
          isHybrid: false
        },
        {
          id: "seed_attenborough_1",
          userId: "system_seeder_attenborough",
          userName: "David Attenborough",
          imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Serengeti_National_Park_-_Zebras_01.jpg/1280px-Serengeti_National_Park_-_Zebras_01.jpg",
          thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Serengeti_National_Park_-_Zebras_01.jpg/1280px-Serengeti_National_Park_-_Zebras_01.jpg",
          mediaType: "image",
          labels: ["Plains Zebra", "Equidae", "Ungulate"],
          behavior: "A small herd of Plains Zebras grazing peacefully of fresh grass shoots during the Great Migration cycle across the grassland plains.",
          aiInsight: "Zebra striping mechanisms serve both social cohesion and motion-dazzle camouflage against predators under direct sunlight.",
          locationArea: "Serengeti, Tanzania",
          showLocation: true,
          tags: ["#zebra", "#serengeti", "#greatmigration", "#savannah"],
          timestamp: new Date(Date.now() - 3600000 * 48), // 2 days ago
          likes: [],
          commentCount: 0,
          isPublic: true,
          isJournal: true,
          reportStatus: "safe",
          reports: [],
          isHybrid: false
        },
        {
          id: "seed_cousteau_1",
          userId: "system_seeder_cousteau",
          userName: "Jacques-Yves Cousteau",
          imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Coral_reef_in_the_Red_Sea.jpg/1280px-Coral_reef_in_the_Red_Sea.jpg",
          thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Coral_reef_in_the_Red_Sea.jpg/1280px-Coral_reef_in_the_Red_Sea.jpg",
          mediaType: "image",
          labels: ["Acropora Coral", "Coral Reef", "Scleractinia"],
          behavior: "Explored an extremely healthy and vibrant coral reef system. High density of diverse colorful reef fish and massive coral heads.",
          aiInsight: "Red Sea coral reef systems show anomalous thermal tolerance, serving as a critical genetic refuge against rising global sea temperatures.",
          locationArea: "The Red Sea",
          showLocation: true,
          tags: ["#coral", "#coralreef", "#redsea", "#divers"],
          timestamp: new Date(Date.now() - 3600000 * 72), // 3 days ago
          likes: [],
          commentCount: 0,
          isPublic: true,
          isJournal: true,
          reportStatus: "safe",
          reports: [],
          isHybrid: false
        }
      ];

      for (const item of seedItems) {
        const postDocRef = doc(db, "ecosystem_feed", item.id);
        const thumbDocRef = doc(db, "feed_thumbnails", item.id);
        
        let sampleItemsList = [
          {
            imageUrl: item.imageUrl,
            thumbnailUrl: item.thumbnailUrl,
            originalImageUrl: item.imageUrl,
            mediaType: item.mediaType as 'image' | 'video' | 'audio',
            labels: item.labels,
            behavior: item.behavior,
            aiInsight: item.aiInsight,
            locationArea: item.locationArea,
            showLocation: item.showLocation,
            rotation: 0
          }
        ];
        
        const fullPostData = {
          userId: item.userId,
          userName: item.userName,
          imageUrl: item.imageUrl,
          thumbnailUrl: item.thumbnailUrl,
          originalImageUrl: item.imageUrl,
          mediaType: item.mediaType,
          labels: item.labels,
          behavior: item.behavior,
          aiInsight: item.aiInsight,
          locationArea: item.locationArea,
          showLocation: item.showLocation,
          tags: item.tags,
          timestamp: item.timestamp,
          likes: item.likes,
          commentCount: item.commentCount,
          isPublic: item.isPublic,
          isJournal: item.isJournal,
          reportStatus: item.reportStatus,
          reports: item.reports,
          isHybrid: item.isHybrid,
          items: sampleItemsList
        };

        const thumbData = {
          id: item.id,
          mediaType: item.mediaType as 'image' | 'video' | 'audio',
          thumbnailUrl: item.thumbnailUrl,
          timestamp: item.timestamp,
          userId: item.userId,
          userName: item.userName,
          likes: item.likes,
          commentCount: item.commentCount,
          isPublic: item.isPublic,
          tags: item.tags,
          labels: item.labels,
          behavior: item.behavior,
          aiInsight: item.aiInsight,
          locationArea: item.locationArea,
          isHybrid: item.isHybrid
        };

        await setDoc(postDocRef, fullPostData);
        await setDoc(thumbDocRef, thumbData);
      }
      console.log("Seeded 5 default observations successfully into Firestore!");
    } catch (e) {
      console.warn("Skipped seeding observations:", e);
    }
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
  updatePost: async (postId: string, updates: Partial<CommunityPost>) => {
      await updateDoc(doc(db, "ecosystem_feed", postId), updates);
      if (updates.isPublic === false) {
          try { await deleteDoc(doc(db, "feed_thumbnails", postId)); } catch (e) { /* may not exist */ }
          return;
      }
      if (updates.isPublic === true) {
          const fresh = await getDoc(doc(db, "ecosystem_feed", postId));
          const thumb = await getDoc(doc(db, "feed_thumbnails", postId)).catch(() => null);
          if (fresh.exists() && !(thumb && thumb.exists())) {
              await FirebaseService.upsertThumbnail(postId, fresh.data());
              return;
          }
      }
      try {
          const thumbUpdates = { ...updates };
          delete thumbUpdates.items;
          delete thumbUpdates.imageUrl;
          delete thumbUpdates.videoUrl;
          delete thumbUpdates.audioUrl;
          delete thumbUpdates.originalImageUrl;
          delete thumbUpdates.associatedImageUrls;
          delete thumbUpdates.reports;
          delete thumbUpdates.reportStatus;
          delete thumbUpdates.showLocation;
          delete thumbUpdates.isJournal;
          delete (thumbUpdates as any).rawLocation;
          if (Object.keys(thumbUpdates).length > 0) {
              await updateDoc(doc(db, "feed_thumbnails", postId), thumbUpdates);
          }
      } catch (e) {
          console.warn("Could not update feed_thumbnails:", e);
      }
  }
};
