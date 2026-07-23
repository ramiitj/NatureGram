// W2: extracted from firebaseService.ts — AI-cost telemetry, identification
// quality-event logging, confidence calibration, and Live-session
// performance metrics (Pillars Q/R). See W1 for the newer structured
// per-request tracing this predates.
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  increment,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { AiUsageLogEntry, QualityEvent, ConfidenceCalibration, LiveSessionMetricsEntry } from "../../types";
import { FirebaseService } from "../firebaseService";

export const TelemetryService = {
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

  // One identification outcome (see QualityEvent). Upserted by snapshotId
  // (setDoc + merge, not addDoc) so the same document created at analysis
  // time can later be updated in place by a human correction
  // (recordQualityEventCorrection) or a community verification outcome
  // (confirmIdentification/disputeIdentification) instead of creating a
  // second record for the same identification. Fire-and-forget, same
  // contract as logAiUsage: a telemetry write failure never blocks or fails
  // the AI call it's describing.
  logQualityEvent: async (event: Omit<QualityEvent, 'id' | 'timestamp' | 'updatedAt' | 'humanCorrected' | 'correctionCount' | 'verificationState' | 'confirmations' | 'disputeCount'>): Promise<void> => {
    try {
      await setDoc(doc(db, "quality_events", event.snapshotId), {
        ...event,
        humanCorrected: false,
        correctionCount: 0,
        verificationState: 'unverified',
        confirmations: 0,
        disputeCount: 0,
        timestamp: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.warn("Failed to log quality event:", e);
    }
  },

  // Records that a human's final labels diverged from the AI's proposal for
  // a given snapshot — called both at publish time (PostSessionView's
  // existing humanDelta computation, via createObservation/
  // createSessionObservation below) and on a later post-publish edit
  // (EditPostDetails, via Community.tsx). Uses set+merge rather than
  // updateDoc so this never fails outright just because the analysis-time
  // quality event doesn't exist for some reason (e.g. very old posts
  // predating this feature) — it creates a minimal record instead of
  // silently dropping the correction signal.
  recordQualityEventCorrection: async (snapshotId: string, finalLabels: string[]): Promise<void> => {
    if (!snapshotId) return;
    try {
      await setDoc(doc(db, "quality_events", snapshotId), {
        finalLabels,
        humanCorrected: true,
        correctionCount: increment(1),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.warn("Failed to record quality event correction:", e);
    }
  },

  // Most recent quality events, for the eval harness (Q2) and calibration
  // pipeline (Q4) to read from. Capped and client-aggregated, same pattern
  // as getRecentAiUsage above.
  getRecentQualityEvents: async (limitCount = 2000): Promise<QualityEvent[]> => {
    const q = query(collection(db, "quality_events"), orderBy("timestamp", "desc"), limit(limitCount));
    const snapshot = await getDocs(q);
    const events: QualityEvent[] = [];
    snapshot.forEach(doc => {
      events.push({ id: doc.id, ...doc.data() } as QualityEvent);
    });
    return events;
  },

  // Recomputes the confidence-calibration table (see ConfidenceCalibration
  // in types.ts) from quality_events with actual ground truth: a confirmed
  // (community-verified) or disputed identification, or one the original
  // submitter corrected before publish. Everything still 'unverified' with
  // no human correction is excluded — there's no ground truth for it yet,
  // and this must never fabricate a number for a bucket with no verified
  // samples (see the type's own doc comment). Admin-triggered (AdminConsole)
  // rather than automatic, since there's no scheduled-function
  // infrastructure in this project to run it periodically.
  computeConfidenceCalibration: async (limitCount = 2000): Promise<ConfidenceCalibration> => {
    const events = await FirebaseService.getRecentQualityEvents(limitCount);
    const buckets: Record<'high' | 'medium' | 'low', { correct: number, total: number }> = {
      high: { correct: 0, total: 0 },
      medium: { correct: 0, total: 0 },
      low: { correct: 0, total: 0 },
    };

    let sampleSize = 0;
    events.forEach(e => {
      if (!e.confidence) return;
      // X2: 'research-grade' (expert-verified) is ground truth AND correct,
      // same as 'confirmed' — the stronger tier must not be dropped from
      // the calibration just because it's a newer state value.
      const communityCorrect = e.verificationState === 'confirmed' || e.verificationState === 'research-grade';
      const hasGroundTruth = communityCorrect || e.verificationState === 'disputed' || e.humanCorrected;
      if (!hasGroundTruth) return;
      const isCorrect = communityCorrect && !e.humanCorrected;
      buckets[e.confidence].total += 1;
      if (isCorrect) buckets[e.confidence].correct += 1;
      sampleSize += 1;
    });

    const calibration: ConfidenceCalibration = {
      computedAt: serverTimestamp(),
      sampleSize,
      buckets: {
        high: buckets.high.total > 0 ? { observedAccuracy: buckets.high.correct / buckets.high.total, sampleSize: buckets.high.total } : undefined,
        medium: buckets.medium.total > 0 ? { observedAccuracy: buckets.medium.correct / buckets.medium.total, sampleSize: buckets.medium.total } : undefined,
        low: buckets.low.total > 0 ? { observedAccuracy: buckets.low.correct / buckets.low.total, sampleSize: buckets.low.total } : undefined,
      },
    };

    await setDoc(doc(db, "admin_config", "confidence_calibration"), calibration);
    return calibration;
  },

  getConfidenceCalibration: async (): Promise<ConfidenceCalibration | null> => {
    const docSnap = await getDoc(doc(db, "admin_config", "confidence_calibration"));
    return docSnap.exists() ? (docSnap.data() as ConfidenceCalibration) : null;
  },

  // One completed Live session's performance summary (see R1 and
  // LiveSessionMetricsEntry in types.ts). Fire-and-forget, same contract as
  // logAiUsage — a telemetry write failure never blocks session teardown.
  logLiveSessionMetrics: async (entry: Omit<LiveSessionMetricsEntry, 'id' | 'timestamp'>): Promise<void> => {
    try {
      await addDoc(collection(db, "live_session_metrics"), {
        ...entry,
        timestamp: serverTimestamp(),
      });
    } catch (e) {
      console.warn("Failed to log Live session metrics:", e);
    }
  },

  // Most recent Live session metrics, for the AdminConsole performance
  // panel. Same capped/client-aggregated pattern as getRecentAiUsage.
  getRecentLiveSessionMetrics: async (limitCount = 500): Promise<LiveSessionMetricsEntry[]> => {
    const q = query(collection(db, "live_session_metrics"), orderBy("timestamp", "desc"), limit(limitCount));
    const snapshot = await getDocs(q);
    const entries: LiveSessionMetricsEntry[] = [];
    snapshot.forEach(doc => {
      entries.push({ id: doc.id, ...doc.data() } as LiveSessionMetricsEntry);
    });
    return entries;
  },
};
