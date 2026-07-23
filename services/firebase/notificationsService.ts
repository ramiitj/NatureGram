// W2: extracted from firebaseService.ts — in-app field-alert notifications
// and web-push opt-in/opt-out.
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { getToken, onMessage, isSupported as isMessagingSupported, MessagePayload } from "firebase/messaging";
import { auth, db, getMessagingInstance } from "../../firebaseConfig";
import { FieldNotification } from "../../types";
import { handleFirestoreError, OperationType } from "./shared";

export const NotificationsService = {
  addNotification: async (recipientId: string, data: Partial<FieldNotification>) => {
    const notifsRef = collection(db, "users", recipientId, "notifications");
    const docRef = await addDoc(notifsRef, {
      ...data,
      timestamp: serverTimestamp(),
      isRead: false
    });

    // Best-effort push dispatch: tells the server (which holds the
    // recipient's FCM tokens and the firebase-admin credentials needed to
    // actually send) about the notification we just wrote. Deliberately
    // never lets a failure here fail addNotification itself — the in-app
    // notification already succeeded above regardless of whether a push
    // goes out.
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (idToken) {
        fetch('/api/send-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          body: JSON.stringify({ notificationId: docRef.id, recipientId }),
        }).catch(() => {});
      }
    } catch (e) {
      // Swallow — see comment above.
    }
  },

  subscribeToNotifications: (userId: string, callback: (notifs: FieldNotification[]) => void, onError?: (error: unknown) => void) => {
    const q = query(collection(db, "users", userId, "notifications"), orderBy("timestamp", "desc"), limit(20));
    return onSnapshot(q, (snapshot) => {
      const notifs: FieldNotification[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        notifs.push({ id: doc.id, ...data } as FieldNotification);
      });
      callback(notifs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${userId}/notifications`);
      onError?.(error);
    });
  },

  markNotificationRead: async (userId: string, notifId: string) => {
    await updateDoc(doc(db, "users", userId, "notifications", notifId), { isRead: true });
  },

  // Requests browser notification permission and registers this
  // device/browser for push. Returns true only on a fully successful
  // opt-in (permission granted + token obtained + stored). The service
  // worker is registered here — not at app boot — so its cache-first
  // fetch behavior only becomes active for users who explicitly opt into
  // push, not silently for everyone.
  requestPushPermission: async (userId: string): Promise<boolean> => {
    try {
      if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) {
        return false;
      }
      if (!(await isMessagingSupported())) return false;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;

      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      if (!vapidKey) {
        console.warn('VITE_FIREBASE_VAPID_KEY not set; cannot register for push notifications.');
        return false;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const token = await getToken(getMessagingInstance(), { vapidKey, serviceWorkerRegistration: registration });
      if (!token) return false;

      await updateDoc(doc(db, "users", userId), { fcmTokens: arrayUnion(token) });

      // Foreground messages (app already open/focused) don't trigger the
      // service worker's background push handler, so show them directly.
      onMessage(getMessagingInstance(), (payload: MessagePayload) => {
        if (Notification.permission === 'granted') {
          new Notification(payload.notification?.title || 'NatureGram', {
            body: payload.notification?.body || '',
          });
        }
      });

      return true;
    } catch (e) {
      console.warn('Failed to enable push notifications:', e);
      return false;
    }
  },

  // Best-effort: stops this device's token from receiving future pushes.
  // Cannot revoke already-granted browser Notification permission (no API
  // for that), only removes it from the recipient list server-side.
  disablePushNotifications: async (userId: string): Promise<void> => {
    try {
      if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
      if (!(await isMessagingSupported())) return;
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return;
      const token = await getToken(getMessagingInstance(), { serviceWorkerRegistration: registration }).catch(() => null);
      if (token) {
        await updateDoc(doc(db, "users", userId), { fcmTokens: arrayRemove(token) });
      }
    } catch (e) {
      console.warn('Failed to disable push notifications:', e);
    }
  },
};
