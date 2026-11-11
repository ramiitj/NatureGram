// Private reports, teens who wait for a parent, and push notification switches.
// Run with the Firestore emulator (see README.md): node tests/rules/safety.rules.test.mjs
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, getDoc, updateDoc, writeBatch, increment, arrayUnion, serverTimestamp, Timestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-ng4', firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: Number(process.env.FIRESTORE_PORT || 8080) } });
const member = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'password' } }).firestore();
const guest = env.authenticatedContext('g1', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const admin = env.authenticatedContext('adm', { admin: true, email: 'ram@iitj.ac.in', email_verified: true, firebase: { sign_in_provider: 'password' } }).firestore();
const FUTURE = Timestamp.fromMillis(Date.now() + 365 * 86_400_000);

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/alice'), { uid: 'alice', username: 'alice' });
  await setDoc(doc(db, 'users/bob'), { uid: 'bob', username: 'bob' });
  await setDoc(doc(db, 'users/carol'), { uid: 'carol', username: 'carol' });
  await setDoc(doc(db, 'users/tina'), { uid: 'tina', username: 'tina', ageBand: 'teen', adultFrom: FUTURE, guardian: { status: 'pending' } });
  await setDoc(doc(db, 'users/umar'), { uid: 'umar', username: 'umar', ageBand: 'teen', adultFrom: FUTURE, guardian: { status: 'approved', parentUid: 'alice' } });
  await setDoc(doc(db, 'ecosystem_feed/p1'), { userId: 'alice', isPublic: true, caption: 'x', likes: [], likeCount: 0, commentCount: 0, reportStatus: 'safe', reportCount: 0 });
  await setDoc(doc(db, 'ecosystem_feed/p2'), { userId: 'alice', isPublic: true, caption: 'x', likes: [], likeCount: 0, commentCount: 0, reportStatus: 'safe', reports: ['old-reporter'] });
  await setDoc(doc(db, 'ecosystem_feed/p1/comments/c1'), { userId: 'alice', userName: 'alice', text: 'Look at the tail' });
  // tina and bob follow each other (letters still wait for tina's parent)
  for (const [x, y] of [['tina', 'bob'], ['bob', 'tina']]) {
    await setDoc(doc(db, `users/${x}/following/${y}`), { at: 1 });
    await setDoc(doc(db, `users/${y}/followers/${x}`), { at: 1 });
  }
  await setDoc(doc(db, 'conversations/bob_tina'), { participants: ['bob', 'tina'] });
});

const results = [];
const t = async (name, p) => { try { await p; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, String(e.message).slice(0, 160)]); } };
const bob = member('bob'), carol = member('carol'), alice = member('alice'), tina = member('tina'), umar = member('umar');

const report = (db, uid, postId, reason = 'spam', postPatch = { reportStatus: 'pending', reportCount: increment(1) }) => {
  const b = writeBatch(db);
  b.set(doc(db, `ecosystem_feed/${postId}/reports/${uid}`), { reason, details: '', createdAt: serverTimestamp() });
  b.update(doc(db, `ecosystem_feed/${postId}`), postPatch);
  return b.commit();
};

// ------------------------------------------------------------ post reports
await t('member reports a post (private report + counter)', assertSucceeds(report(bob, 'bob', 'p1')));
await t('X the same member reports again', assertFails(report(bob, 'bob', 'p1')));
await t('X reporter uid added to a public array', assertFails(report(carol, 'carol', 'p1', 'spam', { reportStatus: 'pending', reportCount: increment(1), reports: arrayUnion('carol') })));
await t('X counter moves without a report document', assertFails(updateDoc(doc(carol, 'ecosystem_feed/p1'), { reportStatus: 'pending', reportCount: increment(1) })));
await t('X report document without the counter', assertFails(setDoc(doc(carol, 'ecosystem_feed/p1/reports/carol'), { reason: 'spam', createdAt: serverTimestamp() })));
await t('X counter jumps by two', assertFails(report(carol, 'carol', 'p1', 'spam', { reportStatus: 'pending', reportCount: increment(2) })));
await t('X report that marks the post safe', assertFails(report(carol, 'carol', 'p1', 'spam', { reportStatus: 'safe', reportCount: increment(1) })));
await t('X report on behalf of someone else', assertFails(report(carol, 'alice', 'p1')));
await t('X guest reports', assertFails(report(guest, 'g1', 'p1')));
await t('a second member reports (count goes to 2)', assertSucceeds(report(carol, 'carol', 'p1')));
await t('reporter checks their own report', assertSucceeds(getDoc(doc(bob, 'ecosystem_feed/p1/reports/bob'))));
await t('member checks a report they have not made (absent)', assertSucceeds(getDoc(doc(member('dave'), 'ecosystem_feed/p1/reports/dave'))));
await t('X post author reads who reported', assertFails(getDoc(doc(alice, 'ecosystem_feed/p1/reports/bob'))));
await t('X another member reads who reported', assertFails(getDoc(doc(carol, 'ecosystem_feed/p1/reports/bob'))));
await t('admin reads reports', assertSucceeds(getDoc(doc(admin, 'ecosystem_feed/p1/reports/bob'))));
await t('report on an older post that still has a reports array', assertSucceeds(report(bob, 'bob', 'p2')));

// ------------------------------------------------------------ comment and profile reports
const cr = (uid, extra = {}) => ({ kind: 'comment', postId: 'p1', commentId: 'c1', reportedUid: 'alice', reporterId: uid, reason: 'rude', details: '', status: 'open', createdAt: serverTimestamp(), ...extra });
const pr = (uid, target, extra = {}) => ({ kind: 'profile', reportedUid: target, reporterId: uid, reason: 'impersonation', details: '', status: 'open', createdAt: serverTimestamp(), ...extra });
await t('member reports a field note', assertSucceeds(setDoc(doc(bob, 'content_reports/c_p1_c1_bob'), cr('bob'))));
await t('X the same field note reported twice', assertFails(setDoc(doc(bob, 'content_reports/c_p1_c1_bob'), cr('bob'))));
await t('X comment report filed under someone else\'s id', assertFails(setDoc(doc(bob, 'content_reports/c_p1_c1_carol'), cr('bob'))));
await t('X comment report for a note that does not exist', assertFails(setDoc(doc(bob, 'content_reports/c_p1_nope_bob'), cr('bob', { commentId: 'nope' }))));
await t('X comment report with a forged reporter', assertFails(setDoc(doc(bob, 'content_reports/c_p1_c1_carol'), cr('carol'))));
await t('member reports a profile', assertSucceeds(setDoc(doc(bob, 'content_reports/u_alice_bob'), pr('bob', 'alice'))));
await t('X member reports their own profile', assertFails(setDoc(doc(bob, 'content_reports/u_bob_bob'), pr('bob', 'bob'))));
await t('X profile report with extra fields', assertFails(setDoc(doc(carol, 'content_reports/u_alice_carol'), pr('carol', 'alice', { ip: '1.2.3.4' }))));
await t('X guest files a profile report', assertFails(setDoc(doc(guest, 'content_reports/u_alice_g1'), pr('g1', 'alice'))));
await t('reporter checks their own content report', assertSucceeds(getDoc(doc(bob, 'content_reports/u_alice_bob'))));
await t('reporter checks a report they have not made yet', assertSucceeds(getDoc(doc(carol, 'content_reports/u_alice_carol'))));
await t('X reported explorer reads who reported them', assertFails(getDoc(doc(alice, 'content_reports/u_alice_bob'))));
await t('X someone else reads a content report', assertFails(getDoc(doc(carol, 'content_reports/c_p1_c1_bob'))));
await t('X reporter edits their report', assertFails(updateDoc(doc(bob, 'content_reports/u_alice_bob'), { status: 'closed' })));

// ------------------------------------------------------------ teens wait for a parent before writing in public
const note = (uid) => ({ userId: uid, userName: uid, text: 'A kingfisher!', timestamp: serverTimestamp() });
const idOf = (uid) => ({ name: 'Kingfisher', userName: uid, agree: false, createdAt: serverTimestamp() });
await t('X waiting teen writes a field note', assertFails(setDoc(doc(tina, 'ecosystem_feed/p1/comments/t1'), note('tina'))));
await t('X waiting teen adds an identification', assertFails(setDoc(doc(tina, 'ecosystem_feed/p1/identifications/tina'), idOf('tina'))));
await t('X waiting teen writes a letter', assertFails(setDoc(doc(tina, 'conversations/bob_tina/messages/m1'), { senderId: 'tina', text: 'hi', createdAt: serverTimestamp() })));
await t('approved teen writes a field note', assertSucceeds(setDoc(doc(umar, 'ecosystem_feed/p1/comments/u1'), note('umar'))));
await t('approved teen adds an identification', assertSucceeds(setDoc(doc(umar, 'ecosystem_feed/p1/identifications/umar'), idOf('umar'))));
await t('adult writes a field note', assertSucceeds(setDoc(doc(bob, 'ecosystem_feed/p1/comments/b1'), note('bob'))));
await t('identification may carry its author\'s uid', assertSucceeds(setDoc(doc(bob, 'ecosystem_feed/p1/identifications/bob'), { ...idOf('bob'), userId: 'bob' })));
await t('X identification carrying someone else\'s uid', assertFails(setDoc(doc(carol, 'ecosystem_feed/p1/identifications/carol'), { ...idOf('carol'), userId: 'bob' })));

// ------------------------------------------------------------ push notification switches
await t('member turns marvel pushes on', assertSucceeds(updateDoc(doc(bob, 'users/bob'), { notifyPrefs: { marvels: true, notes: true, follows: false, identifications: true, letters: true, quietHours: false } })));
await t('X unknown switch', assertFails(updateDoc(doc(bob, 'users/bob'), { notifyPrefs: { marvels: true, everything: true } })));
await t('X switch that is not on or off', assertFails(updateDoc(doc(bob, 'users/bob'), { notifyPrefs: { marvels: 'yes' } })));
await t('X switches that are not a map', assertFails(updateDoc(doc(bob, 'users/bob'), { notifyPrefs: 'all' })));
await t('X someone else changes my switches', assertFails(updateDoc(doc(carol, 'users/bob'), { notifyPrefs: { marvels: false } })));
await t('teen changes switches keeping quiet hours', assertSucceeds(updateDoc(doc(umar, 'users/umar'), { notifyPrefs: { marvels: true, quietHours: true } })));
await t('X teen turns quiet hours off', assertFails(updateDoc(doc(umar, 'users/umar'), { notifyPrefs: { quietHours: false } })));

for (const r of results) console.log(r.join(' | '));
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`${results.length - failed}/${results.length} passed`);
await env.cleanup();
process.exit(failed ? 1 : 0);
