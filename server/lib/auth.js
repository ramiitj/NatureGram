/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import https from 'https';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import admin from 'firebase-admin';

// Pure Node.js fallback for verifying Firebase ID tokens without relying on internal credentials/ADC project mismatches
let publicKeysCache = null;
let cacheExpiry = 0;

async function fetchPublicKeys() {
  const now = Date.now();
  if (publicKeysCache && now < cacheExpiry) {
    return publicKeysCache;
  }
  return new Promise((resolve, reject) => {
    https.get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          publicKeysCache = JSON.parse(data);
          const cacheControl = res.headers['cache-control'];
          let maxAge = 3600;
          if (cacheControl) {
             const match = cacheControl.match(/max-age=(\d+)/);
             if (match) maxAge = parseInt(match[1], 10);
          }
          cacheExpiry = Date.now() + maxAge * 1000;
          resolve(publicKeysCache);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function decodeBase64Url(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

async function verifyFirebaseTokenFallback(token, projectId) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerStr, payloadStr, signatureStr] = parts;
  const header = JSON.parse(decodeBase64Url(headerStr));
  const payload = JSON.parse(decodeBase64Url(payloadStr));

  if (header.alg !== 'RS256') {
    throw new Error('Invalid algorithm: expected RS256');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error(`Invalid issuer: got ${payload.iss}, expected https://securetoken.google.com/${projectId}`);
  }
  if (payload.aud !== projectId) {
    throw new Error(`Invalid audience: got ${payload.aud}, expected ${projectId}`);
  }
  if (payload.exp < now) {
    throw new Error(`Token expired. Exp: ${payload.exp}, current: ${now}`);
  }

  const publicKeys = await fetchPublicKeys();
  const cert = publicKeys[header.kid];
  if (!cert) {
    throw new Error(`Public key not found for kid: ${header.kid}`);
  }

  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(`${headerStr}.${payloadStr}`);

  const signatureBase64 = signatureStr.replace(/-/g, '+').replace(/_/g, '/');
  const signature = Buffer.from(signatureBase64, 'base64');

  const isValid = verify.verify(cert, signature);
  if (!isValid) {
    throw new Error('Signature verification failed');
  }

  return payload;
}

// Verifies a Firebase ID token via firebase-admin, falling back to the pure
// Node.js verifier above if admin credentials/ADC aren't usable in this
// environment. Returns the verified uid, or throws.
export async function verifyRequestToken(token, projectIdForFallback) {
  if (!token) {
    throw new Error('No token provided');
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken.uid;
  } catch (e) {
    const decodedFallback = await verifyFirebaseTokenFallback(token, projectIdForFallback);
    return decodedFallback.sub;
  }
}

// Reads firebase-applet-config.json (if present) to initialize Firebase
// Admin with the right project ID; falls back to default credentials
// otherwise. Returns the resolved project ID (or null).
export function initFirebaseAdmin(repoRoot) {
  let currentFirebaseProjectId = null;
  try {
    const firebaseConfigPath = path.join(repoRoot, 'firebase-applet-config.json');
    if (fs.existsSync(firebaseConfigPath)) {
      const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
      currentFirebaseProjectId = firebaseConfig.projectId;
      admin.initializeApp({ projectId: firebaseConfig.projectId });
      console.log('Firebase Admin initialized with project ID:', firebaseConfig.projectId);
    } else {
      admin.initializeApp();
      console.log('Firebase Admin initialized with default credentials');
    }
  } catch (e) {
    console.error("Failed to initialize Firebase Admin:", e);
  }
  return currentFirebaseProjectId;
}
