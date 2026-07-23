// W1: structured, per-request AI-call tracing — distinct from both the
// scattered console.debug/warn calls elsewhere in genAiService.ts (free
// text, no consistent shape) and from the Firestore-backed quality_events/
// ai_usage_logs collections (which only exist for calls where the caller
// passed a snapshotId, and only surface through AdminConsole's hand-rolled
// UI). Every AI call gets one structured trace line here — model,
// latency, confidence, and outcome, the exact fields this pillar calls
// for — regardless of whether it's also written to Firestore.
export type AiCallOutcome = 'success' | 'error' | 'quota_exceeded' | 'blocked_referrer' | 'prefiltered';

export interface AiCallTrace {
  traceId: string;
  feature: string;
  model?: string | null;
  latencyMs: number;
  confidence?: 'high' | 'medium' | 'low';
  isNatureSubject?: boolean;
  outcome: AiCallOutcome;
}

export const TracingService = {
  newTraceId: (): string => `trace_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,

  // One JSON line per AI call. console.log (not .debug) deliberately — this
  // is meant to survive in production builds, not just local dev, the same
  // way the server's structured logger (server/lib/logger.js) does.
  logAiCallTrace: (trace: AiCallTrace): void => {
    console.log(JSON.stringify({ log: 'ai_call_trace', timestamp: new Date().toISOString(), ...trace }));
  },
};
