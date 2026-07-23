// Pure, dependency-free scoring functions — no network, no Firestore, no
// GenAI SDK. Kept separate from runner.ts specifically so they're testable
// in isolation (e.g. by a future vitest/jest suite) without needing a live
// Gemini call or Firebase credentials.

// Did the model's scope-gate call (is this even a nature subject) match
// ground truth? `actual` is undefined when the model response didn't
// include the field at all, which counts as incorrect rather than a pass.
export const isNatureSubjectCorrect = (expected: boolean, actual: boolean | undefined): boolean => {
    return actual !== undefined && actual === expected;
};

// True if any of the acceptable ground-truth labels appears (case/whitespace
// insensitive) among the model's proposed taxonomy. Used for top-N
// accuracy: a fixture's expectedLabelsContainsAny lists every label that
// would count as a correct identification (e.g. a common name and its
// regional variant), not a ranked list.
export const anyLabelMatches = (expectedAny: string[], actualLabels: string[]): boolean => {
    const normalizedActual = new Set(actualLabels.map(l => l.trim().toLowerCase()));
    return expectedAny.some(e => normalizedActual.has(e.trim().toLowerCase()));
};

export interface ConfidenceBucket {
    correct: number;
    total: number;
}

export type ConfidenceBuckets = Record<'high' | 'medium' | 'low', ConfidenceBucket>;

// Aggregates a list of {confidence, correct} results into per-bucket
// correct/total counts — the same shape of computation as
// computeConfidenceCalibration in services/firebaseService.ts, just over
// eval-fixture results instead of production quality_events. Kept as a
// separate implementation rather than a shared import because that
// function reads live Firestore data and this one only ever sees the
// in-memory results of a single eval run.
export const confidenceBucketAccuracy = (results: { confidence?: 'high' | 'medium' | 'low', correct: boolean }[]): ConfidenceBuckets => {
    const buckets: ConfidenceBuckets = {
        high: { correct: 0, total: 0 },
        medium: { correct: 0, total: 0 },
        low: { correct: 0, total: 0 },
    };
    results.forEach(r => {
        if (!r.confidence) return;
        buckets[r.confidence].total += 1;
        if (r.correct) buckets[r.confidence].correct += 1;
    });
    return buckets;
};
