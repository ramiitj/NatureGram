import { NATURALIST_THEMES, NaturalistTheme } from './naturalists';

/**
 * The fortnightly naturalist is NatureGram's ritual: every ~15 days the app's palette,
 * landing story and community challenge change to honour one naturalist's philosophy.
 */
export interface NaturalistExtra {
  lifespan: string;
  /** One-line story of who they were */
  bio: string;
  /** Their way of seeing, distilled into an invitation */
  philosophy: string;
  /** A field challenge the whole community shares during the period */
  challenge: string;
  /** Hashtag used to gather challenge posts */
  challengeTag: string;
  /** What the live guide gently encourages explorers to notice */
  lensPrompt: string;
}

export const NATURALIST_EXTRAS: Record<string, NaturalistExtra> = {
  goodall: { lifespan: '1934–2025', bio: 'Primatologist who spent decades with the chimpanzees of Gombe and showed that animals use tools, feel and have personalities.', philosophy: 'Patience and empathy reveal individual lives.', challenge: 'Watch one animal for five quiet minutes and note what makes it an individual.', challengeTag: '#GoodallWatch', lensPrompt: 'individual behaviour and social bonds' },
  fossey: { lifespan: '1932–1985', bio: 'Studied mountain gorillas in the Virunga volcanoes and fought poaching to protect them.', philosophy: 'Protection begins with knowing a species intimately.', challenge: 'Document a species that needs protecting where you live and what threatens it.', challengeTag: '#FosseyGuardians', lensPrompt: 'threats, habitat health and conservation' },
  darwin: { lifespan: '1809–1882', bio: 'His voyage on the Beagle and years of careful observation led to the theory of evolution by natural selection.', philosophy: 'Small variations, patiently noticed, explain the living world.', challenge: 'Find two related organisms side by side and capture how they differ.', challengeTag: '#DarwinVariations', lensPrompt: 'variation and adaptation between similar species' },
  wallace: { lifespan: '1823–1913', bio: 'Explored the Amazon and Malay Archipelago, co-discovered natural selection and founded biogeography.', philosophy: 'Where a creature lives tells the story of how it came to be.', challenge: 'Capture a species that only lives in your region (an endemic) or a native of your area.', challengeTag: '#WallaceLine', lensPrompt: 'geography, range and native vs introduced species' },
  muir: { lifespan: '1838–1914', bio: 'Wilderness writer whose advocacy helped create Yosemite and the US national parks.', philosophy: 'Wildness is a necessity, not a luxury.', challenge: 'Take a slow walk somewhere wild and share the moment that stopped you.', challengeTag: '#MuirWalk', lensPrompt: 'landscapes, trees and the feeling of wild places' },
  carson: { lifespan: '1907–1964', bio: 'Marine biologist whose book Silent Spring exposed the harm of pesticides and launched modern environmentalism.', philosophy: 'Everything is connected; harm travels through the web of life.', challenge: 'Capture a pollinator, songbird or insect and the plant it depends on.', challengeTag: '#SilentSpringNoMore', lensPrompt: 'food webs, pollinators and ecosystem connections' },
  thoreau: { lifespan: '1817–1862', bio: 'Lived simply at Walden Pond and kept meticulous seasonal records still used by climate scientists.', philosophy: 'Return to one place often and the seasons will speak.', challenge: 'Choose one spot near you and record what has changed since last week.', challengeTag: '#WaldenSeasons', lensPrompt: 'seasonal change: buds, blooms, arrivals and departures' },
  leopold: { lifespan: '1887–1948', bio: 'Forester and author of A Sand County Almanac who proposed a "land ethic" of care for whole ecosystems.', philosophy: 'A thing is right when it preserves the integrity of the biotic community.', challenge: 'Show a healthy patch of land and one sign of how people care for it.', challengeTag: '#LandEthic', lensPrompt: 'ecosystem integrity and restoration' },
  emerson: { lifespan: '1803–1882', bio: 'Transcendentalist essayist who wrote that nature is a teacher and mirror for the human spirit.', philosophy: 'Nature always wears the colours of the spirit.', challenge: 'Capture a small natural detail that changed your mood today.', challengeTag: '#EmersonNature', lensPrompt: 'beauty in small details' },
  maathai: { lifespan: '1940–2011', bio: 'Founded the Green Belt Movement, which planted tens of millions of trees, and won the Nobel Peace Prize.', philosophy: 'Small acts, like planting a tree, add up to change.', challenge: 'Photograph a tree you love and tell its story, or plant one.', challengeTag: '#GreenBelt', lensPrompt: 'trees, their identity and their role for people and wildlife' },
  attenborough: { lifespan: 'b. 1926', bio: 'Broadcaster whose documentaries brought the wonder of life on Earth to billions.', philosophy: 'People protect what they have come to love.', challenge: 'Capture a behaviour (feeding, courting, hunting) and narrate it like a documentary.', challengeTag: '#LifeOnEarth', lensPrompt: 'behaviour told as a story' },
  cousteau: { lifespan: '1910–1997', bio: 'Ocean explorer who co-invented the Aqua-Lung and opened the underwater world to the public.', philosophy: 'The sea, once it casts its spell, holds one forever.', challenge: 'Find life in water: a pond, stream, rock pool or shore.', challengeTag: '#CousteauDeep', lensPrompt: 'aquatic and wetland life' },
  humboldt: { lifespan: '1769–1859', bio: 'Explorer-scientist who saw nature as one interconnected whole and mapped how life changes with altitude and climate.', philosophy: 'Everything is interaction and reciprocity.', challenge: 'Capture how plants or animals change from one habitat to another.', challengeTag: '#HumboldtWeb', lensPrompt: 'how climate, altitude and habitat shape life' },
  linnaeus: { lifespan: '1707–1778', bio: 'Created the two-part scientific naming system (binomial nomenclature) we still use for every species.', philosophy: 'To know a thing, first learn its true name.', challenge: 'Identify a species to its scientific name and share the field marks that prove it.', challengeTag: '#LinnaeusNames', lensPrompt: 'careful identification and field marks' },
  wilson: { lifespan: '1929–2021', bio: 'Biologist and ant expert who championed biodiversity and the idea that people are drawn to life ("biophilia").', philosophy: 'The little things run the world.', challenge: 'Get close to an insect, spider or other invertebrate and capture its world.', challengeTag: '#LittleThings', lensPrompt: 'insects and invertebrates' },
  earle: { lifespan: 'b. 1935', bio: 'Oceanographer and former NOAA chief scientist who campaigns for "Hope Spots" to protect the ocean.', philosophy: 'No water, no life. No blue, no green.', challenge: 'Share a "hope spot" near you: a place where nature is recovering.', challengeTag: '#HopeSpot', lensPrompt: 'recovery, water and hopeful signs' },
  carver: { lifespan: 'c.1864–1943', bio: 'Agricultural scientist who restored depleted soils with crop rotation and nitrogen-fixing plants.', philosophy: 'Look to the soil; it feeds everything.', challenge: 'Capture life in the soil or a useful plant growing in a garden or farm.', challengeTag: '#CarverSoil', lensPrompt: 'soil, fungi, roots and useful plants' },
  anning: { lifespan: '1799–1847', bio: 'Self-taught fossil hunter whose finds on the Jurassic Coast reshaped our understanding of prehistoric life.', philosophy: 'The rocks remember what lived before us.', challenge: 'Find traces of the past: fossils, old trees, shells or rock layers.', challengeTag: '#AnningTraces', lensPrompt: 'deep time, fossils and geology' },
  irwin: { lifespan: '1962–2006', bio: 'Wildlife conservationist whose enthusiasm made reptiles and misunderstood animals loved worldwide.', philosophy: 'Every creature, even the scary ones, deserves our respect.', challenge: 'Show a misunderstood animal (from a safe distance!) and one surprising fact about it.', challengeTag: '#CrikeyRespect', lensPrompt: 'reptiles, amphibians and misunderstood animals, from a safe distance' },
  kimmerer: { lifespan: 'b. 1953', bio: 'Botanist and Potawatomi author of Braiding Sweetgrass, uniting Indigenous wisdom and science.', philosophy: 'Reciprocity: what does the land give, and what can we give back?', challenge: 'Capture a plant that gives something to people and share how you could give back.', challengeTag: '#Reciprocity', lensPrompt: 'plants, mosses and gifts of the land' },
  merian: { lifespan: '1647–1717', bio: 'Artist-naturalist whose studies of metamorphosis in Suriname showed insects in their full life cycles.', philosophy: 'See the whole life cycle, not just a single moment.', challenge: 'Capture any life stage of an insect: egg, caterpillar, chrysalis or adult.', challengeTag: '#MerianMetamorphosis', lensPrompt: 'insect life stages and host plants' },
  ali: { lifespan: '1896–1987', bio: 'The "Birdman of India", whose systematic surveys founded Indian ornithology and inspired conservation.', philosophy: 'Know the birds and you will know the health of the land.', challenge: 'Spot and identify a bird, and note what it was doing.', challengeTag: '#SalimAliBirds', lensPrompt: 'birds, their calls and behaviour' },
  potter: { lifespan: '1866–1943', bio: 'Beloved author and illustrator who was also a serious mycologist and protected the Lake District.', philosophy: 'Wonder lives in hedgerows and woodland floors.', challenge: 'Find a fungus or a small woodland creature and sketch or photograph it. Look, never eat.', challengeTag: '#PotterWoodland', lensPrompt: 'fungi, mosses and small woodland life (never advise on edibility)' },
  audubon: { lifespan: '1785–1851', bio: 'Painted every bird he could find for The Birds of America, a landmark of natural history art.', philosophy: 'Observe closely enough to draw it from memory.', challenge: 'Capture a bird in a pose that shows its character.', challengeTag: '#AudubonPortrait', lensPrompt: 'bird plumage, posture and character' },
};

const FALLBACK: NaturalistExtra = {
  lifespan: '', bio: '', philosophy: 'Look closely. Nature rewards attention.',
  challenge: 'Share one thing in nature that surprised you this week.', challengeTag: '#NatureGram', lensPrompt: 'whatever is most alive in front of you',
};

export const getNaturalistExtra = (id?: string): NaturalistExtra => (id && NATURALIST_EXTRAS[id]) || FALLBACK;

const PERIOD_DAYS = 15.21;

/** Details of the current fortnightly naturalist period (matches getDailyTheme()). */
export const getThemePeriod = (now = new Date()) => {
  const yearStart = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - yearStart.getTime()) / 86_400_000);
  const slot = Math.floor(dayOfYear / PERIOD_DAYS);
  const index = slot % NATURALIST_THEMES.length;
  const nextStartDay = Math.ceil((slot + 1) * PERIOD_DAYS);
  const daysRemaining = Math.max(1, nextStartDay - dayOfYear);
  const nextIndex = (index + 1) % NATURALIST_THEMES.length;
  return {
    index,
    theme: NATURALIST_THEMES[index] as NaturalistTheme,
    daysRemaining,
    next: NATURALIST_THEMES[nextIndex] as NaturalistTheme,
  };
};
