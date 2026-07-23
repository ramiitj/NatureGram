// W2: extracted from firebaseService.ts — community identification
// verification (confirm/dispute, Q3) and admin content-report handling.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  arrayUnion,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { CommunityPost, VerificationState } from "../../types";
import { FirebaseService } from "../firebaseService";

export const ModerationService = {
  // Unique confirmations required before a post's identification is
  // promoted from 'unverified' to 'confirmed'. Scoped to the post's
  // top-level identification only (the primary item) — a multi-item
  // "stitched" collection's secondary items don't get independent
  // verification state, matching how confidence/subjects already work
  // at the post level for those posts.
  CONFIRMATION_THRESHOLD: 3,

  // A non-owner signed-in user vouching that a post's AI identification
  // looks right. arrayUnion so repeat clicks from the same user don't
  // inflate the count. Once enough unique confirmations accumulate, the
  // post is promoted to 'confirmed' and the outcome is mirrored into the
  // underlying quality_events doc (keyed by the post's snapshotId) as a
  // ground-truth signal for the confidence-calibration pipeline (Q4).
  confirmIdentification: async (postId: string, uid: string): Promise<void> => {
    const postRef = doc(db, "ecosystem_feed", postId);
    const postSnap = await getDoc(postRef);
    if (!postSnap.exists()) return;
    const data = postSnap.data() as CommunityPost;
    if ((data.confirmedBy || []).includes(uid)) return;

    const newConfirmedBy = [...(data.confirmedBy || []), uid];
    const verificationState: VerificationState = data.verificationState === 'disputed'
      ? 'disputed'
      : (newConfirmedBy.length >= FirebaseService.CONFIRMATION_THRESHOLD ? 'confirmed' : 'unverified');

    await updateDoc(postRef, { confirmedBy: arrayUnion(uid), verificationState });

    if (data.snapshotId) {
      try {
        await setDoc(doc(db, "quality_events", data.snapshotId), {
          verificationState,
          confirmations: increment(1),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        console.warn("Failed to mirror confirmation into quality_events:", e);
      }
    }
  },

  // A non-owner signed-in user flagging that a post's AI identification
  // looks wrong, with what they think it actually is. A single dispute is
  // enough to mark the post 'disputed' (surfacing possible
  // misidentification promptly matters more here than requiring consensus
  // first) — moderators/the poster can still see and weigh each dispute's
  // suggestedLabel/reason individually rather than this silently
  // overwriting anything.
  disputeIdentification: async (postId: string, uid: string, suggestedLabel: string, reason?: string): Promise<void> => {
    const postRef = doc(db, "ecosystem_feed", postId);
    const postSnap = await getDoc(postRef);
    if (!postSnap.exists()) return;
    const data = postSnap.data() as CommunityPost;

    const dispute = { uid, suggestedLabel, reason: reason || '', timestamp: new Date().toISOString() };
    await updateDoc(postRef, { disputes: arrayUnion(dispute), verificationState: 'disputed' as VerificationState });

    if (data.snapshotId) {
      try {
        await setDoc(doc(db, "quality_events", data.snapshotId), {
          verificationState: 'disputed',
          disputeCount: increment(1),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        console.warn("Failed to mirror dispute into quality_events:", e);
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
};
