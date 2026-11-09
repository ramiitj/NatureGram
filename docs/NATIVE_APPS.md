# NatureGram iOS & Android apps (Capacitor)

The native apps wrap the same web app (`dist/`) in Capacitor shells: `ios/` and `android/`. Inside the apps, API, AI and WebSocket calls go to `https://thenaturegram.com` (override with `VITE_API_ORIGIN` at build time). The server already accepts the `capacitor://localhost` and `https://localhost` origins.

## Build
```bash
npm run build:native      # vite build + copy web assets into both native projects
npm run open:ios          # Xcode (macOS): set Team, bump version, Product → Archive
npm run open:android      # Android Studio: Build → Generate Signed Bundle (AAB)
```

## Before submitting
- **App icons and splash:** `npx @capacitor/assets generate --iconBackgroundColor '#1f3d2b' --splashBackgroundColor '#1c1917'`, using `public/icon-512.png` as `assets/icon.png`.
- **Permissions:** already configured. iOS `Info.plist` has the camera, microphone, location and photo library usage strings. The Android manifest has the camera, microphone, location and notifications permissions.
- **Push (optional):** add `GoogleService-Info.plist` (iOS) and `google-services.json` (Android) from the Firebase console, then add `@capacitor/push-notifications`.
- **Store listings:**
  - Link the privacy policy at `https://thenaturegram.com/privacy.html`.
  - Account deletion is in-app (Settings → Delete account), which Apple requires.
  - Fill in the data-safety form from `public/privacy.html`.
- **App Store review notes:** explain the live AI guide (camera and microphone) and that AI identifications are labelled as suggestions.
