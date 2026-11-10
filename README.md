# NatureGram

**The living field guide.** Point your camera at nature and a live AI naturalist tells you what you're seeing and why it behaves that way. Capture sightings, keep a private field journal and life list, and share discoveries with explorers worldwide.

Production: https://thenaturegram.com

## Features
- **Live Lens.** A real-time voice and vision guide built on the Gemini Live API. It can capture frames, zoom and switch cameras through tool calls, and keeps a transcript you can re-read.
- **Capture → review → share.** Photos, video, sound recordings and hybrid captures. You get an editable AI identification with a confidence level, plus your note, hashtags and who can see it ("Share with everyone" or "Only me").
- **Social.** Following and For-you feeds, marvels (including double-tap), field notes, keeping sightings, follows, field pages with a sighting grid and life list, letters, notifications, share links with rich previews.
- **Safety.** Report, block, a moderation queue, fungi safety warnings, and AI labelling on every identification.
- **Privacy.** Exact GPS is never public and image metadata is stripped. You can download your data and delete your account.
- **Naturalist of the fortnight.** Every ~15 days the palette, landing story and a community field challenge change to honour one of 24 naturalists.

## Architecture
| Layer | Tech |
|---|---|
| Web app | React 19, TypeScript, Vite, Tailwind (compiled), Motion |
| Server | Node / Express (`server/server.js`): static hosting, share previews, media proxy, authenticated Gemini proxy (HTTP + Live WebSocket) |
| AI governance | `server/aiGovernance.js`: model allowlist, Live model pinning, platform policy injected into every call, safety settings, per-user quotas |
| Data | Firebase Auth, Firestore (`firestore.rules`, `firestore.indexes.json`), Cloud Storage (`storage.rules`) |
| Hosting | Cloud Run (`Dockerfile`), PWA with service worker (`public/sw.js`) |

Key client modules:
- `services/firebaseService.ts`: data access, social graph, publishing, data export and account deletion
- `services/genAiService.ts`: media analysis
- `services/geminiLiveService.ts`: Live sessions
- `services/themeService.ts`: naturalist theming with automatic contrast correction
- `constants/naturalists.ts` and `constants/naturalistExtras.ts`: the 24 naturalist themes, their bios and challenges

## Running locally
```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY
npm run dev            # http://localhost:3000
```
Type-check: `npm run lint`. Production build: `npm run build && npm start`.

## Deploying
See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Indexes must be deployed before rules. Admin access requires a verified email.

## AI governance
See **[docs/AI_GOVERNANCE.md](docs/AI_GOVERNANCE.md)** for how NatureGram keeps AI output accurate, safe and accountable.
