// W2: extracted from firebaseService.ts — user profile + naturalist
// memory reads/writes. See services/firebaseService.ts for how this and
// its sibling domain modules are re-assembled into the FirebaseService
// facade every existing call site still imports.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { auth, db } from "../../firebaseConfig";
import { UserProfileData, NaturalistMemory, CommunityPost } from "../../types";
import { handleFirestoreError, OperationType } from "./shared";

export const ProfileService = {
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
};
