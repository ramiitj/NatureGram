import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { Firestore, initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, setLogLevel } from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";
import firebaseConfig from "./firebase-applet-config.json";

let app: FirebaseApp;
let db: Firestore;

if (!getApps().length) {
  app = initializeApp(firebaseConfig);
  try {
    // Offline-first cache: feed and profile reads survive flaky field connectivity.
    // Long polling is auto-detected only where WebChannel is blocked (corporate proxies, some webviews).
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  }
} else {
  app = getApps()[0];
  db = getFirestore(app);
}

// Dropped live-update streams ("WebChannelConnection … transport errored") reconnect by themselves;
// log only real errors so previews and sleeping tabs don't fill the console with warnings.
try { setLogLevel('error'); } catch { /* ignore */ }

// Clean up the retired debug override so every client uses the default database.
try { localStorage.removeItem("firestore_db_override"); } catch { /* storage unavailable */ }

export const auth: Auth = getAuth(app);
export { db, app };
export const storage: FirebaseStorage = getStorage(app);
