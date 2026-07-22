
// One entry in a multi-subject breakdown — populated by the AI only when
// multiple clearly distinct organisms are worth listing individually (e.g.
// a bird AND the flower it's visiting), left empty for single-subject
// observations.
export interface TaxonomySubject {
  label: string;
  role?: 'primary' | 'secondary' | 'background';
  confidence?: string;
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
  SHARED_POST = 'SHARED_POST'
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
}

export interface Comment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: any;
}

export type AudioMode = 'voice' | 'silent';

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
