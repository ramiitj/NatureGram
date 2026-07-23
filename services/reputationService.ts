// X1: the reputation + verification-weight engine. Pure functions (no
// Firestore, no auth) so the weighting rules are testable and live in one
// documented place, consumed by X2's weighted confirm/dispute logic and
// Y3's contribution-identity display.
//
// The problem this solves: before X2, a post's identification was
// "confirmed" the moment any 3 signed-in users clicked Confirm, and
// "disputed" on a single click — every voice weighted equally. That's fine
// for engagement but not defensible as a science signal: three casual
// users agreeing shouldn't equal one qualified naturalist. Here, each
// verifier carries a WEIGHT, and confirmations/disputes accumulate weight
// rather than count heads.

import { UserProfileData, VerificationState } from "../types";

// A verifier's identity for weighting purposes. `isExpert` comes from the
// 'expert' custom claim (token-authoritative), not the profile mirror —
// callers pass the claim they read from the ID token so a stale profile
// copy can never inflate weight.
export interface VerifierIdentity {
  reputationScore: number;
  isExpert: boolean;
}

// Weight thresholds and tuning constants — one place to reason about the
// whole model.
export const REPUTATION_CONSTANTS = {
  // Cumulative confirmation weight at/above which an ID is community-confirmed.
  // Set to 3 so the default (three ordinary users, weight 1 each) preserves
  // the pre-X2 "feels like 3 people agreed" behaviour — but a couple of
  // high-reputation users, or one expert, can also cross it.
  CONFIRM_THRESHOLD: 3,
  // Base weight for any signed-in, non-expert verifier.
  BASE_WEIGHT: 1,
  // Each prior community-confirmed observation the verifier authored adds
  // this much weight, capped, so a proven contributor counts for more
  // without ever letting reputation alone dwarf an expert.
  REPUTATION_WEIGHT_PER_POINT: 0.5,
  REPUTATION_WEIGHT_CAP: 4,
  // An expert's flat weight — high enough that a single expert confirmation
  // crosses CONFIRM_THRESHOLD on its own, and (see X2) promotes to
  // research-grade, mirroring iNaturalist's "qualified confirmation" bar.
  EXPERT_WEIGHT: 10,
} as const;

// The weight a given verifier's confirm/dispute carries. Non-experts:
// BASE + capped reputation bonus. Experts: a flat high weight (their
// standing doesn't need the reputation ramp).
export const getVerificationWeight = (verifier: VerifierIdentity): number => {
  if (verifier.isExpert) return REPUTATION_CONSTANTS.EXPERT_WEIGHT;
  const bonus = Math.min(
    Math.max(verifier.reputationScore, 0) * REPUTATION_CONSTANTS.REPUTATION_WEIGHT_PER_POINT,
    REPUTATION_CONSTANTS.REPUTATION_WEIGHT_CAP,
  );
  return REPUTATION_CONSTANTS.BASE_WEIGHT + bonus;
};

export type ReputationTier = 'novice' | 'contributor' | 'naturalist' | 'expert';

// A human-facing standing derived from reputationScore (+ expert claim),
// for profile/badge display (Y3). Thresholds are deliberately gentle so
// new users see forward motion early.
export const reputationTier = (reputationScore: number, isExpert: boolean): ReputationTier => {
  if (isExpert) return 'expert';
  if (reputationScore >= 15) return 'naturalist';
  if (reputationScore >= 3) return 'contributor';
  return 'novice';
};

export const REPUTATION_TIER_LABELS: Record<ReputationTier, string> = {
  novice: 'Novice',
  contributor: 'Contributor',
  naturalist: 'Naturalist',
  expert: 'Verified Expert',
};

// Convenience: build a VerifierIdentity from a profile doc + the expert
// claim read from the token. Profile may be null (brand-new user).
export const verifierFromProfile = (
  profile: Pick<UserProfileData, 'reputationScore'> | null | undefined,
  isExpertClaim: boolean,
): VerifierIdentity => ({
  reputationScore: profile?.reputationScore ?? 0,
  isExpert: isExpertClaim,
});

// X2: the single source of truth for a post's verification state, given
// the accumulated confirmation/dispute weights and whether any expert has
// confirmed. Pure and total so both the write path (ModerationService) and
// any optimistic client update compute the same answer.
//
// Ordering of checks matters:
//   1. A weighted disagreement that meets or beats the confirmations wins
//      → 'disputed' (surfacing a credible "this looks wrong" promptly
//      matters more than protecting a fragile "confirmed").
//   2. Otherwise, enough confirmation weight → 'confirmed', promoted to
//      'research-grade' when a qualified (expert) verifier is among the
//      confirmers (their weight alone clears the threshold, so one expert
//      confirmation = research-grade).
//   3. Otherwise 'unverified'.
export const computeVerificationState = (
  confirmWeightTotal: number,
  disputeWeightTotal: number,
  hasExpertConfirmation: boolean,
): VerificationState => {
  if (disputeWeightTotal > 0 && disputeWeightTotal >= confirmWeightTotal) return 'disputed';
  if (confirmWeightTotal >= REPUTATION_CONSTANTS.CONFIRM_THRESHOLD) {
    return hasExpertConfirmation ? 'research-grade' : 'confirmed';
  }
  return 'unverified';
};

// Whether a state counts as "the crowd agreed with this ID" — used to
// award the author reputation once, and to gate the Darwin Core research
// export (X3).
export const isVerifiedState = (state: VerificationState | undefined): boolean =>
  state === 'confirmed' || state === 'research-grade';
