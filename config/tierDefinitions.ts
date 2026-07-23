// U2: session-tiering proposal. This is a DESIGN ARTIFACT, not an enforced
// feature — there is no payment/account-plan system anywhere in this
// codebase (no Stripe, no `plan` field on UserProfileData, no billing
// webhook) to gate a paid tier against, and fabricating one would mean
// inventing pricing/business terms that are the user's decision, not
// mine. What exists today is exactly one implicit tier — the
// MAX_CONCURRENT_LIVE_SESSIONS / MAX_DAILY_LIVE_SESSIONS env vars in
// server/lib/liveQuota.js, applied uniformly to every signed-in user.
//
// This file makes that implicit tier explicit (as 'free', below) and
// proposes what a second, paid tier's limits could reasonably be, sized
// against the real unit-cost model in services/costModelService.ts — see
// docs/cost-tiering.md for the full reasoning and worked numbers.
//
// To actually ship this: add a `tier` field to UserProfileData, a way for
// it to become 'supporter' (a payment provider, an admin grant, whatever
// the product decision ends up being), and read this config from
// liveQuota.js's checks keyed by that field instead of the current flat
// env vars. None of that exists yet — this file is the target shape, not
// a live switch.
export type SessionTier = 'free' | 'supporter';

export interface TierLimits {
    maxConcurrentLiveSessions: number;
    maxDailyLiveSessions: number;
    maxLiveSessionDurationSec: number;
    // Async analysis (analyzeMedia/analyzeMultimodal via upload or manual
    // capture) currently has NO per-user daily cap anywhere in this
    // codebase — only Live sessions are quota-enforced. Both tiers below
    // include a proposed cap for this path; today, `undefined` in the
    // running app effectively means unlimited.
    maxDailyAnalysisCalls: number;
}

export const TIER_DEFINITIONS: Record<SessionTier, TierLimits> = {
    free: {
        // Matches server/lib/liveQuota.js's current defaults exactly —
        // this tier is what already exists today, just named.
        maxConcurrentLiveSessions: 1,
        maxDailyLiveSessions: 20,
        maxLiveSessionDurationSec: 180,
        maxDailyAnalysisCalls: 50,
    },
    supporter: {
        maxConcurrentLiveSessions: 2,
        maxDailyLiveSessions: 100,
        maxLiveSessionDurationSec: 300,
        maxDailyAnalysisCalls: 500,
    },
};
