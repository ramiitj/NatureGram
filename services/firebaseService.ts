
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
import { GeminiConfig, CommunityPost, Snapshot, Comment, NaturalistMemory, UserProfileData, FieldNotification, ExpeditionDraft, NaturalistPersona, EthologicalDescriptors } from "../types";
import { GenAiService } from "./genAiService";
import { SYSTEM_INSTRUCTION } from "../constants";
import { generateThumbnail } from "../utils";
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

  updateNaturalistPersona: async (userId: string, persona: NaturalistPersona) => {
    if (!userId || userId === 'explorer_guest') return;
    try {
      const docRef = doc(db, "users", userId);
      await setDoc(docRef, { naturalistPersona: { ...persona, updatedAt: serverTimestamp() } }, { merge: true });
    } catch (e) {
      console.warn("Failed to update naturalist persona:", e);
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
    try {
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
    } catch (e) {
      console.warn("signInAnonymously failed or unsupported in environment:", e);
      throw e;
    }
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

  saveDraft: async (userId: string, snapshots: Snapshot[], summary: string, existingDraftId?: string) => {
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
        await setDoc(draftRef, draftData, { merge: true });
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
                  originalImageUrl = await FirebaseService.uploadMedia(snapshot.blob, effectiveUserId, 'image');
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
        reportStatus: 'safe',
        reports: [],
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

      try {
        const ethologicalDescriptors = await GenAiService.generateEthologicalDescriptors(
          Array.from(allLabels),
          postData.behavior || "Field observation",
          primaryItem.mediaType,
          primaryItem.locationArea
        );
        if (ethologicalDescriptors) {
          postData.ethologicalDescriptors = ethologicalDescriptors;
        }
      } catch (ethErr) {
        console.warn("Failed to generate ethological descriptors for session observation:", ethErr);
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
          ethologicalDescriptors: postData.ethologicalDescriptors || null
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
              originalImageUrl = await FirebaseService.uploadMedia(snapshot.blob, effectiveUserId, 'image');
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
        reportStatus: 'safe',
        reports: [],
        isHybrid: snapshot.isHybrid || associatedImageUrls.length > 0,
        rotation: snapshot.rotation || 0,
        rawLocation: snapshot.rawLocation || null,
        timeToRecordMs: snapshot.timeToRecordMs || null,
        aiProposedLabels: snapshot.aiProposedLabels || null,
        aiProposedBehavior: snapshot.aiProposedBehavior || null,
        sessionRetakes: snapshot.sessionRetakes || null,
        humanDelta: snapshot.humanDelta || false,
      };

      try {
        const ethologicalDescriptors = await GenAiService.generateEthologicalDescriptors(
          snapshot.labels || [],
          synthesis || "Field observation",
          snapshot.type,
          snapshot.locationArea
        );
        if (ethologicalDescriptors) {
          postData.ethologicalDescriptors = ethologicalDescriptors;
        }
      } catch (ethErr) {
        console.warn("Failed to generate ethological descriptors for observation:", ethErr);
      }

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
          ethologicalDescriptors: postData.ethologicalDescriptors || null
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
        q = query(
            collection(db, "feed_thumbnails"), 
            where("tags", "array-contains", normalizedTag)
        );
    } else {
        q = query(
            collection(db, "feed_thumbnails"), 
            orderBy("timestamp", "desc"), 
            limit(12)
        );
    }

    return onSnapshot(q, (snapshot) => {
      const posts: CommunityPost[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.isPublic !== false) {
          const isSeed = doc.id.startsWith('seed_') || 
                         data.userId?.startsWith('system_seeder_') || 
                         ['Jane Goodall', 'Dian Fossey', 'Charles Darwin', 'David Attenborough', 'Jacques-Yves Cousteau'].includes(data.userName);
          if (!isSeed) {
            posts.push({ 
              id: doc.id, 
              ...data,
              labels: data.labels || (data.label ? [data.label] : ["Nature"])
            } as CommunityPost);
          }
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

  getMorePosts: async (lastVisible: any, searchTag?: string | null, limitCount: number = 12): Promise<{ posts: CommunityPost[], lastVisible: any }> => {
      let q;
      if (searchTag) {
          const normalizedTag = searchTag.startsWith('#') ? searchTag : `#${searchTag.toLowerCase().replace(/\s+/g, '')}`;
          const queryConstraints: any[] = [
              where("tags", "array-contains", normalizedTag),
              orderBy("timestamp", "desc"),
              limit(limitCount)
          ];
          if (lastVisible) {
              queryConstraints.push(startAfter(lastVisible));
          }
          q = query(collection(db, "feed_thumbnails"), ...queryConstraints);
      } else {
          const queryConstraints: any[] = [
              orderBy("timestamp", "desc"),
              limit(limitCount)
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
          const snapshot = await getDocs(q);

          let posts: CommunityPost[] = [];
          snapshot.forEach((doc) => {
              const data = doc.data() as any;
              if (data.isPublic !== false) {
                  const isSeed = doc.id.startsWith('seed_') || 
                                 data.userId?.startsWith('system_seeder_') || 
                                 ['Jane Goodall', 'Dian Fossey', 'Charles Darwin', 'David Attenborough', 'Jacques-Yves Cousteau'].includes(data.userName);
                  if (!isSeed) {
                      posts.push({ 
                        id: doc.id, 
                        ...data,
                        labels: data.labels || (data.label ? [data.label] : ["Nature"])
                      } as CommunityPost);
                  }
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
    if (!userId || userId === 'explorer_guest' || !auth.currentUser || auth.currentUser.uid !== userId) {
      callback([]);
      return () => {};
    }
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
    if (userId && userId !== 'explorer_guest' && auth.currentUser && auth.currentUser.uid === userId) {
      try {
        await updateDoc(doc(db, "users", userId, "notifications", notifId), { isRead: true });
      } catch (e) {
        handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/notifications/${notifId}`);
      }
    }
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
      const seedIds = [
        "seed_goodall_1",
        "seed_fossey_1",
        "seed_darwin_1",
        "seed_attenborough_1",
        "seed_cousteau_1"
      ];
      for (const id of seedIds) {
        await deleteDoc(doc(db, "feed_thumbnails", id)).catch(() => {});
        await deleteDoc(doc(db, "ecosystem_feed", id)).catch(() => {});
      }
    } catch (e) {
      console.warn("Skipped purging seed observations:", e);
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
