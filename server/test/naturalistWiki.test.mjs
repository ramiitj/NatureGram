// Run: node --test server/test/naturalistWiki.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isFreeLicence, commonsFileOf, shortExtract, WIKI_TITLES } from '../naturalistWiki.js';
import fs from 'node:fs';

const meta = (name, nonFree = false) => ({ LicenseShortName: { value: name }, NonFree: { value: String(nonFree) } });

test('only free licences are shown', () => {
  for (const ok of ['Public domain', 'PD-US', 'CC0', 'CC BY 2.0', 'CC BY-SA 4.0', 'CC BY 2.5']) assert.equal(isFreeLicence(meta(ok)), true, ok);
  for (const no of ['CC BY-NC 2.0', 'CC BY-ND 4.0', 'CC BY-NC-SA 3.0', 'Fair use', 'Non-free', '', 'All rights reserved']) assert.equal(isFreeLicence(meta(no)), false, no);
  assert.equal(isFreeLicence(meta('CC BY-SA 4.0', true)), false, 'marked non-free');
  assert.equal(isFreeLicence(null), false);
});

test('files kept on English Wikipedia (usually fair use) are never used', () => {
  assert.equal(commonsFileOf('https://upload.wikimedia.org/wikipedia/commons/d/dc/Salim_ali_mns.jpg?utm_source=x'), 'Salim_ali_mns.jpg');
  assert.equal(commonsFileOf('https://thumb.wikimedia.org/wikipedia/commons/thumb/d/dc/Salim_ali_mns.jpg/330px-Salim_ali_mns.jpg'), 'Salim_ali_mns.jpg');
  assert.equal(commonsFileOf('https://upload.wikimedia.org/wikipedia/en/3/3a/Someone.jpg'), null);
  assert.equal(commonsFileOf(''), null);
});

test('the extract ends on a whole sentence', () => {
  const long = 'One sentence here. '.repeat(40);
  const out = shortExtract(long);
  assert.ok(out.length <= 420 && out.endsWith('.'));
  assert.equal(shortExtract('Short.'), 'Short.');
});

test('every naturalist in the rotation has an exact article title', () => {
  const ids = [...fs.readFileSync(new URL('../../constants/naturalists.ts', import.meta.url), 'utf8').matchAll(/^\s+id: '([a-z]+)'/gm)].map(m => m[1]);
  assert.ok(ids.length >= 24);
  for (const id of ids) assert.ok(WIKI_TITLES[id], `missing title for ${id}`);
});
