// Y1: the follow graph — the structural piece that turns a single global
// chronological feed into a social network (Y2's personalized feed reads
// the following list; Y3's profile shows the counts).
//
// Data model, deliberately simple and race-free:
//   users/{A}/following/{B}   — a doc per account A follows   (written by A)
//   users/{B}/followers/{A}   — a doc per follower of B       (written by A)
// Both carry a denormalized username/avatar so follower/following LISTS
// render without an N+1 profile fetch. Counts are NOT stored on the
// profile — they're computed on demand with getCountFromServer (a cheap
// server-side aggregation), which sidesteps the cross-user counter writes
// (and their races/abuse surface) that a stored followerCount would need.
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  getCountFromServer,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { UserProfileData } from "../../types";
import { FirebaseService } from "../firebaseService";

export interface FollowEntry {
  uid: string;
  username: string;
  avatarUrl?: string;
  timestamp?: any;
}

export const FollowService = {
  // Is `currentUid` following `targetUid`? One cheap doc read.
  isFollowing: async (currentUid: string, targetUid: string): Promise<boolean> => {
    if (!currentUid || !targetUid || currentUid === targetUid) return false;
    try {
      const snap = await getDoc(doc(db, "users", currentUid, "following", targetUid));
      return snap.exists();
    } catch (e) {
      console.warn("isFollowing check failed:", e);
      return false;
    }
  },

  // A follows B. Writes both sides of the edge (A's following, B's
  // followers) with denormalized display info, and fires a best-effort
  // 'follow' notification to B. No-op on self-follow.
  followUser: async (
    currentUser: Pick<UserProfileData, 'uid' | 'username' | 'avatarUrl'>,
    target: Pick<UserProfileData, 'uid' | 'username' | 'avatarUrl'>,
  ): Promise<void> => {
    if (!currentUser?.uid || !target?.uid || currentUser.uid === target.uid) return;

    const followingEntry: FollowEntry = {
      uid: target.uid,
      username: target.username || 'Explorer',
      ...(target.avatarUrl ? { avatarUrl: target.avatarUrl } : {}),
      timestamp: serverTimestamp(),
    };
    const followerEntry: FollowEntry = {
      uid: currentUser.uid,
      username: currentUser.username || 'Explorer',
      ...(currentUser.avatarUrl ? { avatarUrl: currentUser.avatarUrl } : {}),
      timestamp: serverTimestamp(),
    };

    await setDoc(doc(db, "users", currentUser.uid, "following", target.uid), followingEntry);
    try {
      await setDoc(doc(db, "users", target.uid, "followers", currentUser.uid), followerEntry);
    } catch (e) {
      // If the follower-side write is denied/fails, roll back the
      // following-side so the two halves of the edge can't drift apart.
      console.warn("Follower-side write failed, rolling back follow:", e);
      await deleteDoc(doc(db, "users", currentUser.uid, "following", target.uid)).catch(() => {});
      throw e;
    }

    try {
      await FirebaseService.addNotification(target.uid, {
        type: 'follow',
        message: `${currentUser.username || 'An explorer'} started following you.`,
        senderId: currentUser.uid,
        senderName: currentUser.username || 'Explorer',
      });
    } catch { /* notification is best-effort, never fails the follow */ }
  },

  // A unfollows B. Removes both sides of the edge.
  unfollowUser: async (currentUid: string, targetUid: string): Promise<void> => {
    if (!currentUid || !targetUid) return;
    await deleteDoc(doc(db, "users", currentUid, "following", targetUid)).catch((e) => {
      console.warn("Failed to remove following edge:", e);
    });
    await deleteDoc(doc(db, "users", targetUid, "followers", currentUid)).catch((e) => {
      console.warn("Failed to remove follower edge:", e);
    });
  },

  getFollowerCount: async (uid: string): Promise<number> => {
    if (!uid) return 0;
    try {
      const snap = await getCountFromServer(collection(db, "users", uid, "followers"));
      return snap.data().count;
    } catch (e) {
      console.warn("getFollowerCount failed:", e);
      return 0;
    }
  },

  getFollowingCount: async (uid: string): Promise<number> => {
    if (!uid) return 0;
    try {
      const snap = await getCountFromServer(collection(db, "users", uid, "following"));
      return snap.data().count;
    } catch (e) {
      console.warn("getFollowingCount failed:", e);
      return 0;
    }
  },

  // The uids `uid` follows — the input to Y2's personalized feed. Capped:
  // the follow-feed's Firestore `in` query tops out at 30 anyway, and this
  // is not meant to page an unbounded social graph client-side.
  getFollowingIds: async (uid: string, max = 200): Promise<string[]> => {
    if (!uid) return [];
    try {
      const q = query(collection(db, "users", uid, "following"), orderBy("timestamp", "desc"), limit(max));
      const snap = await getDocs(q);
      return snap.docs.map(d => d.id);
    } catch (e) {
      console.warn("getFollowingIds failed:", e);
      return [];
    }
  },

  // Full follower / following lists for a profile's list views.
  getFollowers: async (uid: string, max = 200): Promise<FollowEntry[]> => {
    if (!uid) return [];
    try {
      const q = query(collection(db, "users", uid, "followers"), orderBy("timestamp", "desc"), limit(max));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ uid: d.id, ...(d.data() as Omit<FollowEntry, 'uid'>) }));
    } catch (e) {
      console.warn("getFollowers failed:", e);
      return [];
    }
  },

  getFollowing: async (uid: string, max = 200): Promise<FollowEntry[]> => {
    if (!uid) return [];
    try {
      const q = query(collection(db, "users", uid, "following"), orderBy("timestamp", "desc"), limit(max));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ uid: d.id, ...(d.data() as Omit<FollowEntry, 'uid'>) }));
    } catch (e) {
      console.warn("getFollowing failed:", e);
      return [];
    }
  },
};
