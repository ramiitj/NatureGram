import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import { NATURALIST_THEMES } from "./constants/naturalists.ts";
import { readFileSync } from "fs";

const configParams = JSON.parse(readFileSync('./firebase-applet-config.json', 'utf8'));

const firebaseConfig = {
  apiKey: configParams.apiKey,
  authDomain: configParams.authDomain,
  projectId: configParams.projectId,
  storageBucket: configParams.storageBucket,
  messagingSenderId: configParams.messagingSenderId,
  appId: configParams.appId
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function main() {
    console.log("Starting LOCAL naturalist theme seeding into user's live Firestore...");
    try {
        await signInAnonymously(auth);
        console.log("Logged in anonymously.");
    } catch (e: any) {
        console.log("Login failed: " + e.message);
    }
    let successCount = 0;
    let failCount = 0;

    for (const theme of NATURALIST_THEMES) {
        try {
            const themeDocRef = doc(db, 'themes', theme.id);
            await setDoc(themeDocRef, {
                id: theme.id,
                naturalist: theme.naturalist,
                quote: theme.quote,
                locationName: theme.locationName,
                locationCaption: theme.locationCaption,
                imageUrl: theme.imageUrl,
                colors: theme.colors,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            
            console.log(`Successfully seeded theme: ${theme.id}`);
            successCount++;
        } catch (err: any) {
            console.error(`FAILED to seed theme ${theme.id}:`, err.message);
            failCount++;
        }
    }

    console.log(`\nSeeding completed. Successes: ${successCount}, Failures: ${failCount}`);
    if (failCount > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

main();
