// W2: extracted from firebaseService.ts — sign-in/sign-up/sign-out and
// anonymous-account-linking. ensureUserProfile lives in profileService.ts
// but is called from here (loginAnonymous/registerUser/loginUser), hence
// the FirebaseService import — see firebaseService.ts's module doc for why
// that's a safe circular import in this codebase.
import {
  doc,
  updateDoc,
} from "firebase/firestore";
import {
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  deleteUser,
  updateProfile,
  linkWithCredential,
  EmailAuthProvider,
} from "firebase/auth";
import { auth, db } from "../../firebaseConfig";
import { FirebaseService } from "../firebaseService";

export const AuthService = {
  getCurrentUserId: () => {
    return auth.currentUser?.uid;
  },

  isCurrentUserAnonymous: () => {
    return auth.currentUser?.isAnonymous ?? true;
  },

  subscribeToAuthChanges: (callback: (user: any) => void) => {
    return onAuthStateChanged(auth, callback);
  },

  loginAnonymous: async () => {
    const cred = await signInAnonymously(auth);
    let locationData = "Unknown Location";
    try {
        const res = await fetch('https://ipapi.co/json/');
        if (res.ok) {
            const data = await res.json();
            if (data && data.city) {
                locationData = `${data.city}, ${data.region}, ${data.country_name}`;
            }
        }
    } catch(e) {
        console.warn("Could not fetch geolocation.", e);
    }
    try {
        await FirebaseService.ensureUserProfile(cred.user.uid, "Anonymous", true, locationData);
    } catch (err) {
        console.warn("Silent profile creation error caught during loginAnonymous:", err);
    }
    return cred;
  },

  // Upgrades the current anonymous account in place (same uid) when
  // possible, instead of always creating a brand-new account — signing up
  // via createUserWithEmailAndPassword directly would sign out the
  // anonymous user and mint a new uid, silently orphaning any drafts,
  // journal entries, or profile data already saved under the old one.
  registerUser: async (email: string, pass: string) => {
    const currentUser = auth.currentUser;
    if (currentUser && currentUser.isAnonymous) {
        try {
            const credential = EmailAuthProvider.credential(email, pass);
            const cred = await linkWithCredential(currentUser, credential);
            const username = email.split('@')[0];
            try {
                await updateDoc(doc(db, "users", cred.user.uid), { isAnonymous: false, username });
                if (!cred.user.displayName) await updateProfile(cred.user, { displayName: username });
            } catch (profileErr) {
                console.warn("Failed to upgrade profile after account linking:", profileErr);
            }
            return cred;
        } catch (err: any) {
            // The email is already registered to a different account (or
            // linking otherwise can't proceed) — fall through to a normal
            // signup. The user just won't keep their anonymous history in
            // that specific case, same as before this feature existed.
            if (err?.code !== 'auth/email-already-in-use' && err?.code !== 'auth/credential-already-in-use') {
                throw err;
            }
            console.warn("Anonymous account linking failed, falling back to fresh signup:", err);
        }
    }

    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    try {
        await FirebaseService.ensureUserProfile(cred.user.uid, email, false);
    } catch (err) {
        console.warn("Silent profile creation error caught during registerUser:", err);
    }
    return cred;
  },

  loginUser: async (email: string, pass: string) => {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    try {
        await FirebaseService.ensureUserProfile(cred.user.uid, email, false);
    } catch (err) {
        console.warn("Silent profile creation error caught during loginUser:", err);
    }
    return cred;
  },

  logout: async () => {
    return await signOut(auth);
  },

  deleteUserAccount: async () => {
    const user = auth.currentUser;
    if (user) {
      return await deleteUser(user);
    }
    throw new Error("No user is currently signed in to delete.");
  },
};
