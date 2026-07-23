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
  increment,
} from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { auth, db } from "../../firebaseConfig";
import { UserProfileData, NaturalistMemory, CommunityPost } from "../../types";
import { handleFirestoreError, OperationType } from "./shared";

export const ProfileService = {
  // X1: reads the current user's role custom claims from their ID token
  // (the token is the authority — the profile's isExpert is only a display
  // mirror). Returns both roles so callers don't each re-implement the
  // getIdTokenResult dance. forceRefresh picks up a claim granted while the
  // session is already open. Never throws.
  getMyRoleClaims: async (forceRefresh: boolean = false): Promise<{ admin: boolean; expert: boolean }> => {
    const user = auth.currentUser;
    if (!user) return { admin: false, expert: false };
    try {
      const token = await user.getIdTokenResult(forceRefresh);
      return { admin: token.claims.admin === true, expert: token.claims.expert === true };
    } catch (e) {
      console.warn("Failed to read role claims:", e);
      return { admin: false, expert: false };
    }
  },

  // X1/X2: bump a user's track-record reputation. Called when one of their
  // observations reaches community-confirmed (see ModerationService's
  // weighted confirm). Fire-and-forget; a failure never blocks the
  // verification write it accompanies.
  incrementReputation: async (userId: string, by: number = 1): Promise<void> => {
    if (!userId || by === 0) return;
    try {
      await updateDoc(doc(db, "users", userId), { reputationScore: increment(by) });
    } catch (e) {
      console.warn("Failed to increment reputation for", userId, e);
    }
  },
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
        // X1: mirror the 'expert' custom claim onto the profile so OTHER
        // users (who can't read this user's token) can render an expert
        // badge. The token claim stays authoritative for anything that
        // grants capability; this is display-only, synced at the expert's
        // own login. Only writes when it actually changed.
        try {
          const expertClaim = auth.currentUser?.uid === userId
            ? ((await auth.currentUser!.getIdTokenResult()).claims.expert === true)
            : undefined;
          if (expertClaim !== undefined && expertClaim !== (data.isExpert === true)) {
            updates.isExpert = expertClaim;
          }
        } catch (claimErr) {
          console.warn("Failed to sync expert claim to profile:", claimErr);
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
