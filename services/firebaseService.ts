
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
} from "firebase/auth";
import { auth, db, storage } from "../firebaseConfig";
import { GeminiConfig, CommunityPost, Snapshot, Comment, NaturalistMemory, UserProfileData, FieldNotification, ExpeditionDraft, AiUsageLogEntry } from "../types";
import { SYSTEM_INSTRUCTION } from "../constants";
import { generateThumbnail, stripImageMetadata } from "../utils";
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

// Runs the automated content-safety pre-screen (GenAiService.checkContentSafety)
// on a post's primary media and returns the reportStatus/reports fields to
// merge into the new post doc. Flagged content lands in AdminConsole's
// existing moderation queue (reportStatus: 'pending') instead of being
// blocked outright — see checkContentSafety for the fail-open rationale.
// Dynamically imports genAiService to avoid a static circular import
// (genAiService.ts imports FirebaseService for usage telemetry).
async function screenPostSafety(mediaBlob: Blob | undefined | null): Promise<{ reportStatus: 'safe' | 'pending', reports: { reason: string, timestamp: any }[] }> {
  const { GenAiService } = await import('./genAiService');
  const safety = await GenAiService.checkContentSafety(mediaBlob);
  if (safety.isSafe) {
    return { reportStatus: 'safe', reports: [] };
  }
  return {
    reportStatus: 'pending',
    reports: [{ reason: `Automated screening: ${safety.reason}`, timestamp: Date.now() }]
  };
}


// Firebase Storage's download endpoint (firebasestorage.googleapis.com)
// already sends "Access-Control-Allow-Origin: *" on every response, so
// browser fetch()/canvas access works directly — verified against a live
// download URL, not assumed. This used to route through a server-side
// /api/media-proxy hop for exactly that reason; that hop has been removed
// as unnecessary latency/cost. Kept as a pass-through (rather than
// inlining at each call site) so callers don't need to change.
export const getCorsProxyUrl = (url: string) => url;

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

  ensureUserProfile: async (userId: string, email?: string | null, isAnonymous: boolean = false, locationData: string = "") => {
    const docRef = doc(db, "users", userId);
    try {
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        const username = email && email !== "Anonymous" ? email.split('@')[0] : `Explorer-${userId.slice(0, 4)}`;
        const profile: any = {
          uid: userId,
          username,
          isAnonymous,
          location: locationData,
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
        if (locationData && data.isAnonymous) {
            updates.location = locationData;
        }
        try {
          await updateDoc(docRef, updates);
        } catch (updErr) {
          console.warn("Failed to update user profile in ensureUserProfile:", updErr);
        }
        return { ...data, ...updates } as UserProfileData;
      }
    } catch (e) {
      console.warn("Failed to retrieve user profile in ensureUserProfile:", e);
      const username = email && email !== "Anonymous" ? email.split('@')[0] : `Explorer-${userId.slice(0, 4)}`;
      return {
        uid: userId,
        username,
        isAnonymous,
        location: locationData,
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
    let locationData = "Unknown Location";
    try {
        const res = await fetch('https://ipapi.co/json/');
        if (res.ok) {
            const data = await res.json();
            if (data && data.city) {
                locationData = `${data.city}, ${data.region}, ${data.country_name}`;
            }
        }
    } catch(e) {
        console.warn("Could not fetch geolocation.", e);
    }
    try {
        await FirebaseService.ensureUserProfile(cred.user.uid, "Anonymous", true, locationData);
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
        // Migration: Update old model name to supported version
        if (data.model && (data.model.includes('gemini-2.5-flash-native') || data.model === 'gemini-2.0-flash')) {
          data.model = 'gemini-2.5-flash-native-audio-latest';
          await updateDoc(docRef, { model: data.model });
        }
        return data;
      } else {
        await setDoc(docRef, DEFAULT_CONFIG);
        return DEFAULT_CONFIG;
      }
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
        const response = await fetch(getCorsProxyUrl(data));
        blob = await response.blob();
    } else { blob = data; }

    const mime = blob.type;
    let ext = 'jpg'; 
    if (type === 'video') ext = 'mp4';
    else if (type === 'audio') ext = 'webm';
    else if (mime.includes('png')) ext = 'png';

    const uniqueId = Math.random().toString(36).substring(2, 9);
    const folder = type === 'image' ? 'snapshots' : (type === 'audio' ? 'audio' : 'videos');
    const filename = `${folder}/${userId}/${Date.now()}_${uniqueId}.${ext}`;
    const storageRef = ref(storage, filename);
    await uploadBytes(storageRef, blob, { contentType: mime });
    return await getDownloadURL(storageRef);
  },

  createSessionObservation: async (snapshots: Snapshot[], userId: string, flags: { feed: boolean, journal: boolean }, tags: string[], synthesizedData?: { title: string, description: string }) => {
    try {
      const effectiveUserId = userId || auth.currentUser?.uid;
      if (!effectiveUserId) throw new Error("No user found.");

      const userProfile = await FirebaseService.getUserProfile(effectiveUserId);
      const userName = userProfile?.username || auth.currentUser?.displayName || `Explorer-${effectiveUserId.slice(0, 4)}`;

      const items = await Promise.all(snapshots.map(async (snapshot) => {
          let publicUrl: string | undefined = undefined;
          let thumbnailUrl: string | undefined = undefined;
          let originalImageUrl: string | undefined = undefined;
          const uploadSource = snapshot.blob || snapshot.url;
          if (uploadSource) {
              if (snapshot.blob && snapshot.type === 'image') {
                  // Strip EXIF/GPS metadata before uploading the full-resolution
                  // "original" — matters most for gallery-picked photos (live
                  // camera captures never carry EXIF to begin with, since
                  // they're synthesized via canvas already).
                  const strippedBlob = await stripImageMetadata(snapshot.blob);
                  originalImageUrl = await FirebaseService.uploadMedia(strippedBlob, effectiveUserId, 'image');
                  const thumbBlob = await generateThumbnail(snapshot.blob, 800);
                  publicUrl = await FirebaseService.uploadMedia(thumbBlob, effectiveUserId, 'image');
                  thumbnailUrl = publicUrl;
              } else {
                  publicUrl = await FirebaseService.uploadMedia(uploadSource, effectiveUserId, 'image');
              }
          }
          
          let videoUrl: string | undefined = undefined;
          if (snapshot.videoBlob) {
            videoUrl = await FirebaseService.uploadMedia(snapshot.videoBlob, effectiveUserId, 'video');
          }

          let audioUrl: string | undefined = undefined;
          if (snapshot.audioBlob) {
              audioUrl = await FirebaseService.uploadMedia(snapshot.audioBlob, effectiveUserId, 'audio');
          }

          let associatedImageUrls: string[] = [];
          if (snapshot.associatedImages && snapshot.associatedImages.length > 0) {
              associatedImageUrls = await Promise.all(
                  snapshot.associatedImages.map(img => 
                      FirebaseService.uploadMedia(img.blob || img.url!, effectiveUserId, 'image')
                  )
              );
          }

          return {
            imageUrl: publicUrl || null,
            thumbnailUrl: thumbnailUrl || null,
            originalImageUrl: originalImageUrl || null,
            videoUrl: videoUrl || null,
            audioUrl: audioUrl || null,
            associatedImageUrls: associatedImageUrls,
            mediaType: snapshot.type,
            labels: snapshot.labels || [],
            behavior: snapshot.behavior || "Observation.",
            aiInsight: snapshot.aiInsight || null,
            locationArea: snapshot.locationArea || "",
            showLocation: (snapshot as any).showLocation ?? true,
            rotation: snapshot.rotation || 0,
            rawLocation: snapshot.rawLocation || null,
            timeToRecordMs: snapshot.timeToRecordMs || null,
            aiProposedLabels: snapshot.aiProposedLabels || null,
            aiProposedBehavior: snapshot.aiProposedBehavior || null,
            humanDelta: snapshot.humanDelta || false,
            sessionRetakes: snapshot.sessionRetakes || null,
          };
      }));

      if (items.length === 0) throw new Error("No items to upload.");

      const primaryItem = items[0];
      const allLabels = new Set<string>();
      items.forEach(item => item.labels.forEach(l => allLabels.add(l)));

      const primarySnapshot = snapshots[0];
      const safetyCheckBlob = primaryItem.mediaType === 'video' ? primarySnapshot.videoBlob
        : primaryItem.mediaType === 'audio' ? primarySnapshot.audioBlob
        : primarySnapshot.blob;
      const moderation = await screenPostSafety(safetyCheckBlob);

      const postData: any = {
        userId: effectiveUserId,
        userName: userName,
        imageUrl: primaryItem.imageUrl,
        thumbnailUrl: primaryItem.thumbnailUrl,
        originalImageUrl: primaryItem.originalImageUrl,
        videoUrl: primaryItem.videoUrl,
        audioUrl: primaryItem.audioUrl,
        associatedImageUrls: primaryItem.associatedImageUrls,
        mediaType: primaryItem.mediaType,
        labels: Array.from(allLabels),
        behavior: synthesizedData ? synthesizedData.description : primaryItem.behavior,
        aiInsight: primaryItem.aiInsight,
        locationArea: primaryItem.locationArea,
        showLocation: primaryItem.showLocation,
        tags: tags,
        timestamp: serverTimestamp(),
        likes: [],
        commentCount: 0,
        isPublic: flags.feed,
        isJournal: flags.journal,
        reportStatus: moderation.reportStatus,
        reports: moderation.reports,
        isHybrid: snapshots.some(s => s.isHybrid || (s.associatedImages && s.associatedImages.length > 0)),
        items: items,
        rotation: primaryItem.rotation || 0,
        rawLocation: primaryItem.rawLocation || null,
        timeToRecordMs: primaryItem.timeToRecordMs || null,
        sessionRetakes: primaryItem.sessionRetakes || null,
        humanDelta: primaryItem.humanDelta || false,
      };

      if (synthesizedData) {
          postData.title = synthesizedData.title;
          postData.description = synthesizedData.description;
      }

      const docRef = await addDoc(collection(db, "ecosystem_feed"), postData);
      
      const thumbData = {
          id: docRef.id,
          mediaType: primaryItem.mediaType,
          thumbnailUrl: primaryItem.thumbnailUrl || primaryItem.imageUrl || "",
          title: synthesizedData?.title || null,
          description: synthesizedData?.description || null,
          timestamp: postData.timestamp,
          userId: effectiveUserId,
          userName: userName,
          likes: [],
          commentCount: 0,
          isPublic: flags.feed,
          tags: tags,
          labels: Array.from(allLabels),
          behavior: synthesizedData?.description || primaryItem.behavior || "",
          aiInsight: primaryItem.aiInsight || null,
          locationArea: primaryItem.locationArea || "",
          isHybrid: postData.isHybrid,
          reportStatus: moderation.reportStatus,
          reports: moderation.reports
      };
      await setDoc(doc(db, "feed_thumbnails", docRef.id), thumbData);
      
      try {
        await updateDoc(doc(db, "users", effectiveUserId), { 
          "stats.observations": increment(items.length),
          "stats.species": increment(allLabels.size) 
        });
      } catch (statsErr) {
        console.warn("Failed to update user stats in createSessionObservation:", statsErr);
      }
      return { id: docRef.id };
    } catch (e) {
      console.error("Error creating session observation:", e);
      throw e;
    }
  },

  createObservation: async (snapshot: Snapshot, userId: string, flags: { feed: boolean, journal: boolean }, synthesis: string, tags: string[]) => {
    try {
      const effectiveUserId = userId || auth.currentUser?.uid;
      if (!effectiveUserId) throw new Error("No user found.");

      const userProfile = await FirebaseService.getUserProfile(effectiveUserId);
      const userName = userProfile?.username || auth.currentUser?.displayName || `Explorer-${effectiveUserId.slice(0, 4)}`;

      let publicUrl: string | undefined = undefined;
      let thumbnailUrl: string | undefined = undefined;
      let originalImageUrl: string | undefined = undefined;
      const uploadSource = snapshot.blob || snapshot.url;
      if (uploadSource) {
          if (snapshot.blob && snapshot.type === 'image') {
              // Strip EXIF/GPS metadata before uploading the full-resolution
              // "original" — matters most for gallery-picked photos (live
              // camera captures never carry EXIF to begin with, since
              // they're synthesized via canvas already).
              const strippedBlob = await stripImageMetadata(snapshot.blob);
              originalImageUrl = await FirebaseService.uploadMedia(strippedBlob, effectiveUserId, 'image');
              const thumbBlob = await generateThumbnail(snapshot.blob, 800);
              publicUrl = await FirebaseService.uploadMedia(thumbBlob, effectiveUserId, 'image');
              thumbnailUrl = publicUrl;
          } else {
              publicUrl = await FirebaseService.uploadMedia(uploadSource, effectiveUserId, 'image');
          }
      }
      
      let videoUrl: string | undefined = undefined;
      if (snapshot.videoBlob) {
        videoUrl = await FirebaseService.uploadMedia(snapshot.videoBlob, effectiveUserId, 'video');
      }

      let audioUrl: string | undefined = undefined;
      if (snapshot.audioBlob) {
          audioUrl = await FirebaseService.uploadMedia(snapshot.audioBlob, effectiveUserId, 'audio');
      }

      let associatedImageUrls: string[] = [];
      if (snapshot.associatedImages && snapshot.associatedImages.length > 0) {
          associatedImageUrls = await Promise.all(
              snapshot.associatedImages.map(img =>
                  FirebaseService.uploadMedia(img.blob || img.url!, effectiveUserId, 'image')
              )
          );
      }

      const safetyCheckBlob = snapshot.type === 'video' ? snapshot.videoBlob
        : snapshot.type === 'audio' ? snapshot.audioBlob
        : snapshot.blob;
      const moderation = await screenPostSafety(safetyCheckBlob);

      const postData: any = {
        userId: effectiveUserId,
        userName: userName,
        imageUrl: publicUrl || null,
        thumbnailUrl: thumbnailUrl || null,
        originalImageUrl: originalImageUrl || null,
        videoUrl: videoUrl || null,
        audioUrl: audioUrl || null,
        associatedImageUrls: associatedImageUrls,
        mediaType: snapshot.type,
        labels: snapshot.labels,
        behavior: synthesis,
        aiInsight: snapshot.aiInsight || null,
        locationArea: snapshot.locationArea || "",
        showLocation: (snapshot as any).showLocation ?? true,
        tags: tags,
        timestamp: serverTimestamp(),
        likes: [],
        commentCount: 0,
        isPublic: flags.feed,
        isJournal: flags.journal,
        reportStatus: moderation.reportStatus,
        reports: moderation.reports,
        isHybrid: snapshot.isHybrid || associatedImageUrls.length > 0,
        rotation: snapshot.rotation || 0,
        rawLocation: snapshot.rawLocation || null,
        timeToRecordMs: snapshot.timeToRecordMs || null,
        aiProposedLabels: snapshot.aiProposedLabels || null,
        aiProposedBehavior: snapshot.aiProposedBehavior || null,
        sessionRetakes: snapshot.sessionRetakes || null,
        humanDelta: snapshot.humanDelta || false,
      };

      const docRef = await addDoc(collection(db, "ecosystem_feed"), postData);
      
      const thumbData = {
          id: docRef.id,
          mediaType: snapshot.type,
          thumbnailUrl: thumbnailUrl || publicUrl || "",
          timestamp: postData.timestamp,
          userId: effectiveUserId,
          userName: userName,
          likes: [],
          commentCount: 0,
          isPublic: flags.feed,
          tags: tags,
          labels: snapshot.labels || [],
          behavior: synthesis,
          aiInsight: snapshot.aiInsight || null,
          locationArea: snapshot.locationArea || "",
          isHybrid: postData.isHybrid,
          reportStatus: moderation.reportStatus,
          reports: moderation.reports
      };
      await setDoc(doc(db, "feed_thumbnails", docRef.id), thumbData);
      
      try {
        await updateDoc(doc(db, "users", effectiveUserId), { 
          "stats.observations": increment(1),
          "stats.species": increment(snapshot.labels.length) 
        });
      } catch (statsErr) {
        console.warn("Failed to update user stats in createObservation:", statsErr);
      }
      return { id: docRef.id, url: publicUrl, videoUrl, audioUrl };
    } catch (e) {
      console.error("Error creating observation:", e);
      throw e;
    }
  },

  subscribeToFeed: (callback: (posts: CommunityPost[]) => void, searchTag?: string | null) => {
    let q;
    if (searchTag) {
        const normalizedTag = searchTag.startsWith('#') ? searchTag : `#${searchTag.toLowerCase().replace(/\s+/g, '')}`;
        // isPublic is filtered at the query level (every write path sets it
        // explicitly — see getMorePosts for the fuller rationale); bounded
        // with orderBy+limit like the non-tag branch below, since this was
        // previously unbounded (a live listener with no cap on result size).
        q = query(
            collection(db, "feed_thumbnails"),
            where("tags", "array-contains", normalizedTag),
            where("isPublic", "==", true),
            orderBy("timestamp", "desc"),
            limit(20)
        );
    } else {
        q = query(
            collection(db, "feed_thumbnails"),
            where("isPublic", "==", true),
            orderBy("timestamp", "desc"),
            limit(20)
        );
    }

    return onSnapshot(q, (snapshot) => {
      const posts: CommunityPost[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        // reportStatus stays a client-side filter deliberately: unlike
        // isPublic (always explicitly set), older/seed posts predate this
        // field entirely, and a Firestore "==" filter would treat a missing
        // field as non-matching — silently hiding all of them from the
        // feed. This is also why it's "!== 'pending'" rather than
        // "=== 'safe'": absent is treated as safe, not excluded.
        if (data.reportStatus !== 'pending') {
          posts.push({
            id: doc.id,
            ...data,
            labels: data.labels || (data.label ? [data.label] : ["Nature"])
          } as CommunityPost);
        }
      });

      // Always sort the array by timestamp descending to ensure perfect ordering without composite indexes
      posts.sort((a, b) => {
        const getT = (ts: any) => ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : (ts ? new Date(ts).getTime() : 0));
        return getT(b.timestamp) - getT(a.timestamp);
      });

      callback(posts);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "feed_thumbnails");
    });
  },

  getMorePosts: async (lastVisible: any, searchTag?: string | null): Promise<{ posts: CommunityPost[], lastVisible: any }> => {
      // isPublic is filtered at the query level below — every write path
      // sets it explicitly (post creation, seed data, migrations), so
      // there's no "missing field" case to worry about, unlike
      // reportStatus (see the client-side filter below for why that one's
      // different). Filtering it in the query — rather than fetching a
      // fixed-size page and discarding non-public rows afterward — is what
      // actually fixes pagination: previously, a page could come back
      // mostly (or entirely) private/journal-only posts and silently
      // shrink well below the requested limit.
      let q;
      if (searchTag) {
          const normalizedTag = searchTag.startsWith('#') ? searchTag : `#${searchTag.toLowerCase().replace(/\s+/g, '')}`;
          const queryConstraints: any[] = [
              where("tags", "array-contains", normalizedTag),
              where("isPublic", "==", true),
              orderBy("timestamp", "desc"),
              limit(50)
          ];
          if (lastVisible) {
              queryConstraints.push(startAfter(lastVisible));
          }
          q = query(collection(db, "feed_thumbnails"), ...queryConstraints);
      } else {
          const queryConstraints: any[] = [
              where("isPublic", "==", true),
              orderBy("timestamp", "desc"),
              limit(50)
          ];
          if (lastVisible) {
              queryConstraints.push(startAfter(lastVisible));
          }
          q = query(
              collection(db, "feed_thumbnails"),
              ...queryConstraints
          );
      }

      try {
          let snapshot = await getDocs(q);

          if (snapshot.empty && !lastVisible && !searchTag) {
              await FirebaseService.seedDefaultObservationsIfNeeded();
              snapshot = await getDocs(q);
          }

          let posts: CommunityPost[] = [];
          snapshot.forEach((doc) => {
              const data = doc.data() as any;
              // See subscribeToFeed for why reportStatus stays a
              // client-side check instead of a query filter.
              if (data.reportStatus !== 'pending') {
                  posts.push({
                    id: doc.id,
                    ...data,
                    labels: data.labels || (data.label ? [data.label] : ["Nature"])
                  } as CommunityPost);
              }
          });

          return { posts, lastVisible: snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null };
      } catch (error) {
          handleFirestoreError(error, OperationType.GET, "feed_thumbnails");
          throw error;
      }
  },

  subscribeToUserJournal: (userId: string, callback: (posts: CommunityPost[]) => void) => {
    const q = query(
        collection(db, "ecosystem_feed"), 
        where("userId", "==", userId)
    );
    return onSnapshot(q, (snapshot) => {
      const posts: CommunityPost[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.isJournal !== false) {
          posts.push({ 
            id: doc.id, 
            ...data,
            labels: data.labels || (data.label ? [data.label] : ["Nature"])
          } as CommunityPost);
        }
      });

      // Sort in memory by timestamp/createdAt descending
      const getT = (docData: any) => {
          const ts = docData.createdAt || docData.timestamp;
          if (!ts) return 0;
          if (ts.toMillis) return ts.toMillis();
          if (ts.seconds) return ts.seconds * 1000;
          if (typeof ts === 'number') return ts;
          return new Date(ts).getTime();
      };

      posts.sort((a: any, b: any) => {
        return getT(b) - getT(a);
      });

      callback(posts);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "ecosystem_feed");
    });
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
    
    if (!isLiked) {
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
    }
  },

  addComment: async (postId: string, userId: string, text: string) => {
    const userProfile = await FirebaseService.getUserProfile(userId);
    const userName = userProfile?.username || auth.currentUser?.displayName || `Explorer-${userId.slice(0, 4)}`;
    const commentsRef = collection(db, "ecosystem_feed", postId, "comments");
    await addDoc(commentsRef, {
        userId,
        userName,
        text,
        timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "ecosystem_feed", postId), { commentCount: increment(1) });
    try {
        await updateDoc(doc(db, "feed_thumbnails", postId), { commentCount: increment(1) });
    } catch(e) {}

    const postRef = doc(db, "ecosystem_feed", postId);
    const postSnap = await getDoc(postRef);
    if (postSnap.exists()) {
      const postData = postSnap.data();
      if (postData.userId !== userId) {
        await FirebaseService.addNotification(postData.userId, {
          type: 'comment',
          message: `${userName} left a field note on your sighting.`,
          postId,
          senderId: userId,
          senderName: userName
        });
      }
    }
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
    await addDoc(notifsRef, {
      ...data,
      timestamp: serverTimestamp(),
      isRead: false
    });
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

  // Cost/usage telemetry (see AiUsageLogEntry). Fire-and-forget from the
  // caller's perspective — a logging failure should never block or fail
  // the AI call it's describing.
  logAiUsage: async (entry: Omit<AiUsageLogEntry, 'id' | 'timestamp'>): Promise<void> => {
    try {
      await addDoc(collection(db, "ai_usage_logs"), {
        ...entry,
        timestamp: serverTimestamp(),
      });
    } catch (e) {
      console.warn("Failed to log AI usage telemetry:", e);
    }
  },

  // Most recent usage records for the AdminConsole cost panel. Capped and
  // client-aggregated, consistent with how other admin views in this app
  // (getAllUsers/getAllPosts) work — fine at current scale; a scheduled
  // daily-rollup would be the natural next step if this collection grows large.
  getRecentAiUsage: async (limitCount = 500): Promise<AiUsageLogEntry[]> => {
    const q = query(collection(db, "ai_usage_logs"), orderBy("timestamp", "desc"), limit(limitCount));
    const snapshot = await getDocs(q);
    const entries: AiUsageLogEntry[] = [];
    snapshot.forEach(doc => {
      entries.push({ id: doc.id, ...doc.data() } as AiUsageLogEntry);
    });
    return entries;
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
      // Keep feed_thumbnails (what the public feed actually reads from) in
      // sync — otherwise a post cleared here would stay hidden from the
      // feed forever, since subscribeToFeed/getMorePosts filter on this
      // collection's own reportStatus field.
      try {
          await updateDoc(doc(db, "feed_thumbnails", postId), { reports: [], reportStatus: 'safe' });
      } catch (e) {
          console.warn("Could not sync dismissed report to feed_thumbnails:", e);
      }
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
            // Theme source images (Unsplash/Wikimedia) already send permissive
            // CORS headers, so this can fetch directly — no proxy hop needed.
            let res: Response | null = null;
            try {
              res = await fetch(url, { cache: 'no-store' });
            } catch (fetchError: any) {
              console.warn(`Fetch failed for theme ${id}:`, fetchError);
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

  runThumbnailMigration: async () => {
    if (!auth.currentUser) return 0;
    try {
        const q = query(collection(db, "ecosystem_feed"), where("isPublic", "==", true));
        const feedSnap = await getDocs(q);
        let count = 0;
        for (const docSnap of feedSnap.docs) {
            const data = docSnap.data();
            if (data.isPublic) {
                const id = docSnap.id;
                const thumbRef = doc(db, "feed_thumbnails", id);
                const thumbSnap = await getDoc(thumbRef);
                
                if (!thumbSnap.exists()) {
                    const thumbData = {
                        id,
                        mediaType: data.mediaType || data.type || 'image',
                        thumbnailUrl: data.thumbnailUrl || data.imageUrl || "",
                        title: data.title || null,
                        description: data.description || null,
                        timestamp: data.timestamp || null,
                        userId: data.userId || null,
                        userName: data.userName || null,
                        likes: data.likes || [],
                        commentCount: data.commentCount || 0,
                        isPublic: true,
                        tags: data.tags || [],
                        labels: data.labels || [],
                        behavior: data.behavior || null,
                        aiInsight: data.aiInsight || null,
                        locationArea: data.locationArea || null,
                        isHybrid: data.isHybrid || false
                    };
                    
                    await setDoc(thumbRef, thumbData);
                    count++;
                }
            }
        }
        return count;
    } catch (e) {
        console.warn("Migration failed:", e);
        throw e;
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
          if (Object.keys(thumbUpdates).length > 0) {
              await updateDoc(doc(db, "feed_thumbnails", postId), thumbUpdates);
          }
      } catch (e) {
          console.warn("Could not update feed_thumbnails:", e);
      }
  }
};
