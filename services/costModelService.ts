import { AiUsageLogEntry, LiveSessionMetricsEntry } from "../types";

// U2: unit-cost model, computed from telemetry this app already collects
// (Q1's ai_usage_logs, R1's live_session_metrics) against Gemini's
// published pricing — not a fabricated or assumed figure. "Funders will
// build this model themselves; have the answer first" is the roadmap's own
// framing for why this needs to be real math, not a placeholder.
//
// Pricing sourced live from https://ai.google.dev/gemini-api/docs/pricing
// on 2026-07-23 (standard, non-batch, non-priority tier, USD per 1,000,000
// tokens). Gemini pricing changes over time — re-verify against that page
// before using this for an actual financial decision.
export const PRICING = {
    'gemini-2.5-flash': {
        inputPerMillion: 0.30,  // text/image/video input
        outputPerMillion: 2.50,
    },
    // This app's PRO_MODEL constant (genAiService.ts) names a preview
    // build; priced here at the published Gemini 2.5 Pro standard rate
    // (≤200k token prompts), the closest published equivalent.
    'gemini-3.1-pro-preview': {
        inputPerMillion: 1.25,
        outputPerMillion: 10.00,
    },
    'gemini-2.5-flash-native-audio-preview-09-2025': {
        inputTextPerMillion: 0.50,
        inputAudioVideoPerMillion: 3.00,
        outputTextPerMillion: 2.00,
        outputAudioPerMillion: 12.00,
    },
} as const;

// Official per-second token rates for audio/image content
// (https://ai.google.dev/gemini-api/docs/tokens):
const AUDIO_TOKENS_PER_SEC = 32;
const IMAGE_TOKENS_PER_FRAME = 258; // a still image ≤384px in both dimensions

export interface AiUsageCostBreakdown {
    totalCostUsd: number;
    byModel: Record<string, { calls: number; totalTokens: number; costUsd: number }>;
    unpricedModels: string[];
    caveats: string[];
}

// Computes cost from ai_usage_logs' actual logged token counts — the token
// counts themselves are real measurements, not estimates. The only
// approximation is which price tier applies (see caveats): the log schema
// doesn't currently distinguish audio-input calls (priced higher) from
// image/video/text-input calls, so this is a defensible lower bound, not
// an exact figure.
export const computeAiUsageCost = (logs: AiUsageLogEntry[]): AiUsageCostBreakdown => {
    const byModel: AiUsageCostBreakdown['byModel'] = {};
    const unpricedModels = new Set<string>();
    let totalCostUsd = 0;

    logs.forEach(log => {
        const pricing = (PRICING as Record<string, any>)[log.model];
        const promptTokens = log.promptTokenCount || 0;
        const outputTokens = log.candidatesTokenCount || 0;
        const totalTokens = log.totalTokenCount || (promptTokens + outputTokens);

        if (!byModel[log.model]) byModel[log.model] = { calls: 0, totalTokens: 0, costUsd: 0 };
        byModel[log.model].calls += 1;
        byModel[log.model].totalTokens += totalTokens;

        if (pricing && 'inputPerMillion' in pricing) {
            const costUsd = (promptTokens / 1_000_000) * pricing.inputPerMillion + (outputTokens / 1_000_000) * pricing.outputPerMillion;
            byModel[log.model].costUsd += costUsd;
            totalCostUsd += costUsd;
        } else {
            // Unknown/unpriced model — tracked separately so it's visible
            // that this total is a floor, not silently priced at zero.
            unpricedModels.add(log.model);
        }
    });

    return {
        totalCostUsd,
        byModel,
        unpricedModels: Array.from(unpricedModels),
        caveats: [
            "Priced at the standard (non-audio) input rate for every call — ai_usage_logs doesn't record whether a given call's input included audio, and Flash's audio input is priced higher ($1.00/1M) than its text/image/video input ($0.30/1M). Calls with audio input are therefore underestimated here.",
            "Gemini pricing changes over time; these constants were sourced from ai.google.dev/gemini-api/docs/pricing on 2026-07-23 and should be re-verified before use in a real financial decision.",
        ],
    };
};

export interface LiveSessionCostBreakdown {
    totalCostUsd: number;
    sessionsConsidered: number;
    sessionsExcluded: number;
    avgCostPerSessionUsd: number | null;
    caveats: string[];
}

// Computes Live-session cost from real per-session measurements (session
// duration, actual decoded output-audio seconds, actual video frames sent
// — see LiveSessionMetrics's own doc comments for why these are real
// measurements, not estimates). The Live API doesn't return per-turn
// usageMetadata the way generateContent does, so cost is reconstructed
// from published token-rate documentation applied to real usage volumes,
// rather than read directly off a billed token count.
export const computeLiveSessionCost = (entries: LiveSessionMetricsEntry[]): LiveSessionCostBreakdown => {
    const pricing = PRICING['gemini-2.5-flash-native-audio-preview-09-2025'];
    let totalCostUsd = 0;
    let sessionsConsidered = 0;
    let sessionsExcluded = 0;

    entries.forEach(entry => {
        if (!entry.sessionDurationMs) { sessionsExcluded++; return; }

        // The client streams mic audio continuously for the entire
        // connected duration (see sendAudioChunk in geminiLiveService.ts),
        // so session duration doubles directly as audio-input duration —
        // not an assumption about how much the user actually spoke.
        const audioInputSec = entry.sessionDurationMs / 1000;
        const audioOutputSec = entry.totalOutputAudioSec || 0;
        const frames = entry.videoFramesSent || 0;

        const audioInputCost = (audioInputSec * AUDIO_TOKENS_PER_SEC / 1_000_000) * pricing.inputAudioVideoPerMillion;
        const frameInputCost = (frames * IMAGE_TOKENS_PER_FRAME / 1_000_000) * pricing.inputAudioVideoPerMillion;
        const audioOutputCost = (audioOutputSec * AUDIO_TOKENS_PER_SEC / 1_000_000) * pricing.outputAudioPerMillion;

        totalCostUsd += audioInputCost + frameInputCost + audioOutputCost;
        sessionsConsidered++;
    });

    return {
        totalCostUsd,
        sessionsConsidered,
        sessionsExcluded,
        avgCostPerSessionUsd: sessionsConsidered > 0 ? totalCostUsd / sessionsConsidered : null,
        caveats: [
            "Excludes text-token overhead (system instruction, tool schemas, transcripts) — small relative to audio/video volume, but not zero.",
            "Sessions with no recorded sessionDurationMs (from before this field existed) are excluded from the total, not counted as zero-cost.",
            "Gemini pricing changes over time; sourced from ai.google.dev/gemini-api/docs/pricing on 2026-07-23.",
        ],
    };
};
