/**
 * Cheap text checks for words people publish (captions, titles, notes, tags, comments).
 * No AI call: a short word list plus spam heuristics. A hit does not reject anything; the
 * sighting or comment is kept out of public view until the admin reviews it.
 *
 * Deliberately narrow so ordinary field notes pass ("cock" in "woodcock", "tit" in "blue tit"):
 * words are matched whole, and natural-history words that look rude are allowed.
 * The admin can add words in Admin → AI governance (settings.moderationWords).
 *
 * functions/index.js keeps a copy of this logic for comments; keep the two in step.
 */

// Strong abuse and slurs only. Whole-word, case-insensitive. Kept short on purpose.
export const BASE_WORDS = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'cunt', 'bitch', 'bastard', 'asshole', 'dickhead',
  'whore', 'slut', 'retard', 'retarded', 'faggot', 'fag', 'nigger', 'nigga', 'chink', 'spic', 'kike', 'paki', 'tranny',
  'rape', 'rapist', 'porn', 'porno', 'nude', 'nudes', 'xxx', 'onlyfans',
  'kill yourself', 'kys', 'go die',
];

const PROMO = /\b(whatsapp|telegram|dm me|follow me|follow back|promo|discount|coupon|giveaway|buy now|free followers|subscribe|casino|betting|jackpot|lottery|crypto|forex|loan offer|earn money|work from home)\b/i;

// Plant names that contain a listed word: "oilseed rape" is a crop (rapeseed already passes as one word)
const PLANT_NAMES = /\boil[\s-]*seed[\s-]+rape\b/giu;
export const withoutPlantNames = (text) => String(text || '').replace(PLANT_NAMES, 'oilseed crop');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const listRe = (words) => (words.length ? new RegExp(`(^|[^\\p{L}\\p{N}])(${words.map(escape).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu') : null);

let cache = { key: '', re: null };
function wordRe(extra = []) {
  const words = [...BASE_WORDS, ...extra.map(w => String(w).trim().toLowerCase()).filter(w => w.length >= 2 && w.length <= 40)];
  const key = words.join('|');
  if (cache.key !== key) cache = { key, re: listRe(words) };
  return cache.re;
}

/**
 * Returns a list of reasons (empty when the text looks fine):
 *  'words' – abuse, slurs or sexual content from the list
 *  'spam'  – promotions, shouting, repeated characters or words, hashtag or mention floods
 */
export function textFlags(texts, { extraWords = [] } = {}) {
  const all = withoutPlantNames((Array.isArray(texts) ? texts : [texts]).filter(t => typeof t === 'string' && t.trim()).join('\n'));
  if (!all) return [];
  const reasons = new Set();
  const re = wordRe(extraWords);
  if (re && re.test(all)) reasons.add('words');

  if (PROMO.test(all)) reasons.add('spam');
  if (/(.)\1{9,}/u.test(all)) reasons.add('spam');                                   // aaaaaaaaaa / !!!!!!!!!!
  const letters = all.replace(/[^\p{L}]/gu, '');
  const upper = all.replace(/[^\p{Lu}]/gu, '');
  if (letters.length >= 40 && upper.length / letters.length > 0.8) reasons.add('spam'); // SHOUTING
  if ((all.match(/#[\p{L}\p{N}_]+/gu) || []).length > 20) reasons.add('spam');
  if ((all.match(/@[A-Za-z0-9_.]{3,30}/g) || []).length > 8) reasons.add('spam');
  const words = (all.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
  if (words.length >= 12) {
    const counts = new Map();
    for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
    const top = Math.max(...counts.values());
    if (top >= 8 && top / words.length > 0.4) reasons.add('spam');                   // same word over and over
  }
  return [...reasons];
}
