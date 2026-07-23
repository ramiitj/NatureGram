/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import admin from 'firebase-admin';
import { verifyRequestToken } from '../lib/auth.js';

// Registers POST /api/send-push. The client (via FirebaseService.addNotification)
// calls this right after writing a Firestore notification doc, passing its
// id so the server can look up the actual title/body itself — the
// message content sent to a real device is never trusted from the
// client directly, only referenced by ID and read server-side via
// firebase-admin (which bypasses Firestore security rules, but that's
// fine: we're reading a doc the caller already had permission to create).
export function registerPushNotificationRoute(app, { projectId }) {
  app.post('/api/send-push', express.json({ limit: '10kb' }), async (req, res) => {
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    try {
      await verifyRequestToken(bearerToken, projectId);
    } catch (e) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { notificationId, recipientId } = req.body || {};
    if (typeof notificationId !== 'string' || typeof recipientId !== 'string' || !notificationId || !recipientId) {
      return res.status(400).json({ error: 'notificationId and recipientId are required' });
    }

    try {
      const db = admin.firestore();

      const notifSnap = await db.collection('users').doc(recipientId)
        .collection('notifications').doc(notificationId).get();
      if (!notifSnap.exists) {
        return res.status(404).json({ error: 'Notification not found' });
      }
      const notif = notifSnap.data();

      const userSnap = await db.collection('users').doc(recipientId).get();
      const tokens = (userSnap.exists && userSnap.data().fcmTokens) || [];
      if (!Array.isArray(tokens) || tokens.length === 0) {
        return res.json({ sent: 0 });
      }

      const response = await admin.messaging().sendEachForMulticast({
        notification: {
          title: 'NatureGram',
          body: notif.message || 'You have a new field alert.',
        },
        data: {
          postId: notif.postId || '',
          type: notif.type || '',
        },
        tokens,
      });

      // Prune tokens FCM says are no longer valid (app uninstalled, browser
      // data cleared, etc.) so they don't keep failing on every future send.
      const invalidTokens = [];
      response.responses.forEach((r, i) => {
        if (!r.success && (r.error?.code === 'messaging/invalid-registration-token' || r.error?.code === 'messaging/registration-token-not-registered')) {
          invalidTokens.push(tokens[i]);
        }
      });
      if (invalidTokens.length > 0) {
        await db.collection('users').doc(recipientId).update({
          fcmTokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens),
        });
      }

      res.json({ sent: response.successCount });
    } catch (e) {
      console.error('[Push] Failed to send:', e.message);
      res.status(500).json({ error: 'Failed to send push notification' });
    }
  });
}
