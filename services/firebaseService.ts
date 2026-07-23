// W2: this file used to hold every Firestore/Storage/Auth operation in
// the app directly — one ~2000-line object literal covering user
// profiles, auth, drafts, media upload, posts/feed, comments,
// notifications, AI/quality telemetry, moderation, and one-off migrations.
// The implementation now lives in domain modules under services/firebase/
// (one per concern, each independently readable/reviewable); this file is
// just the assembly point, re-exporting the exact same FirebaseService.xxx
// surface every existing call site already imports, so nothing outside
// services/firebase/ needed to change.
//
// The domain modules call back into `FirebaseService` (imported from this
// file) wherever the original code called a sibling method — e.g.
// authService.ts's loginUser calls FirebaseService.ensureUserProfile,
// which now lives in profileService.ts. This is a circular import
// (firebaseService.ts imports the domain modules, which import
// firebaseService.ts back), which is safe here because none of these
// modules call each other at import time — only later, inside async
// functions triggered by user actions, by which point every module has
// finished initializing.
import { ProfileService } from "./firebase/profileService";
import { AuthService } from "./firebase/authService";
import { ConfigService } from "./firebase/configService";
import { DraftsService } from "./firebase/draftsService";
import { MediaService } from "./firebase/mediaService";
import { PostsService } from "./firebase/postsService";
import { CommentsService } from "./firebase/commentsService";
import { NotificationsService } from "./firebase/notificationsService";
import { TelemetryService } from "./firebase/telemetryService";
import { ModerationService } from "./firebase/moderationService";
import { MigrationService } from "./firebase/migrationService";

export { OperationType, handleFirestoreError, getCorsProxyUrl } from "./firebase/shared";
export type { FirestoreErrorInfo } from "./firebase/shared";

export const FirebaseService = {
  ...ProfileService,
  ...AuthService,
  ...ConfigService,
  ...DraftsService,
  ...MediaService,
  ...PostsService,
  ...CommentsService,
  ...NotificationsService,
  ...TelemetryService,
  ...ModerationService,
  ...MigrationService,
};
