/**
 * The life list as a naturalist's collection rather than a table: every distinct species an explorer
 * has recorded, numbered in the order it was found, with the date, place and season of that first
 * meeting and the group of life it belongs to. Built entirely from posts already stored, so no data
 * migration is needed and nothing is lost when an older post lacks a field.
 */
import type { GlyphName } from '../components/Glyph';

export type LifeGroup = 'Birds' | 'Plants' | 'Insects' | 'Fungi' | 'Mammals' | 'Reptiles & amphibians' | 'Water life' | 'Other life';

export const GROUP_GLYPH: Record<LifeGroup, GlyphName> = {
  'Birds': 'bird', 'Plants': 'leaf', 'Insects': 'insect', 'Fungi': 'mushroom', 'Mammals': 'paw',
  'Reptiles & amphibians': 'frog', 'Water life': 'fish', 'Other life': 'shell',
};

export interface LifeEntry {
  /** Discovery number: 1 is the first species ever recorded */
  no: number;
  name: string;
  scientific?: string;
  firstMs: number;
  place?: string;
  season?: string;
  group: LifeGroup;
  count: number;
  thumb?: string;
  postId: string;
}

const RX: [LifeGroup, RegExp][] = [
  ['Fungi', /(mushroom|fung|toadstool|amanita|bolete|chanterelle|morel|agaric|russula|lactarius|cortinarius|polypore|puffball|mycena|psilocybe|galerina|lepiota|coprinus|pleurotus|bracket|lichen|mould|mold)/i],
  ['Birds', /(bird|sparrow|robin|crow|raven|jay|finch|warbler|thrush|owl|hawk|eagle|kite|falcon|kestrel|heron|egret|stork|crane|duck|goose|swan|gull|tern|pigeon|dove|parrot|parakeet|myna|starling|bulbul|kingfisher|roller|hoopoe|bee-eater|drongo|swallow|swift|martin|wren|tit\b|chickadee|woodpecker|barbet|cuckoo|koel|peacock|peafowl|pheasant|partridge|quail|sandpiper|plover|lapwing|cormorant|pelican|flamingo|ibis|vulture|magpie|oriole|sunbird|hummingbird|weaver|munia|lark|pipit|wagtail|shrike|babbler|minivet|prinia|tailorbird|flycatcher|redstart|chat\b|wheatear|nuthatch|treecreeper|grebe|coot|moorhen|rail\b|bittern|darter|coucal|hornbill|shikra|harrier|buzzard|osprey|francolin|junglefowl|fowl|rosefinch|iora|white-eye|bushchat|stonechat|robin|kite|jacana|stilt|avocet|curlew|godwit|snipe|loon|puffin|albatross|petrel|shearwater|frigatebird|booby|gannet|sandgrouse|nightjar|frogmouth|trogon|toucan|tanager|cardinal|grosbeak|bunting|sparrow|blackbird|bluebird|mockingbird|catbird|vireo|kinglet|phoebe|pewee|kingbird|aves|passer|corvus|columba|turdus|centropus|accipiter|milvus|halcyon|ardea|egretta)/i],
  ['Insects', /(insect|butterfly|moth|bee\b|bees\b|bumblebee|honeybee|wasp|hornet|ant\b|ants\b|beetle|ladybird|ladybug|dragonfly|damselfly|grasshopper|cricket|locust|mantis|cicada|bug\b|aphid|fly\b|hoverfly|mosquito|termite|caterpillar|lepidoptera|coleoptera|odonata|hymenoptera|spider|arachnid|scorpion|centipede|millipede|tick\b|mite\b)/i],
  ['Mammals', /(mammal|squirrel|chipmunk|mouse|rat\b|vole|shrew|bat\b|bats\b|fox|wolf|jackal|dog\b|deer|antelope|gazelle|elk|moose|boar|pig\b|monkey|macaque|langur|ape|gorilla|chimp|orangutan|lemur|bear|tiger|lion|leopard|cheetah|cat\b|lynx|otter|badger|weasel|mongoose|hedgehog|rabbit|hare|elephant|rhino|hippo|giraffe|zebra|horse|cow\b|buffalo|bison|goat|sheep|ibex|camel|whale|dolphin|seal\b|sea lion|porpoise|kangaroo|wallaby|koala|possum|opossum|raccoon|skunk|beaver|porcupine|pangolin|civet|hyena|mammalia)/i],
  ['Reptiles & amphibians', /(reptile|lizard|gecko|skink|monitor|iguana|chameleon|snake|cobra|python|viper|krait|rat snake|boa|turtle|tortoise|terrapin|crocodile|alligator|gharial|frog|toad|newt|salamander|caecilian|amphibia|reptilia)/i],
  ['Water life', /(fish|carp|trout|salmon|perch|bass\b|catfish|eel|shark|ray\b|stingray|goby|minnow|guppy|koi|crab|shrimp|prawn|lobster|barnacle|jellyfish|anemone|coral|starfish|sea star|urchin|octopus|squid|cuttlefish|plankton|tadpole)/i],
  ['Plants', /(plant|tree|flower|shrub|herb|grass|fern|moss|liverwort|orchid|lily|rose|daisy|sunflower|lotus|water lily|cactus|succulent|palm|pine|fir|spruce|cedar|oak|maple|banyan|peepal|fig|neem|mango|acacia|eucalyptus|bamboo|vine|creeper|ivy|weed|clover|dandelion|poppy|tulip|jasmine|hibiscus|marigold|bougainvillea|lantana|thistle|sedge|reed|rush|algae|seaweed|leaf|leaves|blossom|bloom|seed|fruit|berry|flora|plantae|ficus|quercus|acer|pinus)/i],
  ['Other life', /(snail|slug|mollus|clam|mussel|oyster|worm|earthworm|leech|sponge)/i],
];

/** Which group of life a sighting belongs to, from its labels, tags and AI identification. */
export const groupOf = (p: any): LifeGroup => {
  const hay = [
    ...(p?.labels || []),
    ...(p?.tags || []),
    ...((p?.aiIdentifications || p?.items?.[0]?.aiIdentifications || []) as any[]).flatMap(i => [i?.commonName, i?.scientificName]),
  ].filter(Boolean).join(' ');
  if (p?.aiFlags?.fungi) return 'Fungi';
  for (const [g, rx] of RX) if (rx.test(hay)) return g;
  return 'Other life';
};

/** Meteorological season for a date; flips for the southern hemisphere when latitude is known. */
export const seasonOf = (ms: number, lat?: number | null): string => {
  const m = new Date(ms).getMonth();
  const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  const flip: Record<string, string> = { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' };
  const s = north[m];
  const season = typeof lat === 'number' && lat < 0 ? flip[s] : s;
  // First month of each season (Mar, Jun, Sep, Dec) reads as "early"
  return m % 3 === 2 ? `early ${season}` : season;
};

export const toMs = (t: any): number => t?.toMillis ? t.toMillis() : (typeof t?.seconds === 'number' ? t.seconds * 1000 : (typeof t === 'number' ? t : 0));

const IGNORE = /^(unknown|nature|unidentified|observation|captured|uploaded|sighting)/i;

/** "14 Mar 2026" in the explorer's locale, like a field-notebook entry. */
export const fieldDate = (ms: number) => ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export const buildLifeList = (posts: any[]): LifeEntry[] => {
  const map = new Map<string, LifeEntry>();
  const sorted = [...posts].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
  let no = 0;
  for (const p of sorted) {
    const name = (p.labels?.[0] || '').trim();
    if (!name || IGNORE.test(name)) continue;
    const key = name.toLowerCase();
    const e = map.get(key);
    if (e) { e.count++; continue; }
    const ms = toMs(p.timestamp);
    const lat = p.rawLocation?.lat ?? p.items?.[0]?.rawLocation?.lat;
    const sci = (p.labels?.[1] && /^[A-Z][a-z]+ [a-z]+/.test(p.labels[1])) ? p.labels[1]
      : (p.aiIdentifications?.[0]?.scientificName || p.items?.[0]?.aiIdentifications?.[0]?.scientificName);
    map.set(key, {
      no: ++no, name, scientific: sci || undefined, firstMs: ms,
      place: p.showLocation !== false && p.locationArea ? p.locationArea : undefined,
      season: ms ? seasonOf(ms, lat) : undefined,
      group: groupOf(p), count: 1, thumb: p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl, postId: p.id,
    });
  }
  return [...map.values()];
};

export const MILESTONES = [10, 25, 50, 100, 250, 500];

/** The milestone a discovery number reaches, if any ("Your 25th"). */
export const milestoneAt = (no: number) => MILESTONES.includes(no) ? no : null;

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** Does this explorer already have this species on their list? */
export const isOnList = (entries: { name: string }[], name?: string | null) =>
  !!name && entries.some(e => e.name.toLowerCase() === name.trim().toLowerCase());

/** Kinds of life in the order every chip row and drawer lists them. */
export const GROUP_ORDER: LifeGroup[] = ['Birds', 'Plants', 'Insects', 'Fungi', 'Mammals', 'Reptiles & amphibians', 'Water life', 'Other life'];

/**
 * One true count, as the server keeps it (server/userStats.js): sightings are public posts,
 * species are distinct life-list names among them.
 */
export const lifeStats = (posts: any[]): { species: number; sightings: number } => {
  const pub = (posts || []).filter(p => p && p.isPublic === true);
  return { species: buildLifeList(pub).length, sightings: pub.length };
};

/**
 * A profile's counts, only once the server has reconciled them (stats.reconciledAt).
 * Before that the numbers may be wrong, so callers show none.
 */
export const reconciledStats = (profile: any): { species: number; sightings: number } | null => {
  const st = profile?.stats;
  if (!st || !st.reconciledAt || typeof st.species !== 'number' || typeof st.sightings !== 'number') return null;
  return { species: st.species, sightings: st.sightings };
};

const BINOMIAL = /^[A-Z][a-z]+ [a-z]+(?: [a-z]+)?$/;

/**
 * The name to lead with and the Latin to put underneath. A sighting labelled only with its
 * scientific name leads with the guide's common name when there is one.
 */
export const namesOf = (p: any): { common: string; latin?: string } => {
  const labels: string[] = (p?.labels || []).map((l: any) => String(l || '').trim()).filter(Boolean);
  const ids: any[] = p?.aiIdentifications || p?.items?.[0]?.aiIdentifications || [];
  const first = labels[0] || '';
  // Labels written as "Orthotomus sutorius (Common Tailorbird)" or "Common Tailorbird (Orthotomus sutorius)"
  const paren = /^(.+?)\s*\((.+)\)$/.exec(first);
  if (paren) {
    const [a, b] = [paren[1].trim(), paren[2].trim()];
    if (BINOMIAL.test(a) && !BINOMIAL.test(b)) return { common: b, latin: a };
    if (BINOMIAL.test(b) && !BINOMIAL.test(a)) return { common: a, latin: b };
  }
  const sciFromIds = ids.find(i => i?.scientificName)?.scientificName as string | undefined;
  if (first && BINOMIAL.test(first)) {
    const match = ids.find(i => i?.commonName && String(i.scientificName || '').trim().toLowerCase() === first.toLowerCase());
    if (match?.commonName && match.commonName.trim().toLowerCase() !== first.toLowerCase()) return { common: match.commonName.trim(), latin: first };
    // The guide's own words often open with the common name: "A Blackish Rail is observed…"
    const prose = String(p?.behavior || p?.aiInsight || p?.items?.[0]?.aiInsight || '');
    const named = /^(?:An?|The)\s+([A-Z][a-z'-]+(?:\s[A-Z][a-z'-]+){1,3})\s+(?:is|are|was|were|has|perches|sits|stands|feeds|forages|rests|flies|calls|sings)\b/.exec(prose.trim());
    if (named) return { common: named[1], latin: first };
    return { common: first };
  }
  const latin = labels[1] && BINOMIAL.test(labels[1]) ? labels[1] : (sciFromIds && sciFromIds.trim().toLowerCase() !== first.toLowerCase() ? sciFromIds.trim() : undefined);
  return { common: first, latin };
};
