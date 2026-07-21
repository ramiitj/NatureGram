
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore, initializeFirestore } from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";
import firebaseConfig from "./firebase-applet-config.json";

let app: FirebaseApp;
let db: Firestore;

const getActiveDatabaseId = (): string => {
  if (typeof window !== "undefined") {
    const override = localStorage.getItem("firestore_db_override");
    if (override !== null) {
      return override;
    }
  }
  return "(default)";
};

const activeDbId = getActiveDatabaseId();

if (!getApps().length) {
  app = initializeApp(firebaseConfig);
  db = activeDbId && activeDbId !== "(default)"
    ? initializeFirestore(app, { experimentalForceLongPolling: true }, activeDbId)
    : initializeFirestore(app, { experimentalForceLongPolling: true });
} else {
  app = getApps()[0];
  db = activeDbId && activeDbId !== "(default)"
    ? getFirestore(app, activeDbId)
    : getFirestore(app);
}

export const auth: Auth = getAuth(app);
export { db };
export const storage: FirebaseStorage = getStorage(app);
