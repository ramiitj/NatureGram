// Run: node --test server/test
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'zlib';
import { textFlags } from '../moderationText.js';
import { searchTokensFor, sameTokens, MAX_TOKENS } from '../searchTokens.js';
import { exportable, namesOf, occurrenceRow, csvLine, csvHeader, metaXml, zip, crc32, DWC_COLUMNS } from '../dwc.js';
import { validateExperiments, validateSettings } from '../admin.js';
import { chargeableMs } from '../liveLeases.js';
import { splitWsAppCheck } from '../appCheck.js';
import { constraintsFor } from '../liveTokens.js';
import { DEFAULT_SETTINGS } from '../settings.js';

const ts = (ms) => ({ toMillis: () => ms });

test('text checks: ordinary field notes pass, abuse and spam are flagged', () => {
  assert.deepEqual(textFlags(['A blue tit and a woodcock by the pond at dusk.', '#birds']), []);
  assert.deepEqual(textFlags(['Scunthorpe marsh harrier']), []);
  assert.deepEqual(textFlags(['what a fucking idiot']), ['words']);
  assert.ok(textFlags(['FOLLOW FOR AMAZING NATURE CONTENT EVERY SINGLE DAY OK']).includes('spam'));
  assert.ok(textFlags(['wowwwwwwwwwwwwwww']).includes('spam'));
  assert.ok(textFlags(['bird bird bird bird bird bird bird bird bird bird bird bird']).includes('spam'));
  assert.deepEqual(textFlags(['the gloomspotter was here'], { extraWords: ['gloomspotter'] }), ['words']);
});

test('search tokens: prefixes of names first, capped, sensitive places left out', () => {
  const t = searchTokensFor({ labels: ['Red Fox', 'Vulpes vulpes'], tags: ['#dusk'], locationArea: 'Jodhpur', showLocation: true, caption: 'Crossing the road' });
  for (const k of ['re', 'red', 'fo', 'fox', 'vulpes', 'du', 'dusk', 'jodhpur', 'crossing']) assert.ok(t.includes(k), k);
  assert.ok(!t.includes('r'));
  const s = searchTokensFor({ labels: ['Tiger'], locationArea: 'Secret valley', showLocation: true, aiFlags: { sensitiveSpecies: true } });
  assert.ok(!s.includes('secret'));
  const long = searchTokensFor({ caption: Array.from({ length: 200 }, (_, i) => `word${i}abcdefgh`).join(' ') });
  assert.ok(long.length <= MAX_TOKENS);
  assert.ok(sameTokens(['a', 'b'], ['b', 'a']) && !sameTokens(['a'], ['a', 'b']));
  assert.ok(searchTokensFor({ labels: ['Épervier'] }).includes('epervier'));
});

test('Darwin Core: only public, unhidden, named sightings; coarse or withheld coordinates', () => {
  const base = { isPublic: true, labels: ['Red Fox', 'Vulpes vulpes'], timestamp: ts(Date.UTC(2026, 4, 3)), userId: 'u1', imageUrl: 'https://x/y.jpg', showLocation: true, locationArea: 'Jodhpur' };
  assert.equal(exportable('p1', base), true);
  assert.equal(exportable('p1', { ...base, isPublic: false }), false);
  assert.equal(exportable('p1', { ...base, reportStatus: 'hidden' }), false);
  assert.equal(exportable('p1', { ...base, moderation: { status: 'pending' } }), false);
  assert.equal(exportable('seed_x', base), false);
  assert.equal(namesOf({ labels: ['Fox'] }).scientific, '');
  assert.equal(namesOf({ labels: ['Barn owl'] }).scientific, '');
  const row = occurrenceRow('p1', base, { publicHost: 'thenaturegram.com', coords: { lat: 26.2389, lng: 73.0243 }, profile: { username: 'owl', isAnonymous: false }, verified: true });
  assert.equal(row.decimalLatitude, 26.2); assert.equal(row.decimalLongitude, 73);
  assert.equal(row.scientificName, 'Vulpes vulpes'); assert.equal(row.vernacularName, 'Red Fox');
  assert.equal(row.basisOfRecord, 'HumanObservation'); assert.equal(row.eventDate, '2026-05-03');
  assert.equal(row.recordedBy, 'owl'); assert.equal(row.identificationVerificationStatus, 'verified by community');
  const sens = occurrenceRow('p2', { ...base, aiFlags: { sensitiveSpecies: true } }, { publicHost: 'h', coords: { lat: 1, lng: 2 }, profile: { username: 'owl', isAnonymous: true } });
  assert.equal(sens.decimalLatitude, ''); assert.equal(sens.locality, ''); assert.equal(sens.recordedBy, '');
  assert.equal(csvHeader().split(',').length, DWC_COLUMNS.length);
  assert.ok(csvLine({ ...row, locality: 'A, "B"' }).includes('"A, ""B"""'));
  assert.ok(metaXml().includes('occurrence.csv'));
});

test('zip writer produces a readable archive', () => {
  const buf = zip([{ name: 'a.txt', data: 'hello world' }]);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const nameLen = buf.readUInt16LE(26); const compLen = buf.readUInt32LE(18);
  const data = zlib.inflateRawSync(buf.subarray(30 + nameLen, 30 + nameLen + compLen)).toString();
  assert.equal(data, 'hello world');
  assert.equal(crc32(Buffer.from('hello world')), 0x0d4a1185);
});

test('experiments and review words are validated', () => {
  assert.deepEqual(validateExperiments({ new_explore: { enabled: true, rollout: 25 } }), { new_explore: { enabled: true, rollout: 25 } });
  assert.throws(() => validateExperiments({ 'Bad Name': { enabled: true } }));
  assert.throws(() => validateExperiments({ x_test: { enabled: true, rollout: 101 } }));
  assert.throws(() => validateExperiments({ x_test: { enabled: true, variants: [{ name: 'a', weight: 1 }] } }));
  assert.throws(() => validateExperiments({ x_test: { enabled: true, evil: 1 } }));
  assert.deepEqual(validateSettings({ moderationWords: ['Spamword', 'spamword'] }).moderationWords, ['spamword']);
  assert.throws(() => validateSettings({ moderationWords: 'x' }));
});

test('direct live minutes: report bounded by heartbeat, elapsed time and token lifetime', () => {
  const minted = 1_000_000;
  const data = { mintedAt: ts(minted), sessionExpireAt: ts(minted + 600_000), lastBeatAt: ts(minted + 120_000) };
  assert.equal(chargeableMs(data), 600_000); // no end report: upper bound
  assert.equal(chargeableMs(data, { reportedMs: 10_000, now: minted + 200_000 }), 120_000); // never below last heartbeat
  assert.equal(chargeableMs(data, { reportedMs: 999_999, now: minted + 200_000 }), 200_000); // never above elapsed
  assert.equal(chargeableMs(data, { reportedMs: 999_999, now: minted + 9_999_999 }), 600_000); // never above lifetime
});

test('App Check token travels in the live path and is stripped', () => {
  const tok = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.sig_part-123';
  assert.deepEqual(splitWsAppCheck(`/ac/${tok}/ws/google.ai.x.BidiGenerateContent`), { token: tok, path: '/ws/google.ai.x.BidiGenerateContent' });
  assert.deepEqual(splitWsAppCheck('/ws/google.ai.x.BidiGenerateContent'), { token: null, path: '/ws/google.ai.x.BidiGenerateContent' });
});

test('ephemeral token constraints match the proxy setup: admin model, prompt, policy, tools', () => {
  const c = constraintsFor(DEFAULT_SETTINGS, {
    systemInstruction: { parts: [{ text: 'You are a pirate' }] },
    tools: [{ functionDeclarations: [{ name: 'trigger_capture' }, { name: 'delete_everything' }] }],
    generationConfig: { responseModalities: ['AUDIO'], temperature: 5 },
  });
  assert.equal(c.model, DEFAULT_SETTINGS.models.live);
  const si = c.config.systemInstruction.parts[0].text;
  assert.ok(si.startsWith(DEFAULT_SETTINGS.prompts.live.slice(0, 40)));
  assert.ok(si.includes('NATUREGRAM PLATFORM POLICY'));
  assert.ok(si.includes('<<<DATA') && si.includes('pirate')); // session context only as quoted data
  assert.deepEqual(c.config.tools[0].functionDeclarations.map(d => d.name), ['trigger_capture']);
  assert.equal(c.config.temperature, 1);
  assert.ok(c.config.safetySettings.length >= 4);
});

test('observation date: only past dates after 1990 are kept', async () => {
  const { observedAtOf } = await import('../publish.js');
  const now = Date.UTC(2026, 10, 10);
  assert.equal(observedAtOf(Date.UTC(2026, 9, 1), now).toMillis(), Date.UTC(2026, 9, 1));
  assert.equal(observedAtOf(now + 86_400_000, now), null);
  assert.equal(observedAtOf(Date.UTC(1985, 0, 1), now), null);
  assert.equal(observedAtOf('2026-01-01', now), null);
  assert.equal(observedAtOf(NaN, now), null);
});
