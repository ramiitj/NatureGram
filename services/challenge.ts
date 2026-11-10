/**
 * Does a sighting answer the fortnight naturalist's challenge? Most challenges are about a group of
 * life ("spot a bird", "find a fungus"), so the group a sighting belongs to (from lifeList.groupOf)
 * is enough to say so. Challenges about a moment rather than a group (a slow walk, a changed mood)
 * are left to the explorer, who answers them with the hashtag.
 */
import { groupOf, LifeGroup } from './lifeList';
import { getNaturalistExtra } from '../constants/naturalistExtras';

const CHALLENGE_GROUPS: Record<string, LifeGroup[]> = {
  ali: ['Birds'],
  audubon: ['Birds'],
  wilson: ['Insects'],
  merian: ['Insects'],
  carson: ['Insects', 'Birds'],
  potter: ['Fungi'],
  cousteau: ['Water life'],
  earle: ['Water life'],
  irwin: ['Reptiles & amphibians'],
  maathai: ['Plants'],
  kimmerer: ['Plants'],
  carver: ['Plants', 'Fungi'],
};

const UNNAMED = /^(unknown|nature|unidentified|observation|captured|uploaded|sighting|manual observation|audio recording|video recording)/i;

export const answersChallenge = (naturalistId: string | undefined, sighting: { labels?: string[]; aiIdentifications?: any[] | null; aiFlags?: any; tags?: string[] }): boolean => {
  if (!naturalistId) return false;
  const name = (sighting.labels?.[0] || '').trim();
  if (!name || UNNAMED.test(name)) return false;
  // Linnaeus asks for a true name: a two-part scientific name counts
  if (naturalistId === 'linnaeus') {
    return [sighting.labels?.[1], sighting.aiIdentifications?.[0]?.scientificName].some(s => !!s && /^[A-Z][a-z]+ [a-z]+/.test(s));
  }
  const groups = CHALLENGE_GROUPS[naturalistId];
  return !!groups && groups.includes(groupOf(sighting));
};

/** True when a post carries this fortnight's challenge hashtag (case-insensitive). */
export const carriesChallengeTag = (naturalistId: string | undefined, tags: string[] = []) => {
  const tag = getNaturalistExtra(naturalistId).challengeTag.toLowerCase();
  return tags.some(t => (t || '').trim().toLowerCase() === tag);
};
