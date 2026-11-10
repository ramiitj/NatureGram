# Operations

Settings, switches and one-off jobs for running NatureGram. Deployment steps are in `docs/DEPLOYMENT.md`; AI controls in `docs/AI_GOVERNANCE.md`.

## Environment variables added in the November 2026 roadmap release

### Server (Cloud Run)
| Variable | Default | What it does |
|---|---|---|
| `APPCHECK_SITE_KEY` | unset | reCAPTCHA Enterprise site key handed to the web app at runtime (`/api/client-config`). Setting it turns App Check on without a rebuild. |
| `APPCHECK_PROVIDER` | `enterprise` | `v3` for a classic reCAPTCHA v3 key. |
| `APPCHECK_ENFORCE` | unset (monitoring) | `true` refuses AI, publishing and live calls without a valid App Check token. Leave unset until the counts under Admin → Audit & security show almost every call verified, and never while native apps ship without an App Check provider. |
| `LIVE_GLOBAL_MAX_CONCURRENT` | `0` (no cap) | Live sessions open at once across all explorers and all server instances (shared leases). |
| `QUOTA_MAX_CONCURRENT_LIVE` | `1` | Existing: live sessions per explorer. Now enforced across instances through `live_leases`. |
| `LIVE_DIRECT_TOKENS` | unset (off) | `true` lets the app connect to Gemini Live directly with one-use ephemeral tokens instead of streaming through the server. Needs the server to reach Firestore (minutes are charged from shared records); without it the app keeps using the proxy. |
| `MODERATION_FAIL_OPEN` | `true` | When the publish image check errors, publish anyway and queue the sighting for an after-the-fact look. `false` holds it until reviewed (the previous behaviour). |
| `DWC_CONTACT_EMAIL` | unset | Contact address written into `eml.xml` in the Darwin Core export. |
| `RESEND_API_KEY` | unset (no mail) | Sends NatureGram's own letters through [Resend](https://resend.com) (`server/mailer.js`): today the parent's consent letter for a teenage explorer. Without it the teen is given the link to pass on themselves through the share sheet, so teen sign-up still works. |
| `MAIL_FROM` | `NatureGram <field@thenaturegram.com>` | The sender. Its domain must be verified in Resend (below), or Resend refuses the send. |
| `MAIL_REPLY_TO` | unset | Optional reply-to address (e.g. the Grievance Officer). |
| `PUBLIC_ORIGIN` | `https://thenaturegram.com` | Origin used for links in letters (`/guardian?t=…`). |

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
2. Set `APPCHECK_SITE_KEY=<site key>` on the Cloud Run service (or build with `VITE_APPCHECK_SITE_KEY`) and deploy. The server's Content-Security-Policy already allows `www.google.com`/`recaptcha.net` scripts and frames.
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

| `graduateTeens` | daily 02:41 UTC | Teens whose `adultFrom` has passed become adults: `ageBand: 'adult'`, `adultFrom` and `guardian` removed, taken off the parent's `guardianOf`, `guardian_consents/{uid}.status = 'graduated'`. The server does the same lazily whenever it reads a band. |

## Mail: verifying the sending domain in Resend
1. Create a Resend account and add the domain in `MAIL_FROM` (e.g. `thenaturegram.com`) under **Domains**.
2. Add the DNS records Resend shows (an SPF `TXT` and DKIM `CNAME`/`TXT` records, plus the optional `MX` for bounces) at the DNS host, and wait until Resend marks the domain **Verified**. Adding a DMARC record (`_dmarc` `TXT`, e.g. `v=DMARC1; p=none;`) helps delivery.
3. Create an API key with **Sending access** only, and set it on Cloud Run as `RESEND_API_KEY` (a secret, never in the repo). Set `MAIL_FROM` if the sender differs from the default.
4. Check: sign up as a 13 to 17 year old with a test parent address; the server logs `guardian requested` with `sent: true`, and the letter arrives. A failed send logs `guardian letter not sent` with Resend's reason, and the app falls back to the share link.

## Teen mode (13 to 17) and parental consent
Explorers aged 13 to 17 get `ageBand: 'teen'` and `adultFrom` (first day of the month they turn 18) at sign-up; adults get `ageBand: 'adult'`; profiles without `ageBand` are adults. The server (`server/guardian.js`) handles the parent's link: `guardian_requests/{sha256(token)}`, `guardian_consents/{teenUid}` (the consent record, with history) and `deletion_requests/{teenUid}`; all three are server-only in the rules.
- **Before approval:** publishing is journal-only (`/api/publish` forces private; `/api/posts/:id/visibility` refuses), no letters (rules), not shown in search or explorer lists.
- **After approval:** sharing allowed but `showLocation` is always false and `locationArea` empty (server and rules); letters only between mutual follows (rules on `conversations` and `messages`); no ads tag, no consent banner, no product analytics (`services/guardian.ts` → `setTeenMode`); left out of search for non-followers.
- **Parent asks to delete the child's account:** there is no server-side account removal yet, so `/api/guardian/delete` disables sign-in, ends sessions, makes the sightings private and writes `deletion_requests/{teenUid}` (`status: 'open'`). **The admin must finish the deletion within 30 days** (the privacy policy promises this): sign in as admin, remove the explorer's posts, comments, media folders (`snapshots/`, `videos/`, `audio/`, `avatars/`, `drafts/` under the uid), the `users/{uid}` document and its subcollections, delete the Auth user, then set the request's `status: 'done'`. Keep `guardian_consents/{uid}` as the record of consent and withdrawal.
- The legal paragraphs on this are marked `<!-- reviewed-by-counsel: pending -->` in `public/privacy.html` and `public/terms.html`.

## Feature flags
`config/flags` (public read, admin write) is edited in Admin → Experiments. A missing document or flag means off. Exposure events are `experiment_exposure { flag, variant, on }` (only for explorers who allow analytics).

## Native icons and splash
`node scripts/generate-native-assets.mjs` regenerates every iOS and Android icon and splash image from `public/icon.svg` (uses Playwright's Chromium; set `PW_CHROMIUM_PATH` if needed), then `npx cap sync`.

## Account letters: email verification and password reset
NatureGram sends its own branded letters for email verification and password resets, and handles every Firebase email link on its own page, `https://thenaturegram.com/auth/action` (`components/AuthAction.tsx`). The server (`server/authMail.js`) generates the link with the Admin SDK, rebuilds it on our origin (`/auth/action?mode=…&oobCode=…&continueUrl=…`) and sends it through Resend (`server/mailer.js`). When it can't (no mail provider, or the server account lacks the role below) it answers `{ sent: false, fallback: true }` and the app asks Firebase to send its own email instead, so sign-up and resets always work.

| Endpoint | Body | Limits | Notes |
|---|---|---|---|
| `POST /api/auth/send-verification` | `Authorization: Bearer <ID token>` | 3 an hour per explorer, 6 per network | Signed-in, unverified accounts only. Continue URL `/welcome`. |
| `POST /api/auth/send-reset` | `{ "email": "…" }` | 3 an hour per address (silently), 8 per network | Always answers the same way, known address or not, and takes at least 1.2 s, so it can't be used to find accounts. |

Logs record outcomes (`auth mail: …`) with the uid or a hash of the address; never links, codes, tokens or addresses.

### Server variables
| Variable | Default | What it does |
|---|---|---|
| `RESEND_API_KEY` | unset | Turns on NatureGram's own letters. Unset means Firebase's built-in emails (still linking to our page once the action URL below is set). |
| `MAIL_FROM` | `NatureGram <field@thenaturegram.com>` | Sender. The domain must be verified in Resend. |
| `MAIL_REPLY_TO` | unset | Optional reply-to address. |
| `PUBLIC_ORIGIN` | `https://thenaturegram.com` | Origin used for links in letters. |

### One-time setup for the owner
1. **Let the server make action links.** Generating links needs the Firebase Authentication Admin role on the Cloud Run runtime account:
   ```sh
   gcloud projects add-iam-policy-binding biostream-6490a \
     --member="serviceAccount:292328394577-compute@developer.gserviceaccount.com" \
     --role="roles/firebaseauth.admin"
   ```
   Until this is done the logs show `auth mail: … link failed, falling back` and Firebase's own email goes out instead.
2. **Point every Firebase email at our page.** Firebase console → Authentication → Templates → open any template (pencil icon) → **Customize action URL** (at the bottom of the editor) → `https://thenaturegram.com/auth/action` → Save. This applies to all templates, so even Firebase's own emails (the fallback, email change, and "recover email") land on NatureGram's page instead of `biostream-6490a.firebaseapp.com/__/auth/action`. The old firebaseapp.com handler keeps working for links already sent.
3. **Authorized domains.** Authentication → Settings → Authorized domains: make sure `thenaturegram.com` and `www.thenaturegram.com` are listed (continue URLs such as `/welcome` must be on one of them).
4. **Sender name and reply-to.** Authentication → Templates → each template (Email address verification, Password reset, Email address change) → pencil → **Sender name** `NatureGram`; **Reply to** e.g. `field@thenaturegram.com`.
5. **Optional: send Firebase's emails from our domain.** Authentication → Templates → pencil → **Customize domain** → `thenaturegram.com`. Add the TXT and CNAME records Firebase shows at your DNS host, then click Verify (can take up to 48 hours). Firebase's emails then come from `noreply@thenaturegram.com` instead of `noreply@biostream-6490a.firebaseapp.com`.
6. **Template text in the house voice** (edit where the console allows; it locks some message bodies against spam, but subject, sender name and reply-to are always editable):
   - *Email address verification.* Subject: `Confirm your email and your field notebook is yours`. Message:
     > Hi %DISPLAY_NAME%,
     >
     > Your notebook, your life list and your letters from other explorers are ready. Confirm this is your email and they are yours to keep.
     >
     > %LINK%
     >
     > If you didn't sign up, you can ignore this letter. The link works once and expires in a few days.
     >
     > NatureGram, a field notebook for the living world
   - *Password reset.* Subject: `Your NatureGram password reset`. Message:
     > Someone, hopefully you, asked to reset the password for %EMAIL% on NatureGram.
     >
     > Choose a new one here and your sightings, life list and letters will be right where you left them: %LINK%
     >
     > If you didn't ask, you can ignore this letter. Your password stays as it is.
   - *Email address change.* Subject: `Your NatureGram email was changed`. Message:
     > The email on your NatureGram account was changed to %NEW_EMAIL%.
     >
     > If that wasn't you, this link puts %EMAIL% back and helps you secure your notebook: %LINK%
7. **Optional: turn on our own letters.** Create a Resend account, add and verify the domain `thenaturegram.com` (Resend → Domains → add the SPF/DKIM records it shows), create an API key with sending access, then set `RESEND_API_KEY` (as a Secret Manager secret) and, if you want a different sender, `MAIL_FROM` on the Cloud Run service. Deploy. Sign up with a test address and check the logs for `auth mail: verification sent`.
