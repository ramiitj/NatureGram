# Security rules tests

Runs the Firestore and Storage rules in the Firebase emulator (needs Java).

```
npm i -D firebase-tools @firebase/rules-unit-testing firebase@10
npx firebase emulators:exec --only firestore,storage --project demo-ng "node tests/rules/rules.test.mjs"
```
Emulator ports: Firestore 8080, Storage 9199 (see firebase.json "emulators").
