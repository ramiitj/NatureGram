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
import {
  getVerificationWeight,
  verifierFromProfile,
  computeVerificationState,
  isVerifiedState,
} from "../reputationService";

// The verification fields a confirm/dispute call returns, so a caller can
// optimistically update its local copy of the post without re-reading and
// without re-deriving weights itself.
export interface VerificationUpdate {
  verificationState: VerificationState;
  confirmWeightTotal: number;
  disputeWeightTotal: number;
  hasExpertConfirmation: boolean;
}

// Resolves the calling user's verifier weight from their own profile
// (reputationScore) + their expert token claim. The claim is read from the
// token (getMyRoleClaims), never trusted from a profile field.
async function callerWeight(uid: string): Promise<{ weight: number; isExpert: boolean }> {
  const [profile, claims] = await Promise.all([
    FirebaseService.getUserProfile(uid),
    FirebaseService.getMyRoleClaims(),
  ]);
  const weight = getVerificationWeight(verifierFromProfile(profile, claims.expert));
  return { weight, isExpert: claims.expert };
}

export const ModerationService = {
  // X2: replaced the flat "unique confirmations >= 3" count. Verification
  // is now WEIGHTED (see reputationService): each verifier contributes
  // their reputation/expertise weight, so three casual users no longer
  // equal one qualified naturalist, and a single expert can promote an ID
  // to research-grade. Kept as an exported constant for back-compat with
  // any caller referencing it; the real threshold lives in
  // REPUTATION_CONSTANTS.CONFIRM_THRESHOLD.
  CONFIRMATION_THRESHOLD: 3,

  // A non-owner signed-in user vouching that a post's AI identification
  // looks right. confirmedBy (uid list) dedupes repeat clicks; the
  // verifier's WEIGHT accumulates into confirmWeightTotal, which — net of
  // dispute weight — drives verificationState. An expert confirmation sets
  // hasExpertConfirmation, gating the research-grade tier. When the post
  // first reaches a verified state, the author's reputation is bumped once
  // (reputationAwarded guard). The outcome is mirrored into quality_events
  // (keyed by snapshotId) for the calibration pipeline (Q4). Returns the
  // new verification fields for optimistic UI; returns null on no-op
  // (missing post or already-confirmed by this user).
  confirmIdentification: async (postId: string, uid: string): Promise<VerificationUpdate | null> => {
    const postRef = doc(db, "ecosystem_feed", postId);
    const postSnap = await getDoc(postRef);
    if (!postSnap.exists()) return null;
    const data = postSnap.data() as CommunityPost;
    if ((data.confirmedBy || []).includes(uid)) return null;

    const { weight, isExpert } = await callerWeight(uid);

    const newConfirmTotal = (data.confirmWeightTotal || 0) + weight;
    const disputeTotal = data.disputeWeightTotal || 0;
    const hasExpert = data.hasExpertConfirmation === true || isExpert;
    const verificationState = computeVerificationState(newConfirmTotal, disputeTotal, hasExpert);

    const updates: Record<string, any> = {
      confirmedBy: arrayUnion(uid),
      confirmWeightTotal: increment(weight),
      hasExpertConfirmation: hasExpert,
      verificationState,
    };
    // Award the author reputation exactly once, the moment their post first
    // crosses into a verified state (the crowd agreed with their ID).
    const shouldAward = !isVerifiedState(data.verificationState)
      && isVerifiedState(verificationState)
      && !data.reputationAwarded
      && !!data.userId
      && data.userId !== uid;
    if (shouldAward) updates.reputationAwarded = true;

    await updateDoc(postRef, updates);

    if (shouldAward && data.userId) {
      FirebaseService.incrementReputation(data.userId, 1).catch(() => {});
    }

    if (data.snapshotId) {
      try {
        await setDoc(doc(db, "quality_events", data.snapshotId), {
          verificationState,
          confirmations: increment(1),
          confirmWeightTotal: increment(weight),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        console.warn("Failed to mirror confirmation into quality_events:", e);
      }
    }

    return { verificationState, confirmWeightTotal: newConfirmTotal, disputeWeightTotal: disputeTotal, hasExpertConfirmation: hasExpert };
  },

  // A non-owner signed-in user flagging that a post's AI identification
  // looks wrong, with what they think it actually is. The dispute carries
  // the disputer's weight (an expert's disagreement counts for a lot); the
  // post is 'disputed' once dispute weight meets or beats confirm weight
  // (see computeVerificationState). Each dispute's suggestedLabel/reason is
  // still stored individually for moderators/the poster to weigh, rather
  // than silently overwriting anything. Returns the new verification fields
  // for optimistic UI.
  disputeIdentification: async (postId: string, uid: string, suggestedLabel: string, reason?: string): Promise<VerificationUpdate | null> => {
    const postRef = doc(db, "ecosystem_feed", postId);
    const postSnap = await getDoc(postRef);
    if (!postSnap.exists()) return null;
    const data = postSnap.data() as CommunityPost;

    const { weight } = await callerWeight(uid);

    const confirmTotal = data.confirmWeightTotal || 0;
    const newDisputeTotal = (data.disputeWeightTotal || 0) + weight;
    const hasExpert = data.hasExpertConfirmation === true;
    const verificationState = computeVerificationState(confirmTotal, newDisputeTotal, hasExpert);

    const dispute = { uid, suggestedLabel, reason: reason || '', weight, timestamp: new Date().toISOString() };
    await updateDoc(postRef, {
      disputes: arrayUnion(dispute),
      disputeWeightTotal: increment(weight),
      verificationState,
    });

    if (data.snapshotId) {
      try {
        await setDoc(doc(db, "quality_events", data.snapshotId), {
          verificationState,
          disputeCount: increment(1),
          disputeWeightTotal: increment(weight),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        console.warn("Failed to mirror dispute into quality_events:", e);
      }
    }

    return { verificationState, confirmWeightTotal: confirmTotal, disputeWeightTotal: newDisputeTotal, hasExpertConfirmation: hasExpert };
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
