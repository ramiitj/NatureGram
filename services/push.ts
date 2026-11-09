/**
 * Push notifications.
 * - Web push via Firebase Cloud Messaging when VITE_FCM_VAPID_KEY is configured
 *   (tokens stored privately at users/{uid}/private/push; sent by functions/index.js).
 * - Fallback: system notifications while NatureGram is open in a background tab.
 */
import { doc, setDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { track } from './analytics';

const VAPID_KEY = (import.meta as any).env?.VITE_FCM_VAPID_KEY as string | undefined;
const PREF_KEY = 'naturegram_push_enabled';

export const pushSupported = () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
export const pushEnabled = () => {
  try { return pushSupported() && Notification.permission === 'granted' && localStorage.getItem(PREF_KEY) === '1'; } catch { return false; }
};

export const enablePush = async (): Promise<'granted' | 'denied' | 'unsupported'> => {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  track('push_permission', { result: perm });
  if (perm !== 'granted') return 'denied';
  try { localStorage.setItem(PREF_KEY, '1'); } catch { /* ignore */ }
  await registerToken().catch(e => console.warn('Push token registration failed', e));
  return 'granted';
};

export const disablePush = () => {
  try { localStorage.setItem(PREF_KEY, '0'); } catch { /* ignore */ }
};

/** Registers this device's FCM token (only when the VAPID key is configured). */
export const registerToken = async () => {
  const user = auth.currentUser;
  if (!VAPID_KEY || !user || user.isAnonymous || !pushEnabled()) return;
  const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
  if (!(await isSupported())) return;
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (token) {
    await setDoc(doc(db, 'users', user.uid, 'private', 'push'), { tokens: arrayUnion(token), updatedAt: serverTimestamp() }, { merge: true });
  }
};

/** Show a system notification while the tab is hidden (works without FCM). */
export const showLocalNotification = async (title: string, body: string, url = '/feed') => {
  if (!pushEnabled() || document.visibilityState === 'visible') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url }, tag: 'naturegram-activity' } as NotificationOptions);
    else new Notification(title, { body, icon: '/icon-192.png' });
  } catch { /* ignore */ }
};
