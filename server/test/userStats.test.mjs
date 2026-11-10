// Run: node --test server/test/userStats.test.mjs
// One true count: the server's species and sightings agree with the app's life list, the Cloud
// Functions copy is identical, and the recount writes only the stats it owns.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { statsFromPosts, speciesKey, affectsStats, recomputeUserStats, IGNORE_NAME } from '../userStats.js';

const life = await import('../../services/lifeList.ts');

const ts = (ms) => ({ toMillis: () => ms });
const POSTS = [
  { id: 'a', userId: 'u', isPublic: true, labels: ['House Sparrow'], timestamp: ts(1) },
  { id: 'b', userId: 'u', isPublic: true, labels: ['house sparrow '], timestamp: ts(2) },
  { id: 'c', userId: 'u', isPublic: true, labels: ['Barn Owl', 'Tyto alba'], timestamp: ts(3) },
  { id: 'd', userId: 'u', isPublic: false, labels: ['Kingfisher'], timestamp: ts(4) },
  { id: 'e', userId: 'u', isPublic: true, labels: ['Nature'], timestamp: ts(5) },
  { id: 'f', userId: 'u', isPublic: true, labels: ['Captured photo'], timestamp: ts(6) },
  { id: 'g', userId: 'u', isPublic: true, timestamp: ts(7) },
  { id: 'h', userId: 'u', isPublic: true, labels: ['  Common Kingfisher  '], timestamp: ts(8) },
];

test('species are distinct life-list names on public sightings; sightings are public posts', () => {
  assert.deepEqual(statsFromPosts(POSTS), { species: 3, sightings: 7 });
  assert.deepEqual(statsFromPosts([]), { species: 0, sightings: 0 });
  assert.deepEqual(statsFromPosts(null), { species: 0, sightings: 0 });
});

test('the server count matches the app (services/lifeList.ts lifeStats and buildLifeList)', () => {
  const pub = POSTS.filter(p => p.isPublic === true);
  assert.equal(statsFromPosts(POSTS).species, life.buildLifeList(pub).length);
  assert.deepEqual(statsFromPosts(POSTS), life.lifeStats(POSTS));
  // Same placeholder rule as the life list
  assert.equal(String(IGNORE_NAME), String(/^(unknown|nature|unidentified|observation|captured|uploaded|sighting)/i));
  const src = fs.readFileSync(new URL('../../services/lifeList.ts', import.meta.url), 'utf8');
  assert.ok(src.includes(`const IGNORE = ${String(IGNORE_NAME)};`), 'lifeList.ts IGNORE must match server/userStats.js IGNORE_NAME');
});

test('speciesKey trims and ignores case; placeholders name nothing', () => {
  assert.equal(speciesKey({ labels: ['  Barn Owl '] }), 'barn owl');
  assert.equal(speciesKey({ labels: ['Unidentified bird'] }), '');
  assert.equal(speciesKey({}), '');
  assert.equal(speciesKey(null), '');
});

test('only creates, deletes, visibility and renames move the counts', () => {
  const a = { userId: 'u', isPublic: true, labels: ['Robin'], likeCount: 1 };
  assert.equal(affectsStats(null, a), true);
  assert.equal(affectsStats(a, null), true);
  assert.equal(affectsStats(a, { ...a, likeCount: 2, commentCount: 4 }), false);
  assert.equal(affectsStats(a, { ...a, isPublic: false }), true);
  assert.equal(affectsStats(a, { ...a, labels: ['robin'] }), false);
  assert.equal(affectsStats(a, { ...a, labels: ['Wren'] }), true);
  const priv = { ...a, isPublic: false };
  assert.equal(affectsStats(priv, { ...priv, labels: ['Wren'] }), false);
});

test('functions/userStats.js is an exact copy of server/userStats.js', () => {
  const a = fs.readFileSync(new URL('../userStats.js', import.meta.url), 'utf8');
  const b = fs.readFileSync(new URL('../../functions/userStats.js', import.meta.url), 'utf8');
  assert.equal(b, a);
});

/** A tiny in-memory stand-in for the Admin SDK calls the recount uses. */
const fakeDb = (posts, users) => {
  const writes = [];
  return {
    writes,
    collection: (name) => ({
      where: (f, op, v) => ({
        select: () => ({ get: async () => ({ docs: posts.filter(p => p[f] === v).map(p => ({ data: () => p })) }) }),
      }),
    }),
    doc: (path) => ({
      get: async () => ({ exists: !!users[path.split('/')[1]] }),
      set: async (data, opts) => { writes.push({ path, data, opts }); },
    }),
  };
};
const FV = { serverTimestamp: () => 'NOW' };

test('recomputeUserStats merges species, sightings and reconciledAt into the profile', async () => {
  const db = fakeDb([...POSTS, { userId: 'other', isPublic: true, labels: ['Wren'] }], { u: {} });
  const out = await recomputeUserStats(db, 'u', FV);
  assert.deepEqual(out, { species: 3, sightings: 7 });
  assert.equal(db.writes.length, 1);
  assert.deepEqual(db.writes[0], { path: 'users/u', data: { stats: { species: 3, sightings: 7, reconciledAt: 'NOW' } }, opts: { merge: true } });
});

test('recomputeUserStats never recreates a deleted profile', async () => {
  const db = fakeDb(POSTS, {});
  await recomputeUserStats(db, 'u', FV);
  assert.equal(db.writes.length, 0);
  assert.equal(await recomputeUserStats(null, 'u', FV), null);
});
