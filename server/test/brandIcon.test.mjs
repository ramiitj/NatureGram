// Run: node --test server/test/brandIcon.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { naturalistAt } from '../brandIcon.js';
import { markSvg, resolveColors, DEFAULT_MARK } from '../../shared/brandMarkCore.js';

const ROT = JSON.parse(fs.readFileSync(new URL('../../constants/palettes.json', import.meta.url), 'utf8'));

test('every fortnight resolves to a naturalist with a palette', () => {
  for (let t = Date.parse('2026-01-01'); t < Date.parse('2028-01-01'); t += 86_400_000) {
    const id = naturalistAt(t);
    assert.ok(ROT.palettes[id], `no palette for ${id}`);
  }
});

test('the mark follows the admin choice of fixed colours', () => {
  const c = resolveColors({ primary: '#aa3d00', primaryGradient: '#cc590d' }, { colorMode: 'fixed', fixed: { ground: '#123456' } });
  assert.equal(c.ground, '#123456');
  assert.ok(markSvg(c).includes('#123456'));
  assert.ok(markSvg(DEFAULT_MARK, 'sun', 'square').startsWith('<svg'));
});
