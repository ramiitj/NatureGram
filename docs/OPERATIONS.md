# Operations

Settings, switches and one-off jobs for running NatureGram. Deployment steps are in `docs/DEPLOYMENT.md`; AI controls in `docs/AI_GOVERNANCE.md`.

## Environment variables added in the November 2026 roadmap release

### Server (Cloud Run)
| Variable | Default | What it does |
|---|---|---|
| `APPCHECK_ENFORCE` | unset (monitoring) | `true` refuses AI, publishing and live calls without a valid App Check token. Leave unset until the counts under Admin → Audit & security show almost every call verified, and never while native apps ship without an App Check provider. |
| `LIVE_GLOBAL_MAX_CONCURRENT` | `0` (no cap) | Live sessions open at once across all explorers and all server instances (shared leases). |
| `QUOTA_MAX_CONCURRENT_LIVE` | `1` | Existing: live sessions per explorer. Now enforced across instances through `live_leases`. |
| `LIVE_DIRECT_TOKENS` | unset (off) | `true` lets the app connect to Gemini Live directly with one-use ephemeral tokens instead of streaming through the server. Needs the server to reach Firestore (minutes are charged from shared records); without it the app keeps using the proxy. |
| `MODERATION_FAIL_OPEN` | `true` | When the publish image check errors, publish anyway and queue the sighting for an after-the-fact look. `false` holds it until reviewed (the previous behaviour). |
| `DWC_CONTACT_EMAIL` | unset | Contact address written into `eml.xml` in the Darwin Core export. |

### Web build (Vite, set at build time)
| Variable | What it does |
|---|---|
| `VITE_APPCHECK_SITE_KEY` | Turns on App Check in the web app with this reCAPTCHA Enterprise site key. Unset means no App Check code is loaded. |
| `VITE_APPCHECK_PROVIDER` | `enterprise` (default) or `v3` for a classic reCAPTCHA v3 key. |
| `VITE_APPCHECK_DEBUG_TOKEN` | Local development only: a debug token registered in the Firebase console. |
| `VITE_SENTRY_DSN` | Also forward client errors to Sentry (one small POST to the envelope endpoint, no SDK). Only a scrubbed message, the page path without query, and the release go out: no account ids, captions, emails or tokens. At most 20 distinct errors per session. |
| `VITE_RELEASE` | Optional release name attached to Sentry events (for example the git SHA). |

## App Check: turning it on
1. Firebase console → App Check → register the web app with **reCAPTCHA Enterprise** (create the key in Google Cloud → reCAPTCHA Enterprise, add `thenaturegram.com`, `www.thenaturegram.com` and any preview domains).
2. Build with `VITE_APPCHECK_SITE_KEY=<site key>` and deploy. The server's Content-Security-Policy already allows `www.google.com`/`recaptcha.net` scripts and frames.
3. Watch Admin → Audit & security → App Check for a few days (verified / without a token / invalid).
4. Native apps: add App Attest (iOS) and Play Integrity (Android) providers before enforcing; until then they send no token.
5. Set `APPCHECK_ENFORCE=true` on the server. Roll back by removing it.

Do not enable App Check *enforcement for Firestore* in the Firebase console at the same time without testing: that is a separate switch and affects every database read.

## Live sessions
- `live_leases` holds one document per open live session. Add a **TTL policy** on `live_leases.expireAt` (Firestore → TTL) so documents left by crashed instances are removed automatically.
- If the server's service account cannot read Firestore (`PERMISSION_DENIED` in logs), live still works with per-instance limits; Admin → Audit & security shows "this server counts on its own". Fix by setting `FIREBASE_SERVICE_ACCOUNT` or granting the runtime account *Cloud Datastore User*.
- Direct mode (`LIVE_DIRECT_TOKENS=true`): the app calls `GET /api/live/config`, then `POST /api/live/token`, connects to Gemini's constrained endpoint, heartbeats `POST /api/live/heartbeat` every 30 s and reports `POST /api/live/end`. Any instance charges sessions that never reported an end (the token's full lifetime) every two minutes. Flip it off at any time; open sessions finish on their token.

## Moderation
- Admin → Review → *Moderation queue* lists sightings held by the safety check, privacy reviews, sightings published while the image check was down, and field notes held by the word check.
- Admin → Review → *Words that send a sighting to review* adds local words to the built-in list (applies to field notes within five minutes, through the Cloud Function's cache).

## Search
- New sightings get `searchTokens` at publish. For older ones run **Admin → Data explorer → Add search keys to older sightings** once after deploying (batched, safe to repeat; it only writes where keys are missing or stale).
- Deploy `firestore.indexes.json` first: search uses `feed_thumbnails (searchTokens array-contains, isPublic, timestamp desc)`. Until it is built the app searches without ordering, then falls back to hashtags.

## Darwin Core / GBIF export
Admin → Data explorer → **Export Darwin Core Archive** downloads `naturegram-dwca-<date>.zip` (`occurrence.csv`, `meta.xml`, `eml.xml`). Public, unhidden, reviewed sightings with a scientific name only; CC BY-NC 4.0; coordinates rounded to 0.1° only where the explorer shared the place and never for sensitive species; `recordedBy` is the public username (guests and profiles with `profilePrivate: true` or `shareNameInExports: false` are left anonymous). To publish on GBIF, register NatureGram as a publisher and upload the archive to an IPT or the GBIF registry.

## Cloud Functions (deploy with `firebase deploy --only functions`)
| Function | Trigger | What it does |
|---|---|---|
| `moderateComment` | new `ecosystem_feed/{post}/comments/{id}` | Word and spam checks; hides and queues flagged notes |
| `syncCommunityVerification` | write to `ecosystem_feed/{post}/identifications/{uid}` | Keeps `idAgreeCount`, `communityVerified`, `communityVerifiedAt` on the post and its feed entry (used by Explore and the export) |
| `reconcileCounters` | daily 03:17 UTC | Recomputes `likeCount` (like documents not in the legacy array), `commentCount`, `followersCount`, `followingCount`; pages with a cursor in `admin_private/reconcile`; writes only differences; never deletes |

## Feature flags
`config/flags` (public read, admin write) is edited in Admin → Experiments. A missing document or flag means off. Exposure events are `experiment_exposure { flag, variant, on }` (only for explorers who allow analytics).

## Native icons and splash
`node scripts/generate-native-assets.mjs` regenerates every iOS and Android icon and splash image from `public/icon.svg` (uses Playwright's Chromium; set `PW_CHROMIUM_PATH` if needed), then `npx cap sync`.
