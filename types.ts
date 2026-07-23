
// One entry in a multi-subject breakdown — populated by the AI only when
// multiple clearly distinct organisms are worth listing individually (e.g.
// a bird AND the flower it's visiting), left empty for single-subject
// observations.
export interface TaxonomySubject {
  label: string;
  role?: 'primary' | 'secondary' | 'background';
  confidence?: string;
}

// One plausible alternative identification the model considered but didn't
// settle on — populated only when there's genuine ambiguity between similar
// species, alongside a plain-language way to tell them apart.
export interface TaxonomyCandidate {
  label: string;
  distinguishingFeature?: string;
  confidence?: string;
}

// A post's identification can move from the AI's raw output toward
// ground truth via community/expert agreement — this is that state, not a
// moderation status (see CommunityPost.reportStatus for that).
// X2: 'research-grade' sits above 'confirmed' — reached only when a
// qualified (expert) verifier has confirmed the ID, mirroring
// iNaturalist's "research grade" bar. Ordering of trust, low to high:
// unverified < confirmed < research-grade; 'disputed' is orthogonal
// (a weighted disagreement outweighing the confirmations).
export type VerificationState = 'unverified' | 'confirmed' | 'research-grade' | 'disputed';

// One distinct call/vocalization event within an audio or video recording —
// populated only when a recording has multiple temporally distinguishable
// sounds (e.g. two species calling at different times, or overlapping
// choruses), never for a single continuous/simple sound (see S2: "multiple
// overlapping, time-stamped calls in one recording, not one label").
// start/endSec are the model's best estimate from the recording, not a
// frame-accurate measurement.
export interface SoundscapeEvent {
  label: string;
  startSec?: number;
  endSec?: number;
  confidence?: string;
}

// A freeform AI-proposed label resolved against GBIF's public taxonomic
// backbone into a canonical, cross-referenceable species identity (see T3:
// "canonical species IDs + hierarchy instead of freeform strings"). This is
// best-effort enrichment computed after publish (see enrichPostTaxonomy in
// firebaseService.ts) — a post is never blocked on it, and a label with no
// confident GBIF match just never gets an entry here.
export interface TaxonResolution {
  matchedLabel: string;
  gbifKey: number;
  scientificName: string;
  canonicalName: string;
  rank?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  taxonomicStatus?: string;
  // V3: region-aware common names, best-effort — GBIF's vernacularNames
  // are keyed by ISO 639-2/T language codes (e.g. "spa", "hin"), fetched
  // separately from the GBIF Backbone Taxonomy usageKey since /species/search
  // results (matched by freeform label) don't reliably carry the full
  // vernacular list themselves. See taxonomyService.ts's getRegionalCommonName.
  vernacularNames?: { language: string; name: string }[];
}

export interface FieldNotification {
  id: string;
  type: 'like' | 'comment' | 'sighting' | 'system';
  message: string;
  timestamp: any;
  postId?: string;
  isRead: boolean;
  senderId?: string;
  senderName?: string;
}

export interface UserProfileData {
  uid: string;
  username: string;
  bio?: string;
  avatarUrl?: string;
  joinedAt: any;
  stats?: {
    observations: number;
    species: number;
  }
  // X1: track-record reputation. Incremented when one of this user's own
  // observations reaches community-confirmed (see X2's confirm logic) —
  // i.e. the crowd agreed with an ID they published. Feeds reputationTier
  // and getVerificationWeight (reputationService.ts): a user who has been
  // right before carries more weight when confirming others' IDs. Absent /
  // 0 for new users; never negative.
  reputationScore?: number;
  // X1: mirror of the 'expert' custom claim, written for display only (the
  // token claim remains the authority — see reputationService and
  // firestore.rules). A qualified naturalist whose confirmation alone can
  // promote an ID to research-grade.
  isExpert?: boolean;
  // Web Push (FCM) registration tokens, one per device/browser that has
  // opted in. An array since a user can have multiple active devices.
  fcmTokens?: string[];
}

export interface Snapshot {
  id: string;
  url?: string; 
  blob?: Blob;  
  timestamp: string;
  labels: string[];
  behavior?: string;
  type: 'image' | 'video' | 'audio';
  aiInsight?: string;
  location?: string;
  locationArea?: string;
  userId?: string;
  public?: boolean;
  isHybrid?: boolean; 
  videoBlob?: Blob;
  audioBlob?: Blob;
  videoUrl?: string;
  audioUrl?: string;
  thumbnailUrl?: string;
  associatedImages?: { url?: string; blob?: Blob }[];
  isAnalyzing?: boolean;
  rotation?: number;
  rawLocation?: { lat: number; lng: number } | null;
  timeToRecordMs?: number;
  aiProposedLabels?: string[];
  aiProposedBehavior?: string;
  humanDelta?: boolean;
  sessionRetakes?: number;
  // False when the agent/analysis found no plant, animal, fungus, or other
  // natural subject in the media (a scope check, not a low-confidence ID).
  isNatureSubject?: boolean;
  confidence?: 'high' | 'medium' | 'low';
  isSensitiveSpecies?: boolean;
  subjects?: TaxonomySubject[];
  candidates?: TaxonomyCandidate[];
  soundscape?: SoundscapeEvent[];
}

export interface ExpeditionDraft {
  id: string;
  userId: string;
  snapshots: Snapshot[];
  summary: string;
  timestamp: any;
}

export interface GroundingLink {
  title: string;
  uri: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: Date;
  groundingLinks?: GroundingLink[];
}

export interface LogEntry {
  id: string;
  message: string;
  timestamp: Date;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface NaturalistMemory {
  interests: string[];
  equipment: string[];
  lastSessionSummary: string;
  preferredStyle: string;
  frequentLocations: string[];
}

export interface UserMode {
  type: 'anonymous' | 'community' | 'admin';
  userId?: string;
  isAnonymous?: boolean;
  email?: string | null;
  displayName?: string;
}

export enum AppView {
  LANDING = 'LANDING',
  LENS = 'LENS',
  POST_SESSION = 'POST_SESSION',
  COMMUNITY = 'COMMUNITY',
  ADMIN = 'ADMIN',
  JOURNAL = 'JOURNAL',
  USER_PROFILE = 'USER_PROFILE',
  DRAFTS = 'DRAFTS',
  SHARED_POST = 'SHARED_POST',
  MAP = 'MAP'
}

export interface GeminiConfig {
  model: string;
  systemInstruction: string;
  knowledgeBaseFiles?: string[];
  trainingExamples?: { user_voice: string; ideal_response: string }[];
}

export interface CommunityPostItem {
  imageUrl?: string;
  thumbnailUrl?: string;
  originalImageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  mediaType: 'image' | 'video' | 'audio';
  labels: string[];
  behavior: string;
  aiInsight?: string;
  locationArea?: string;
  showLocation?: boolean;
  associatedImageUrls?: string[];
  rotation?: number;
  rawLocation?: { lat: number; lng: number } | null;
  timeToRecordMs?: number;
  aiProposedLabels?: string[];
  aiProposedBehavior?: string;
  humanDelta?: boolean;
  sessionRetakes?: number;
  isNatureSubject?: boolean;
  confidence?: 'high' | 'medium' | 'low';
  isSensitiveSpecies?: boolean;
  subjects?: TaxonomySubject[];
  candidates?: TaxonomyCandidate[];
  soundscape?: SoundscapeEvent[];
  verificationState?: VerificationState;
  confirmedBy?: string[];
  disputes?: { uid: string; suggestedLabel: string; reason?: string; timestamp: any }[];
  // The client-generated capture id (Snapshot.id) this item originated from —
  // the thread back to its quality_events document, so a post-publish edit
  // (EditPostDetails) can record a correction against the same record the
  // analysis-time write created.
  snapshotId?: string;
}

export interface FeedThumbnail {
  id: string;
  mediaType: 'image' | 'video' | 'audio';
  thumbnailUrl: string;
  title?: string;
  description?: string;
  timestamp: any;
  userId: string;
  userName: string;
  likes: string[];
  commentCount: number;
  isPublic: boolean;
  tags: string[];
  labels: string[]; // required for UI sometimes
  behavior?: string; // used in feed optionally?
  aiInsight?: string;
  locationArea?: string;
  isHybrid?: boolean;
}

export interface CommunityPost extends FeedThumbnail {
  imageUrl?: string; 
  originalImageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  behavior?: string;
  showLocation?: boolean;
  isJournal?: boolean;
  associatedImageUrls?: string[];
  reports?: { reason: string; timestamp: any }[];
  reportStatus?: string;
  items?: CommunityPostItem[];
  rotation?: number;
  rawLocation?: { lat: number; lng: number } | null;
  timeToRecordMs?: number;
  aiProposedLabels?: string[];
  aiProposedBehavior?: string;
  humanDelta?: boolean;
  sessionRetakes?: number;
  isNatureSubject?: boolean;
  confidence?: 'high' | 'medium' | 'low';
  isSensitiveSpecies?: boolean;
  subjects?: TaxonomySubject[];
  candidates?: TaxonomyCandidate[];
  soundscape?: SoundscapeEvent[];
  verificationState?: VerificationState;
  confirmedBy?: string[];
  disputes?: { uid: string; suggestedLabel: string; reason?: string; weight?: number; timestamp: any }[];
  // X2: weighted verification. confirmedBy stays the uid list (dedup +
  // "you already confirmed" UI); these carry the summed verifier WEIGHTS
  // (see reputationService.getVerificationWeight) that actually drive
  // verificationState, so three casual users no longer equal one expert.
  // hasExpertConfirmation gates the research-grade tier; reputationAwarded
  // ensures the author's reputation is bumped at most once when their post
  // first reaches confirmed.
  confirmWeightTotal?: number;
  disputeWeightTotal?: number;
  hasExpertConfirmation?: boolean;
  reputationAwarded?: boolean;
  snapshotId?: string;
  canonicalTaxa?: TaxonResolution[];
  // Geohash of rawLocation, computed at post-creation time (see T4) —
  // never set for sensitive-species posts, so they simply don't appear on
  // the species map, consistent with the "Location Withheld" display
  // policy already applied elsewhere for those posts.
  geohash?: string;
}

export interface Comment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: any;
}

export type AudioMode = 'voice' | 'silent';

// One completed Live session's performance summary (see R1 in the roadmap:
// "you can't optimize or pitch the real-time experience without measuring
// it"). Written once per session, when GeminiLiveService.disconnect() is
// called manually (not on an internal reconnect). Self-reported by the
// client, same trust tier as AiUsageLogEntry.
export interface LiveSessionMetricsEntry {
  id?: string;
  uid: string;
  model?: string;
  timeToFirstTokenMs?: number;
  avgTurnLatencyMs?: number;
  maxTurnLatencyMs?: number;
  turnCount: number;
  toolCallCounts: Record<string, number>;
  reconnectCount: number;
  // U2 cost-model inputs — real measurements, not estimates (see
  // LiveSessionMetrics in geminiLiveService.ts for why these three exist).
  sessionDurationMs?: number;
  totalOutputAudioSec?: number;
  videoFramesSent?: number;
  timestamp?: any;
}

// Client-reported record of a single Gemini call, written for cost/usage
// visibility in AdminConsole. Self-reported by the calling client (like
// likes/commentCount elsewhere in this app), not an authoritative billing
// source — cross-check against Cloud Billing for real cost figures.
export interface AiUsageLogEntry {
  id?: string;
  uid: string;
  feature: string;
  model: string;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  timestamp?: any;
}

// One identification *outcome* — distinct from AiUsageLogEntry (which is
// pure cost/token telemetry with no notion of whether the identification
// was any good). This is the substrate the eval harness scores against,
// the verification loop (Q3) updates, and the calibration pipeline (Q4)
// aggregates over. snapshotId is the stable thread linking a live capture
// through analysis, any human correction, and any later community/expert
// verification — the same identification's full lifecycle in one record.
export interface QualityEvent {
  id?: string;
  uid: string;
  postId?: string;
  snapshotId: string;
  mediaType: 'image' | 'video' | 'audio';
  feature: 'liveCapture' | 'analyzeMedia' | 'analyzeMultimodal' | 'upload';
  modelUsed?: string;
  latencyMs?: number;
  isNatureSubject?: boolean;
  isHybrid?: boolean;
  isSensitiveSpecies?: boolean;
  confidence?: 'high' | 'medium' | 'low';
  aiProposedLabels: string[];
  finalLabels?: string[];
  humanCorrected: boolean;
  correctionCount: number;
  verificationState: VerificationState;
  confirmations: number;
  disputeCount: number;
  timestamp?: any;
  updatedAt?: any;
}

// A calibration table mapping the model's raw self-reported confidence
// ('high'/'medium'/'low') to the observed correctness rate for that bucket,
// computed from confirmed/disputed QualityEvents. Stored at
// admin_config/confidence_calibration. Empty/absent buckets mean there
// isn't enough verified data yet — display code must treat that as
// "unvalidated," never fabricate a number.
export interface ConfidenceCalibration {
  computedAt: any;
  sampleSize: number;
  buckets: {
    high?: { observedAccuracy: number; sampleSize: number };
    medium?: { observedAccuracy: number; sampleSize: number };
    low?: { observedAccuracy: number; sampleSize: number };
  };
}
