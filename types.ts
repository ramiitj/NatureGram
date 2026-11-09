
export interface FieldNotification {
  id: string;
  type: 'like' | 'comment' | 'follow' | 'mention' | 'reply' | 'message' | 'identification' | 'sighting' | 'system';
  message: string;
  timestamp: any;
  postId?: string;
  isRead: boolean;
  senderId?: string;
  senderName?: string;
}

export interface NaturalistPersona {
  archetype: string;
  taxaInterests: string[];
  observationStyles: string[];
  habitatAffinities: string[];
  customFocus?: string;
  curatorPrompt?: string;
  updatedAt?: any;
}

export interface BioacousticProfile {
  frequencyRangeHz?: string;
  vocalizationType?: string;
  callRhythmPattern?: string;
}

export interface VisualEthology {
  motionPosture?: string;
  diagnosticMarkings?: string[];
}

export interface HabitatNiche {
  microHabitat?: string;
  environmentalContext?: string;
}

export interface EthologicalDescriptors {
  bioacousticProfile?: BioacousticProfile;
  visualEthology?: VisualEthology;
  habitatNiche?: HabitatNiche;
  aiDescriptorVersion?: string;
}

export interface UserProfileData {
  uid: string;
  username: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  isAnonymous?: boolean;
  followersCount?: number;
  followingCount?: number;
  naturalistPersona?: NaturalistPersona;
  /** Legacy fields kept for existing documents */
  email?: string;
  location?: string;
  lastVisit?: any;
  joinedAt: any;
  stats?: {
    observations: number;
    species: number;
  }
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
  aiConfidence?: 'high' | 'medium' | 'low' | null;
  showLocation?: boolean;
  /** Governed AI output kept for audit + UI (see docs/AI_GOVERNANCE.md) */
  aiIdentifications?: { commonName: string; scientificName: string; rank: string; confidence: string; evidence: string }[];
  aiFlags?: { isNatureSubject: boolean; fungi: boolean; dangerous: boolean; sensitiveSpecies: boolean; peopleVisible: boolean } | null;
  needsExpertReview?: boolean;
  aiSafetyNote?: string;
  aiModel?: string;
  aiPromptVersion?: string;
  aiError?: string | null;
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
  MESSAGES = 'MESSAGES',
  REELS = 'REELS'
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
  aiConfidence?: 'high' | 'medium' | 'low' | null;
  aiIdentifications?: { commonName: string; scientificName: string; rank: string; confidence: string; evidence: string }[];
  aiFlags?: { isNatureSubject: boolean; fungi: boolean; dangerous: boolean; sensitiveSpecies: boolean; peopleVisible: boolean } | null;
  needsExpertReview?: boolean;
  aiSafetyNote?: string;
}

export interface FeedThumbnail {
  id: string;
  mediaType: 'image' | 'video' | 'audio';
  thumbnailUrl: string;
  /** ~400px variant for small screens and grids */
  thumbSmallUrl?: string | null;
  title?: string;
  description?: string;
  timestamp: any;
  userId: string;
  userName: string;
  likes: string[];
  /** Scalable like counter (likes stored as documents under the post) */
  likeCount?: number;
  commentCount: number;
  isPublic: boolean;
  tags: string[];
  labels: string[]; // required for UI sometimes
  behavior?: string; // used in feed optionally?
  aiInsight?: string;
  aiConfidence?: 'high' | 'medium' | 'low' | null;
  locationArea?: string;
  isHybrid?: boolean;
  caption?: string | null;
  userAvatar?: string | null;
  ethologicalDescriptors?: EthologicalDescriptors | null;
  curatorNote?: string;
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
  reports?: string[];
  reportStatus?: string;
  reportCount?: number;
  aiPolicyVersion?: string;
  sourceUrl?: string;
  needsExpertReview?: boolean;
  aiFlags?: { isNatureSubject: boolean; fungi: boolean; dangerous: boolean; sensitiveSpecies: boolean; peopleVisible: boolean } | null;
  communityIdCount?: number;
  items?: CommunityPostItem[];
  rotation?: number;
  rawLocation?: { lat: number; lng: number } | null;
  timeToRecordMs?: number;
  aiProposedLabels?: string[];
  aiProposedBehavior?: string;
  humanDelta?: boolean;
  sessionRetakes?: number;
}

export interface Comment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: any;
  avatarUrl?: string;
  parentId?: string;
  editedAt?: any;
}

export type AudioMode = 'voice' | 'silent';

export interface Conversation {
  id: string;
  participants: string[];
  participantInfo?: Record<string, { username: string; avatarUrl?: string | null }>;
  lastMessage?: { text: string; senderId: string; at: any } | null;
  updatedAt?: any;
  lastReadAt?: Record<string, any>;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  text: string;
  postId?: string;
  createdAt: any;
}
