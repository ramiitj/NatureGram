import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-ng2', firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: Number(process.env.FIRESTORE_PORT || 8080) } });
const member = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'password' } }).firestore();
const guest = env.unauthenticatedContext().firestore();
const admin = env.authenticatedContext('adm', { admin: true, email: 'ram@iitj.ac.in', email_verified: true, firebase: { sign_in_provider: 'password' } }).firestore();

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'ecosystem_feed/p1'), { userId: 'alice', isPublic: true, labels: ['Fox'], caption: 'x', likes: [], likeCount: 0, commentCount: 0, timestamp: new Date() });
  await setDoc(doc(db, 'feed_thumbnails/p1'), { id: 'p1', userId: 'alice', isPublic: true, labels: ['Fox'], timestamp: new Date() });
  await setDoc(doc(db, 'ecosystem_feed/p1/identifications/bob'), { name: 'Fox', agree: true, userName: 'bob', createdAt: new Date() });
  await setDoc(doc(db, 'users/alice'), { uid: 'alice', username: 'alice' });
  await setDoc(doc(db, 'users/bob'), { uid: 'bob', username: 'bob' });
  await setDoc(doc(db, 'config/flags'), { flags: { new_explore: { enabled: true, rollout: 50 } } });
  await setDoc(doc(db, 'live_leases/l1'), { uid: 'bob' });
});

const results = [];
const t = async (name, p) => { try { await p; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, String(e.message).slice(0, 160)]); } };
const alice = member('alice'), bob = member('bob'), carol = member('carol');

// Mute: owner only
await t('mute an explorer', assertSucceeds(setDoc(doc(bob, 'users/bob/muted/alice'), { createdAt: serverTimestamp() })));
await t('read own muted list', assertSucceeds(getDocs(collection(bob, 'users/bob/muted'))));
await t('unmute', assertSucceeds(deleteDoc(doc(bob, 'users/bob/muted/alice'))));
await t('X read someone else\'s muted list', assertFails(getDocs(collection(alice, 'users/bob/muted'))));
await t('X mute on someone else\'s behalf', assertFails(setDoc(doc(alice, 'users/bob/muted/carol'), { createdAt: serverTimestamp() })));
await t('X mute yourself', assertFails(setDoc(doc(bob, 'users/bob/muted/bob'), { createdAt: serverTimestamp() })));
await t('X extra fields on mute', assertFails(setDoc(doc(bob, 'users/bob/muted/carol'), { createdAt: serverTimestamp(), note: 'x' })));

// Feature flags: public read, admin write
await t('guest reads flags', assertSucceeds(getDoc(doc(guest, 'config/flags'))));
await t('admin writes flags', assertSucceeds(setDoc(doc(admin, 'config/flags'), { flags: {} })));
await t('X member writes flags', assertFails(setDoc(doc(bob, 'config/flags'), { flags: { x: { enabled: true, rollout: 100 } } })));
await t('X guest writes flags', assertFails(setDoc(doc(guest, 'config/flags'), { flags: {} })));

// Server-only leases
await t('X member reads leases', assertFails(getDoc(doc(bob, 'live_leases/l1'))));
await t('X member writes lease', assertFails(setDoc(doc(bob, 'live_leases/l2'), { uid: 'bob' })));

// Thanks on identifications
await t('X identifier thanks themselves', assertFails(updateDoc(doc(bob, 'ecosystem_feed/p1/identifications/bob'), { thanked: true, thankedAt: serverTimestamp() })));
await t('X stranger thanks', assertFails(updateDoc(doc(carol, 'ecosystem_feed/p1/identifications/bob'), { thanked: true, thankedAt: serverTimestamp() })));
await t('post author thanks identifier', assertSucceeds(updateDoc(doc(alice, 'ecosystem_feed/p1/identifications/bob'), { thanked: true, thankedAt: serverTimestamp() })));
await t('X author changes the ID itself', assertFails(updateDoc(doc(alice, 'ecosystem_feed/p1/identifications/bob'), { name: 'Wolf' })));
await t('X author un-thanks to false', assertFails(updateDoc(doc(alice, 'ecosystem_feed/p1/identifications/bob'), { thanked: false })));
await t('identifier re-saves (merge) keeping thanks', assertSucceeds(setDoc(doc(bob, 'ecosystem_feed/p1/identifications/bob'), { name: 'Red fox', scientificName: '', note: '', userName: 'bob', agree: false, createdAt: serverTimestamp() }, { merge: true })));
await t('X identifier drops thanks by overwrite', assertFails(setDoc(doc(bob, 'ecosystem_feed/p1/identifications/bob'), { name: 'Red fox', userName: 'bob', agree: false, createdAt: serverTimestamp() })));
await t('new ID by carol', assertSucceeds(setDoc(doc(carol, 'ecosystem_feed/p1/identifications/carol'), { name: 'Fox', userName: 'carol', agree: true, createdAt: serverTimestamp() })));
await t('X new ID arrives pre-thanked', assertFails(setDoc(doc(member('dave'), 'ecosystem_feed/p1/identifications/dave'), { name: 'Fox', userName: 'dave', agree: true, thanked: true, createdAt: serverTimestamp() })));

// Search keys, observation date on author edits
await t('author updates searchTokens', assertSucceeds(updateDoc(doc(alice, 'ecosystem_feed/p1'), { caption: 'Red fox', searchTokens: ['re', 'red', 'fo', 'fox'] })));
await t('author mirrors searchTokens on thumbnail', assertSucceeds(updateDoc(doc(alice, 'feed_thumbnails/p1'), { searchTokens: ['re', 'red'] })));
await t('X too many searchTokens', assertFails(updateDoc(doc(alice, 'ecosystem_feed/p1'), { searchTokens: Array.from({ length: 101 }, (_, i) => `t${i}`) })));
await t('X stranger sets searchTokens', assertFails(updateDoc(doc(bob, 'ecosystem_feed/p1'), { searchTokens: ['spam'] })));
await t('author corrects observedAt', assertSucceeds(updateDoc(doc(alice, 'ecosystem_feed/p1'), { observedAt: Timestamp.fromMillis(Date.UTC(2026, 0, 2)) })));
await t('X observedAt not a timestamp', assertFails(updateDoc(doc(alice, 'ecosystem_feed/p1'), { observedAt: 'yesterday' })));

// Age confirmation on the profile
await t('owner records age confirmation', assertSucceeds(updateDoc(doc(alice, 'users/alice'), { ageConfirmed: true, ageConfirmedAt: serverTimestamp() })));
await t('X age confirmation set to false', assertFails(updateDoc(doc(bob, 'users/bob'), { ageConfirmed: false })));

// Comments: clients cannot create hidden or pre-moderated notes, nor unhide their own
await t('X client creates a hidden comment', assertFails(setDoc(doc(bob, 'ecosystem_feed/p1/comments/c9'), { userId: 'bob', userName: 'bob', text: 'hi', timestamp: serverTimestamp(), hidden: false })));
await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'ecosystem_feed/p1/comments/c8'), { userId: 'bob', userName: 'bob', text: 'bad', hidden: true }); });
await t('X author of a hidden comment unhides it', assertFails(updateDoc(doc(bob, 'ecosystem_feed/p1/comments/c8'), { hidden: false })));

// Admin jobs: only an admin starts or watches them, and only known kinds
await t('admin starts the poster job', assertSucceeds(setDoc(doc(admin, 'admin_jobs/posters'), { kind: 'posters', status: 'requested', tick: 0, next: null, totals: {} })));
await t('admin watches the poster job', assertSucceeds(getDoc(doc(admin, 'admin_jobs/posters'))));
await t('X member starts a job', assertFails(setDoc(doc(bob, 'admin_jobs/posters'), { kind: 'posters', status: 'requested', tick: 0 })));
await t('X member reads a job', assertFails(getDoc(doc(bob, 'admin_jobs/posters'))));
await t('X admin marks a job done by hand', assertFails(setDoc(doc(admin, 'admin_jobs/posters'), { kind: 'posters', status: 'done' })));
await t('X unknown job kind', assertFails(setDoc(doc(admin, 'admin_jobs/wipe'), { kind: 'wipe', status: 'requested' })));

for (const r of results) console.log(r.join(' | '));
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`${results.length - failed}/${results.length} passed`);
await env.cleanup();
process.exit(failed ? 1 : 0);
