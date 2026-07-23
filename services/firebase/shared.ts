// W2: extracted from firebaseService.ts (which had grown to ~2000 lines
// covering every Firestore domain in one file) — these are the utilities
// several of the domain modules under services/firebase/ depend on, kept
// in one place so none of them have to duplicate them.
import { auth } from "../../firebaseConfig";
import { GeminiConfig } from "../../types";
import { SYSTEM_INSTRUCTION } from "../../constants";

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // Removed throw new Error to prevent React app crashes on silent background failures
}

// Runs the automated content-safety pre-screen (GenAiService.checkContentSafety)
// on a post's primary media and returns the reportStatus/reports fields to
// merge into the new post doc. Flagged content lands in AdminConsole's
// existing moderation queue (reportStatus: 'pending') instead of being
// blocked outright — see checkContentSafety for the fail-open rationale.
// Dynamically imports genAiService to avoid a static circular import
// (genAiService.ts imports FirebaseService for usage telemetry).
export async function screenPostSafety(mediaBlob: Blob | undefined | null): Promise<{ reportStatus: 'safe' | 'pending', reports: { reason: string, timestamp: any }[] }> {
  const { GenAiService } = await import('../genAiService');
  const safety = await GenAiService.checkContentSafety(mediaBlob);
  if (safety.isSafe) {
    return { reportStatus: 'safe', reports: [] };
  }
  return {
    reportStatus: 'pending',
    reports: [{ reason: `Automated screening: ${safety.reason}`, timestamp: Date.now() }]
  };
}

// Firebase Storage's download endpoint (firebasestorage.googleapis.com)
// already sends "Access-Control-Allow-Origin: *" on every response, so
// browser fetch()/canvas access works directly — verified against a live
// download URL, not assumed. This used to route through a server-side
// /api/media-proxy hop for exactly that reason; that hop has been removed
// as unnecessary latency/cost. Kept as a pass-through (rather than
// inlining at each call site) so callers don't need to change.
export const getCorsProxyUrl = (url: string) => url;

export const DEFAULT_CONFIG: GeminiConfig = {
  model: 'gemini-2.5-flash-native-audio-latest',
  systemInstruction: SYSTEM_INSTRUCTION,
  knowledgeBaseFiles: [],
  trainingExamples: []
};
