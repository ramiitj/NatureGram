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
The server records per-user daily AI usage in Firestore (`ai_usage/{uid}_{YYYY-MM-DD}`) through the Admin SDK, so limits hold across all Cloud Run instances.
1. Give the Cloud Run service account the **Cloud Datastore User** role on project `biostream-6490a`. If it runs in another project, add it there via IAM.
2. Add a TTL policy so old usage docs are deleted automatically: Firestore → TTL → collection group `ai_usage`, field `expireAt`.
3. Clients cannot read or write `ai_usage`, because no rule allows it.

If the store is unreachable, the server logs a warning and falls back to per-instance limits.

## Rules change in the naturalist-wonder release

`firestore.rules` now allows the `identification` notification type (an explorer confirming or questioning someone's ID). Deploy rules with `firebase deploy --only firestore:rules` after the app is live. No new indexes are needed: the challenge progress, weekly letter and duplicate-note checks use existing indexes. Until the rules are deployed, ID notifications are skipped silently and everything else works.
