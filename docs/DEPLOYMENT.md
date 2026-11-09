# Deploying NatureGram safely

Changes to security rules and indexes **must be deployed in this order**. Otherwise live clients can break.

## 0. Immediately (one-time, Phase 0)
1. **Rotate the Gemini API key.** Earlier server versions printed it to logs and exposed those logs at `/api/debug-logs`.
   - Create a new key in Google AI Studio or Cloud Console and store it in Secret Manager (`gemini_api_key`).
   - Delete the old key.
2. Restrict both Firebase web API keys (Cloud Console → APIs & Services → Credentials):
   - Add HTTP-referrer restrictions: `thenaturegram.com/*`, `*.thenaturegram.com/*`.
   - Add API restrictions: Firebase, Identity Toolkit, Firestore and Storage only. **Never** enable the Generative Language API on a web key.
3. Delete any `server_env.log` or `proxy.log` files left on old instances.

## 1. Indexes first
```bash
firebase deploy --only firestore:indexes
```
Wait until every index shows **Enabled** in the console (usually a few minutes). The new client queries the feed with `isPublic == true`. Until the index is ready it falls back to the legacy query, which only works under the old rules.

## 2. Server + client
Deploy the app as usual (Cloud Run / AI Studio):
```bash
gcloud run deploy naturegram --source=. --update-secrets=GEMINI_API_KEY=gemini_api_key:latest
```
- The server reads `PORT` (Cloud Run sets it automatically).
- Health check: `GET /healthz`.
- Optional environment variables are documented in `.env.example`: quotas, allowed models, `PUBLIC_HOST`.

## 3. Security rules
```bash
firebase deploy --only firestore:rules,storage
```
Admin access now requires a **verified** email (or the `admin` custom claim). After deploying:
1. Open **Profile → Admin Console**. If you see "Admin access now requires a verified email", click **Send verification email**, verify, then sign out and back in.
2. In **Activity Logs**, click **Secure locations** once. This moves precise GPS coordinates that older posts stored publicly into each owner's private area. Nothing is deleted.

### Optional: grant admin with a custom claim (recommended long term)
```js
// node, with Application Default Credentials for project biostream-6490a
import admin from 'firebase-admin';
admin.initializeApp({ projectId: 'biostream-6490a' });
const user = await admin.auth().getUserByEmail('ram@iitj.ac.in');
await admin.auth().setCustomUserClaims(user.uid, { admin: true });
```

## Rollback
- Rules: redeploy the previous `firestore.rules` from git history (`git show <sha>:firestore.rules`).
- App: redeploy the previous Cloud Run revision (`gcloud run services update-traffic`).
- No data migration in these releases deletes data. The location migration moves coordinates to `users/{uid}/private/obs_{postId}`.

## Push notifications (optional)
1. Firebase console → Project settings → Cloud Messaging → **Web Push certificates** → generate a key pair.
2. Build the web app with `VITE_FCM_VAPID_KEY=<public key>` set (for example in `.env` or the Cloud Build substitutions).
3. Deploy the sender function (Blaze plan required): `cd functions && npm install && cd .. && firebase deploy --only functions`.

Without these steps, explorers still get system notifications while NatureGram is open in a background tab, plus all in-app activity.

## Analytics
See `docs/ANALYTICS.md` for the BigQuery log sink and the event taxonomy.

## Shared AI quotas (multi-instance)
Superseded by the governance release below: allowances now **fail closed** when the store is unreachable.

## Rules change in the naturalist-wonder release

`firestore.rules` now allows the `identification` notification type (an explorer confirming or questioning someone's ID). Deploy rules with `firebase deploy --only firestore:rules` after the app is live. No new indexes are needed: the challenge progress, weekly letter and duplicate-note checks use existing indexes. Until the rules are deployed, ID notifications are skipped silently and everything else works.

## Governance and control release (server-owned AI, server publishing, admin console v2)

This release moves every limit, prompt and share check to the server. **Do these steps in order.** Until step 3 is done the server can't reach the database, and because allowances fail closed, AI features and sharing will refuse requests.

### 1. Give the server database access
The server uses the Firebase Admin SDK for allowances, settings, logs, publishing and the admin API.
- If Cloud Run runs **inside** project `biostream-6490a`: give its service account the roles **Cloud Datastore User**, **Firebase Authentication Admin** and **Storage Object Viewer**.
- If it runs in **another** project: create a service account in `biostream-6490a` with those roles, create a JSON key, store it in Secret Manager (`firebase_service_account`) and pass it as `FIREBASE_SERVICE_ACCOUNT`.
- Check: `GET /healthz` must show `"ok": true` and `"reachable": true`.

### 2. Server environment
| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | from Secret Manager (unchanged) |
| `FIREBASE_SERVICE_ACCOUNT` | only if Cloud Run is outside the Firebase project (step 1) |
| `ADMIN_UIDS` | Ram's Firebase uid (printed by the script in step 4). Pins admin to that one account. |
| `ADMIN_EMAIL` | optional; defaults to `ram@iitj.ac.in` and is used only while `ADMIN_UIDS` is unset |
| `ADMIN_SESSION_HOURS` | optional; default 12 (the admin must have signed in within this time) |
| `QUOTA_FAIL_OPEN` | **leave unset in production** (only for local development) |
| `MODEL_*` | optional starting models; the admin console overrides them |

```bash
gcloud run deploy naturegram --source=. \
  --update-secrets=GEMINI_API_KEY=gemini_api_key:latest \
  --update-env-vars=ADMIN_UIDS=<ram-uid>
```

### 3. Indexes, rules, functions
```bash
firebase deploy --only firestore:indexes      # wait until all are Enabled
firebase deploy --only firestore:rules,storage
firebase deploy --only functions              # admin check on the transcode backfill is now claim-only
```
- Storage rules now read `app_config/flags` (the uploads switch). The first deploy asks to let Storage read Firestore: accept.
- After the rules are live, clients can no longer create posts directly: sharing goes through `/api/publish`. Deploy the app (step 2) **before** or together with the rules.

### 4. Make Ram the only admin
Admin is now the `admin` custom claim **only** (the email fallback is gone from rules, functions and the app).
```bash
node scripts/set-admin.mjs --email ram@iitj.ac.in            # dry run
node scripts/set-admin.mjs --email ram@iitj.ac.in --apply    # sets the claim, removes it from anyone else
```
Run it with credentials for `biostream-6490a` (Application Default Credentials or `FIREBASE_SERVICE_ACCOUNT`). Put the printed uid in `ADMIN_UIDS`, redeploy, then sign out and back in. The console's **Audit & security** section should list exactly one admin.

**Recommended:** enable two-step sign-in. Firebase console → Authentication → Sign-in method → Advanced → **SMS multi-factor** (needs Identity Platform). Enrol Ram's account, then switch on **Require two-step sign-in** in Audit & security.

### 5. Automatic clean-up (TTL policies)
Firestore → TTL: add policies on field `expireAt` for collection groups `ai_usage`, `ai_log` and `ai_results`.

### 6. Protect against surprises
- **Backups:** Firestore → Disaster recovery → turn on point-in-time recovery and a daily backup schedule.
- **Billing alerts:** Cloud Billing → Budgets & alerts on the project (for example at 50%, 90% and 100% of a monthly budget). The admin console's daily token ceiling is a second guard.
- **App Check (optional, later):** register the web app with reCAPTCHA Enterprise in Firebase App Check, run in monitoring mode for two weeks, then enforce for Firestore and Storage.

### 7. One-off jobs
- Convert older WebM videos (for iPhone playback and video stills): call the `backfillTranscodes` function while signed in as admin.
- Older posts have no `moderation` field. They stay as they are; when an explorer moves one from the journal to the feed, the server checks its picture first.

### What changes for explorers
- Daily allowance for everyone, no exceptions: 3 shares, 3 live minutes, 15 identifications (admin-settable). The app shows what is left.
- A capture with a person, face, number plate or screen, or without a living subject, is held back with a message saying how to fix it; the explorer can ask for a review instead.
- Guests can browse and use the guide (if the admin allows) but must create an account to share.
- Letters are private; the admin can read a conversation only after a participant reports it.

### Rollback
Redeploy the previous Cloud Run revision **and** the previous rules (`git show <sha>:firestore.rules`, `storage.rules`) together. Settings and logs written by this release are left in place and do no harm.

### Tests
```bash
npm run test:server                                    # AI governance, settings validation, publish checks
npx firebase emulators:exec --only firestore,storage --project demo-ng "node tests/rules/rules.test.mjs"
```
