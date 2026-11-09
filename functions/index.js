/**
 * NatureGram Cloud Functions
 * - sendActivityPush: delivers a web/mobile push for every new in-app notification.
 * Deploy: firebase deploy --only functions   (requires the Blaze plan)
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

initializeApp();
const db = getFirestore();

const TITLES = { like: 'New like', comment: 'New comment', follow: 'New follower', mention: 'You were mentioned', reply: 'New reply' };

export const sendActivityPush = onDocumentCreated({ document: 'users/{uid}/notifications/{notifId}', region: 'asia-east1' }, async (event) => {
  const n = event.data?.data();
  if (!n) return;
  const { uid } = event.params;
  const pushDoc = await db.doc(`users/${uid}/private/push`).get();
  const tokens = (pushDoc.exists && pushDoc.data().tokens) || [];
  if (!tokens.length) return;

  const url = n.type === 'follow' && n.senderId ? `/profile?user=${n.senderId}` : (n.postId ? `/feed?p=${n.postId}` : '/feed');
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: TITLES[n.type] || 'NatureGram', body: String(n.message || '').slice(0, 180) },
    data: { url, tag: `ng-${n.type || 'activity'}` },
    webpush: { fcmOptions: { link: url } },
  });
  // Prune tokens that are no longer valid
  const stale = res.responses.map((r, i) => (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code || '') ? tokens[i] : null)).filter(Boolean);
  if (stale.length) await pushDoc.ref.update({ tokens: FieldValue.arrayRemove(...stale) });
});
