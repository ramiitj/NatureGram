#!/usr/bin/env node
/**
 * Makes exactly one account the NatureGram admin.
 *
 *   node scripts/set-admin.mjs --email ram@iitj.ac.in            (dry run: shows what would change)
 *   node scripts/set-admin.mjs --email ram@iitj.ac.in --apply
 *
 * Gives that account the `admin` custom claim, removes the claim from every other account,
 * and signs those other accounts out everywhere. Needs server credentials for the Firebase
 * project (Application Default Credentials, or FIREBASE_SERVICE_ACCOUNT as JSON); no app user
 * can run it. Then set ADMIN_UIDS on the server to the uid it prints.
 */
import admin from 'firebase-admin';
import { getAuth } from 'firebase-admin/auth';

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const email = (arg('--email') || '').toLowerCase();
const apply = process.argv.includes('--apply');
if (!email) { console.error('Usage: node scripts/set-admin.mjs --email <address> [--apply]'); process.exit(1); }

const sa = process.env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) : null;
admin.initializeApp(sa ? { credential: admin.credential.cert(sa), projectId: process.env.FIREBASE_PROJECT || 'biostream-6490a' } : { projectId: process.env.FIREBASE_PROJECT || 'biostream-6490a' });
const auth = getAuth();

const target = await auth.getUserByEmail(email);
if (!target.emailVerified) { console.error(`${email} has not verified its email address. Verify it first.`); process.exit(1); }

const others = [];
let token;
do {
  const page = await auth.listUsers(1000, token);
  for (const u of page.users) if (u.uid !== target.uid && u.customClaims?.admin === true) others.push(u);
  token = page.pageToken;
} while (token);

console.log(`Admin will be: ${target.email} (uid ${target.uid})`);
console.log(others.length ? `Admin removed from: ${others.map(u => u.email || u.uid).join(', ')}` : 'No other account holds admin.');
if (!apply) { console.log('\nDry run. Add --apply to make these changes.'); process.exit(0); }

await auth.setCustomUserClaims(target.uid, { ...(target.customClaims || {}), admin: true });
for (const u of others) {
  const { admin: _drop, ...rest } = u.customClaims || {};
  await auth.setCustomUserClaims(u.uid, rest);
  await auth.revokeRefreshTokens(u.uid);
}
console.log(`\nDone. Set ADMIN_UIDS=${target.uid} on the server, then sign out and back in to the admin console.`);
