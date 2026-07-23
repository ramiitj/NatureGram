import { ConfidenceCalibration } from "../types";

export interface CalibratedConfidence {
  // The model's own self-reported bucket — always present.
  rawConfidence: 'high' | 'medium' | 'low';
  // Observed correctness rate for this bucket, only when the calibration
  // table has enough verified samples to say something honest about it.
  observedAccuracy: number | null;
  sampleSize: number;
  isValidated: boolean;
}

// Minimum verified samples in a bucket before its observed accuracy is
// trusted enough to show — below this, a couple of lucky/unlucky
// confirmations could swing the number wildly, so it's better to say
// "not enough data yet" than to display a misleadingly precise figure.
const MIN_SAMPLE_SIZE = 20;

// Maps the model's raw self-reported confidence to what's actually been
// observed to be correct, given a calibration table computed from
// confirmed/disputed quality_events (see computeConfidenceCalibration).
// Never fabricates a number: no calibration doc, no bucket data, or too few
// samples all fall back to isValidated: false rather than guessing.
export const getCalibratedConfidence = (
  calibration: ConfidenceCalibration | null | undefined,
  rawConfidence: 'high' | 'medium' | 'low' | undefined
): CalibratedConfidence | null => {
  if (!rawConfidence) return null;
  const bucket = calibration?.buckets?.[rawConfidence];
  if (!bucket || bucket.sampleSize < MIN_SAMPLE_SIZE) {
    return { rawConfidence, observedAccuracy: null, sampleSize: bucket?.sampleSize || 0, isValidated: false };
  }
  return { rawConfidence, observedAccuracy: bucket.observedAccuracy, sampleSize: bucket.sampleSize, isValidated: true };
};
