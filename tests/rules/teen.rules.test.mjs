// Teen mode with a parent's consent: profile fields, server-only records, letters, hidden places.
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, getDoc, updateDoc, deleteField, serverTimestamp, Timestamp, arrayUnion } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-ng3', firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: Number(process.env.FIRESTORE_PORT || 8080) } });
const member = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'password' } }).firestore();

const FUTURE = Timestamp.fromMillis(Date.now() + 365 * 86_400_000);
const PAST = Timestamp.fromMillis(Date.now() - 86_400_000);

// a-adult (adult), b-legacy (no band), t-pending (teen, waiting), u-approved (teen, approved), v-old (teen whose 18th has come)
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/a-adult'), { uid: 'a-adult', username: 'ada', ageBand: 'adult' });
  await setDoc(doc(db, 'users/b-legacy'), { uid: 'b-legacy', username: 'bo' });
  await setDoc(doc(db, 'users/t-pending'), { uid: 't-pending', username: 'tia', ageBand: 'teen', adultFrom: FUTURE, guardian: { status: 'pending', emailHash: 'x' } });
  await setDoc(doc(db, 'users/u-approved'), { uid: 'u-approved', username: 'uma', ageBand: 'teen', adultFrom: FUTURE, guardian: { status: 'approved', parentUid: 'a-adult' } });
  await setDoc(doc(db, 'users/s-pending'), { uid: 's-pending', username: 'sam', ageBand: 'teen', adultFrom: FUTURE, guardian: { status: 'pending' } });
  await setDoc(doc(db, 'users/v-old'), { uid: 'v-old', username: 'vic', ageBand: 'teen', adultFrom: PAST, guardian: { status: 'pending' } });
  await setDoc(doc(db, 'guardian_consents/t-pending'), { teenUid: 't-pending', status: 'pending' });
  await setDoc(doc(db, 'guardian_consents/g-grown'), { teenUid: 'g-grown', status: 'graduated' });
  await setDoc(doc(db, 'guardian_requests/abc'), { teenUid: 't-pending', status: 'open' });
  // Follows: a-adult <-> u-approved, a-adult <-> t-pending, u-approved -> b-legacy only
  for (const [x, y] of [['a-adult', 'u-approved'], ['u-approved', 'a-adult'], ['a-adult', 't-pending'], ['t-pending', 'a-adult'], ['a-adult', 's-pending'], ['s-pending', 'a-adult'], ['u-approved', 'b-legacy']]) {
    await setDoc(doc(db, `users/${x}/following/${y}`), { at: 1 });
    await setDoc(doc(db, `users/${y}/followers/${x}`), { at: 1 });
  }
  await setDoc(doc(db, 'conversations/b-legacy_u-approved'), { participants: ['b-legacy', 'u-approved'] });
  await setDoc(doc(db, 'conversations/a-adult_u-approved'), { participants: ['a-adult', 'u-approved'] });
  await setDoc(doc(db, 'conversations/a-adult_t-pending'), { participants: ['a-adult', 't-pending'] });
  await setDoc(doc(db, 'ecosystem_feed/tp1'), { userId: 'u-approved', isPublic: true, caption: 'x', showLocation: false, locationArea: '', likes: [], likeCount: 0, commentCount: 0 });
  await setDoc(doc(db, 'ecosystem_feed/ap1'), { userId: 'a-adult', isPublic: true, caption: 'x', showLocation: false, locationArea: '', likes: [], likeCount: 0, commentCount: 0 });
});

const results = [];
const t = async (name, p) => { try { await p; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, String(e.message).slice(0, 160)]); } };
const base = (uid) => ({ uid, username: uid, isAnonymous: false, stats: { observations: 0, species: 0 } });

// Creating a profile
await t('teen creates profile with ageBand and adultFrom', assertSucceeds(setDoc(doc(member('n1'), 'users/n1'), { ...base('n1'), ageBand: 'teen', adultFrom: FUTURE })));
await t('adult creates profile with ageBand adult', assertSucceeds(setDoc(doc(member('n2'), 'users/n2'), { ...base('n2'), ageBand: 'adult' })));
await t('profile without a band (older app) still works', assertSucceeds(setDoc(doc(member('n3'), 'users/n3'), base('n3'))));
await t('X unknown ageBand', assertFails(setDoc(doc(member('n4'), 'users/n4'), { ...base('n4'), ageBand: 'kid' })));
await t('X teen without adultFrom', assertFails(setDoc(doc(member('n5'), 'users/n5'), { ...base('n5'), ageBand: 'teen' })));
await t('X adult with adultFrom', assertFails(setDoc(doc(member('n6'), 'users/n6'), { ...base('n6'), ageBand: 'adult', adultFrom: FUTURE })));
await t('X adultFrom not a timestamp', assertFails(setDoc(doc(member('n7'), 'users/n7'), { ...base('n7'), ageBand: 'teen', adultFrom: '2030-01' })));
await t('X profile created with guardian approved', assertFails(setDoc(doc(member('n8'), 'users/n8'), { ...base('n8'), ageBand: 'teen', adultFrom: FUTURE, guardian: { status: 'approved' } })));
await t('X profile created with guardianOf', assertFails(setDoc(doc(member('n9'), 'users/n9'), { ...base('n9'), guardianOf: ['t-pending'] })));
await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'guardian_consents/k1'), { teenUid: 'k1', status: 'pending' }); });
await t('X known teen recreates profile as adult', assertFails(setDoc(doc(member('k1'), 'users/k1'), { ...base('k1'), ageBand: 'adult' })));
await t('X known teen recreates profile with no band', assertFails(setDoc(doc(member('k1'), 'users/k1'), base('k1'))));
await t('known teen recreates profile as teen', assertSucceeds(setDoc(doc(member('k1'), 'users/k1'), { ...base('k1'), ageBand: 'teen', adultFrom: FUTURE })));
await t('explorer who has grown up recreates profile as adult', assertSucceeds(setDoc(doc(member('g-grown'), 'users/g-grown'), { ...base('g-grown'), ageBand: 'adult' })));

// Updating a profile
await t('X teen approves themselves', assertFails(updateDoc(doc(member('t-pending'), 'users/t-pending'), { 'guardian.status': 'approved' })));
await t('X teen removes the guardian record', assertFails(updateDoc(doc(member('t-pending'), 'users/t-pending'), { guardian: deleteField() })));
await t('X teen switches to adult', assertFails(updateDoc(doc(member('t-pending'), 'users/t-pending'), { ageBand: 'adult' })));
await t('X teen moves adultFrom', assertFails(updateDoc(doc(member('t-pending'), 'users/t-pending'), { adultFrom: PAST })));
await t('X adult adds a child to guardianOf', assertFails(updateDoc(doc(member('a-adult'), 'users/a-adult'), { guardianOf: arrayUnion('t-pending') })));
await t('X adult changes their band', assertFails(updateDoc(doc(member('a-adult'), 'users/a-adult'), { ageBand: 'teen', adultFrom: FUTURE })));
await t('teen edits their bio', assertSucceeds(updateDoc(doc(member('t-pending'), 'users/t-pending'), { bio: 'Moths and more moths' })));
await t('older profile sets its band once (guest upgrade)', assertSucceeds(updateDoc(doc(member('b-legacy'), 'users/b-legacy'), { ageBand: 'adult', ageConfirmed: true })));
await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'users/b-legacy'), { uid: 'b-legacy', username: 'bo' }); });
await t('older profile becomes a teen once (guest upgrade)', assertSucceeds(updateDoc(doc(member('n3'), 'users/n3'), { ageBand: 'teen', adultFrom: FUTURE })));

// Server-only records
await t('X teen reads their guardian request', assertFails(getDoc(doc(member('t-pending'), 'guardian_requests/abc'))));
await t('X teen writes a consent record', assertFails(setDoc(doc(member('t-pending'), 'guardian_consents/t-pending'), { status: 'approved' })));
await t('X parent reads consent record', assertFails(getDoc(doc(member('a-adult'), 'guardian_consents/t-pending'))));
await t('X client writes a deletion request', assertFails(setDoc(doc(member('a-adult'), 'deletion_requests/t-pending'), { uid: 't-pending' })));

// Letters
const convo = (a, b) => ({ participants: [a, b].sort(), participantInfo: {}, lastMessage: null, updatedAt: serverTimestamp() });
await t('adults write letters as before', assertSucceeds(setDoc(doc(member('a-adult'), 'conversations/a-adult_b-legacy'), convo('a-adult', 'b-legacy'))));
await t('X waiting teen opens a letter, even with mutual follows', assertFails(setDoc(doc(member('s-pending'), 'conversations/a-adult_s-pending'), convo('a-adult', 's-pending'))));
await t('X adult writes in a waiting teen\'s conversation', assertFails(setDoc(doc(member('a-adult'), 'conversations/a-adult_t-pending/messages/m1'), { senderId: 'a-adult', text: 'hi', createdAt: serverTimestamp() })));
await t('approved teen writes to someone they both follow', assertSucceeds(setDoc(doc(member('u-approved'), 'conversations/a-adult_u-approved/messages/m1'), { senderId: 'u-approved', text: 'Look, a hoopoe', createdAt: serverTimestamp() })));
await t('their mutual follow writes back', assertSucceeds(setDoc(doc(member('a-adult'), 'conversations/a-adult_u-approved/messages/m2'), { senderId: 'a-adult', text: 'Lovely', createdAt: serverTimestamp() })));
await t('X approved teen writes to someone who doesn\'t follow back', assertFails(setDoc(doc(member('u-approved'), 'conversations/b-legacy_u-approved/messages/m1'), { senderId: 'u-approved', text: 'hi', createdAt: serverTimestamp() })));
await t('X stranger writes to an approved teen', assertFails(setDoc(doc(member('b-legacy'), 'conversations/b-legacy_u-approved/messages/m2'), { senderId: 'b-legacy', text: 'hi', createdAt: serverTimestamp() })));
await t('X stranger opens a conversation with a teen', assertFails(setDoc(doc(member('n2'), 'conversations/n2_u-approved'), convo('n2', 'u-approved'))));
await t('a teen whose 18th has come writes like any adult', assertSucceeds(setDoc(doc(member('v-old'), 'conversations/b-legacy_v-old'), convo('b-legacy', 'v-old'))));

// Places on a teen's sightings
await t('teen edits their caption', assertSucceeds(updateDoc(doc(member('u-approved'), 'ecosystem_feed/tp1'), { caption: 'A hoopoe' })));
await t('X teen shows where a sighting was made', assertFails(updateDoc(doc(member('u-approved'), 'ecosystem_feed/tp1'), { showLocation: true, locationArea: 'Jodhpur' })));
await t('X teen adds a place name', assertFails(updateDoc(doc(member('u-approved'), 'ecosystem_feed/tp1'), { locationArea: 'Jodhpur' })));
await t('adult shows where a sighting was made', assertSucceeds(updateDoc(doc(member('a-adult'), 'ecosystem_feed/ap1'), { showLocation: true, locationArea: 'Jodhpur' })));

for (const r of results) console.log(r.join(' | '));
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`${results.length - failed}/${results.length} passed`);
await env.cleanup();
process.exit(failed ? 1 : 0);
