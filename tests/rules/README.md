# Security rules tests

Runs the Firestore and Storage rules in the Firebase emulator (needs Java).

```
npm i -D firebase-tools @firebase/rules-unit-testing@5 firebase@12
npx firebase emulators:exec --only firestore,storage --project demo-ng \
  "node tests/rules/rules.test.mjs && node tests/rules/roadmap.rules.test.mjs && node tests/rules/teen.rules.test.mjs && node tests/rules/safety.rules.test.mjs"
```
Emulator ports: Firestore 8080, Storage 9199 (see firebase.json "emulators").

- `rules.test.mjs`: posts, feed entries, letters, server-only records, stats, Storage uploads
- `roadmap.rules.test.mjs`: mute, feature flags, identifications and thanks, search keys, admin jobs
- `teen.rules.test.mjs`: teen mode profiles, letters and hidden places
- `safety.rules.test.mjs`: private reports (posts, field notes, profiles), teens waiting for a parent, push notification switches
