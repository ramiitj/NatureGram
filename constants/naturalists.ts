import ROTATION from './palettes.json' with { type: 'json' };

/** The four designed tones of a naturalist's palette (constants/palettes.json). */
export interface NaturalistTones {
  /** Text and headings: at least 7:1 on the cream page (#fcfaf8) */
  deep: string;
  /** Buttons and filled surfaces: white text on it at least 4.5:1 */
  primary: string;
  /** Highlights, links, selected states: at least 4.5:1 on the cream page */
  accent: string;
  /** Glows, the orb, the favicon: decorative only, never for text */
  vivid: string;
}

export interface NaturalistTheme {
  id: string;
  naturalist: string;
  quote: string;
  locationName: string;
  locationCaption: string;
  imageUrl?: string;
  colors: {
    primary: string;
    /** Gradient end of the landing disc and the favicon */
    primaryGradient: string;
    /** The deep tone (dark surfaces, the browser chrome) */
    shadow: string;
    /** Pale tint for text on dark theme surfaces */
    text: string;
    accent: string;
    /** Designed tones; older stored themes may lack them */
    deep?: string;
    vivid?: string;
  };
}

type Palette = NaturalistTones & { story: string; gradient: string; text: string };
const PALETTES = ROTATION.palettes as Record<string, Palette>;

const colorsOf = (id: string): NaturalistTheme['colors'] => {
  const p = PALETTES[id];
  return { primary: p.primary, primaryGradient: p.gradient, shadow: p.deep, text: p.text, accent: p.accent, deep: p.deep, vivid: p.vivid };
};

/**
 * The naturalists in rotation order (constants/palettes.json "order"): consecutive fortnights are at
 * least 90 degrees apart in hue, so every change of naturalist is a change of colour.
 */
export const NATURALIST_THEMES: NaturalistTheme[] = [
  {
    id: 'wilson',
    naturalist: 'E.O. Wilson',
    quote: "Nature holds the key to our aesthetic, intellectual, cognitive and even spiritual satisfaction.",
    locationName: "Mobile, Alabama",
    locationCaption: "Where his childhood passion for ants inspired a lifetime of evolutionary biology.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Tensaw_at_Blakeley.jpg/1280px-Tensaw_at_Blakeley.jpg",
    colors: colorsOf('wilson')
  },
  {
    id: 'wallace',
    naturalist: 'Alfred Russel Wallace',
    quote: "Nature seems to have taken every precaution that these, her choicest treasures, may not lose their value by being too easily obtained.",
    locationName: "Malay Archipelago",
    locationCaption: "Where he independently conceived the theory of evolution through natural selection.",
    imageUrl: "https://images.unsplash.com/photo-1542332213-9b5a5a3fad35?auto=format&fit=crop&q=80&w=1280",
    colors: colorsOf('wallace')
  },
  {
    id: 'audubon',
    naturalist: 'John James Audubon',
    quote: "A true conservationist is a man who knows that the world is not given by his fathers, but borrowed from his children.",
    locationName: "Mississippi River",
    locationCaption: "Where he painted the comprehensive Birds of America.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Efmo_View_from_Fire_Point.jpg/1280px-Efmo_View_from_Fire_Point.jpg",
    colors: colorsOf('audubon')
  },
  {
    id: 'goodall',
    naturalist: 'Jane Goodall',
    quote: "Only if we understand, will we care. Only if we care, will we help.",
    locationName: "Gombe Stream, Tanzania",
    locationCaption: "Where she revolutionized our understanding of primates.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Gombe_Stream_NP_Mutter_und_Kind.jpg/1280px-Gombe_Stream_NP_Mutter_und_Kind.jpg",
    colors: colorsOf('goodall')
  },
  {
    id: 'humboldt',
    naturalist: 'Alexander von Humboldt',
    quote: "Nature is a living whole, not a dead mass.",
    locationName: "Andes Mountains, South America",
    locationCaption: "Where he pioneered the field of biogeography.",
    imageUrl: "https://images.unsplash.com/photo-1501854140801-50d01698950b?auto=format&fit=crop&q=80&w=1280",
    colors: colorsOf('humboldt')
  },
  {
    id: 'maathai',
    naturalist: 'Wangari Maathai',
    quote: "When we plant trees, we plant the seeds of peace and seeds of hope.",
    locationName: "Nairobi, Kenya",
    locationCaption: "Where she founded the Green Belt Movement.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Karura_Forest_Nairobi_05.JPG/1280px-Karura_Forest_Nairobi_05.JPG",
    colors: colorsOf('maathai')
  },
  {
    id: 'muir',
    naturalist: 'John Muir',
    quote: "In every walk with nature one receives far more than he seeks.",
    locationName: "Yosemite Valley, California",
    locationCaption: "Where his activism helped preserve the wilderness.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Tunnel_View%2C_Yosemite_Valley%2C_Yosemite_NP_-_Diliff.jpg/1280px-Tunnel_View%2C_Yosemite_Valley%2C_Yosemite_NP_-_Diliff.jpg",
    colors: colorsOf('muir')
  },
  {
    id: 'emerson',
    naturalist: 'Ralph Waldo Emerson',
    quote: "Adopt the pace of nature: her secret is patience.",
    locationName: "Concord, Massachusetts",
    locationCaption: "Where he led the Transcendentalist movement.",
    imageUrl: "https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&q=80&w=1280",
    colors: colorsOf('emerson')
  },
  {
    id: 'darwin',
    naturalist: 'Charles Darwin',
    quote: "It is not the strongest of the species that survives, nor the most intelligent, but the one most responsive to change.",
    locationName: "Galápagos Islands, Ecuador",
    locationCaption: "Where his observations led to the theory of evolution.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Lobo_marino_%28Zalophus_californianus_wollebaeki%29%2C_Punta_Pitt%2C_isla_de_San_Crist%C3%B3bal%2C_islas_Gal%C3%A1pagos%2C_Ecuador%2C_2015-07-24%2C_DD_11.JPG/1280px-Lobo_marino_%28Zalophus_californianus_wollebaeki%29%2C_Punta_Pitt%2C_isla_de_San_Crist%C3%B3bal%2C_islas_Gal%C3%A1pagos%2C_Ecuador%2C_2015-07-24%2C_DD_11.JPG",
    colors: colorsOf('darwin')
  },
  {
    id: 'anning',
    naturalist: 'Mary Anning',
    quote: "The earth has music for those who listen.",
    locationName: "Jurassic Coast, England",
    locationCaption: "Where her fossil discoveries reshaped our understanding of Earth's history.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Durdle_Door_Overview.jpg/1280px-Durdle_Door_Overview.jpg",
    colors: colorsOf('anning')
  },
  {
    id: 'carson',
    naturalist: 'Rachel Carson',
    quote: "Those who contemplate the beauty of the earth find reserves of strength that will endure as long as life lasts.",
    locationName: "Southport Island, Maine",
    locationCaption: "Where she studied the rocky Atlantic coast.",
    imageUrl: "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&q=80&w=1280",
    colors: colorsOf('carson')
  },
  {
    id: 'attenborough',
    naturalist: 'David Attenborough',
    quote: "It seems to me that the natural world is the greatest source of excitement; the greatest source of visual beauty.",
    locationName: "Serengeti, Tanzania",
    locationCaption: "Where his documentaries brought the wild to the world.",
    imageUrl: "https://images.unsplash.com/photo-1516426122078-c23e76319801?auto=format&fit=crop&q=80&w=1280",
    colors: colorsOf('attenborough')
  },
  {
    id: 'fossey',
    naturalist: 'Dian Fossey',
    quote: "When you realize the value of all life, you dwell less on what is past and concentrate more on the preservation of the future.",
    locationName: "Virunga Mountains, Rwanda",
    locationCaption: "Where she dedicated her life to mountain gorillas.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Virunga_National_Park_Landscape.jpg/1280px-Virunga_National_Park_Landscape.jpg",
    colors: colorsOf('fossey')
  },
  {
    id: 'carver',
    naturalist: 'George Washington Carver',
    quote: "I love to think of nature as an unlimited broadcasting station, through which God speaks to us every hour.",
    locationName: "Tuskegee, Alabama",
    locationCaption: "Where he transformed agricultural science and sustainable farming.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/George_Washington_Carver_Museum.jpg/1280px-George_Washington_Carver_Museum.jpg",
    colors: colorsOf('carver')
  },
  {
    id: 'earle',
    naturalist: 'Sylvia Earle',
    quote: "No water, no life. No blue, no green.",
    locationName: "Gulf of Mexico",
    locationCaption: "Where she led countless expeditions to protect the oceans.",
    imageUrl: "https://images.unsplash.com/photo-1582967788606-a171c1080cb0?auto=format&fit=crop&q=80&w=1280",
    colors: colorsOf('earle')
  },
  {
    id: 'irwin',
    naturalist: 'Steve Irwin',
    quote: "If we can teach people about wildlife, they will be touched. Share my wildlife with me.",
    locationName: "Queensland, Australia",
    locationCaption: "Where his infectious enthusiasm made wildlife conservation accessible to the world.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Part_of_Great_Barrier_Reef_from_Helicopter.jpg/1280px-Part_of_Great_Barrier_Reef_from_Helicopter.jpg",
    colors: colorsOf('irwin')
  },
  {
    id: 'cousteau',
    naturalist: 'Jacques-Yves Cousteau',
    quote: "The sea, once it casts its spell, holds one in its net of wonder forever.",
    locationName: "The Red Sea",
    locationCaption: "Where he explored the silent world beneath the waves.",
    imageUrl: "https://images.unsplash.com/photo-1546026423-cc4642628d2b?auto=format&fit=crop&q=80&w=1280",
    colors: colorsOf('cousteau')
  },
  {
    id: 'potter',
    naturalist: 'Beatrix Potter',
    quote: "There is something delicious about writing the first words of a story. You never quite know where they'll take you.",
    locationName: "Lake District, England",
    locationCaption: "Where her keen illustrations and mycology studies captured nature's intricate details.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Derwent_Water%2C_Lake_District%2C_Cumbria_-_June_2009.jpg/1280px-Derwent_Water%2C_Lake_District%2C_Cumbria_-_June_2009.jpg",
    colors: colorsOf('potter')
  },
  {
    id: 'linnaeus',
    naturalist: 'Carl Linnaeus',
    quote: "If you do not know the names of things, the knowledge of them is lost too.",
    locationName: "Småland, Sweden",
    locationCaption: "Where the father of modern taxonomy began his botanical journey.",
    imageUrl: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&q=80&w=1280",
    colors: colorsOf('linnaeus')
  },
  {
    id: 'kimmerer',
    naturalist: 'Robin Wall Kimmerer',
    quote: "Knowing that you love the earth changes you, activates you to defend and protect and celebrate.",
    locationName: "Upstate New York",
    locationCaption: "Where she bridges traditional ecological knowledge and environmental botany.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Adirondacks_2016_Cascade_mountain_hike.jpg/1280px-Adirondacks_2016_Cascade_mountain_hike.jpg",
    colors: colorsOf('kimmerer')
  },
  {
    id: 'merian',
    naturalist: 'Maria Sibylla Merian',
    quote: "In my youth, I spent my time investigating insects.",
    locationName: "Suriname",
    locationCaption: "Where her detailed illustrations documented the metamorphosis of insects.",
    imageUrl: "https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?auto=format&fit=crop&q=80&w=1280",
    colors: colorsOf('merian')
  },
  {
    id: 'ali',
    naturalist: 'Salim Ali',
    quote: "I suppose I have always been a watcher of birds.",
    locationName: "Bombay, India",
    locationCaption: "Where the 'Birdman of India' popularized ornithology across the subcontinent.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/4/4b/SGNP-Bombay.jpg",
    colors: colorsOf('ali')
  },
  {
    id: 'leopold',
    naturalist: 'Aldo Leopold',
    quote: "A thing is right when it tends to preserve the integrity, stability and beauty of the biotic community.",
    locationName: "Sauk County, Wisconsin",
    locationCaption: "Where he wrote 'A Sand County Almanac'.",
    imageUrl: "https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?auto=format&fit=crop&q=80&w=1280",
    colors: colorsOf('leopold')
  },
  {
    id: 'thoreau',
    naturalist: 'Henry David Thoreau',
    quote: "All good things are wild and free.",
    locationName: "Walden Pond, Massachusetts",
    locationCaption: "Where he lived in a cabin for two years in simple living.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Walden_Pond_outlook.jpg/1280px-Walden_Pond_outlook.jpg",
    colors: colorsOf('thoreau')
  }
];

const BY_ID = new Map(NATURALIST_THEMES.map(t => [t.id, t]));

/**
 * The order the rotation used before ROTATION_CUTOVER. Past fortnights (challenge stamps, the
 * naturalist a life-list entry was first seen under) keep the naturalist they really had.
 */
export const LEGACY_THEMES: NaturalistTheme[] = (ROTATION.legacyOrder as string[]).map(id => BY_ID.get(id)!);

export const PERIOD_DAYS: number = ROTATION.periodDays;

/** Local midnight on the first day of the new order (the start of a fortnight). */
export const ROTATION_CUTOVER: Date = (() => {
  const [y, m, d] = String(ROTATION.cutover).split('-').map(Number);
  return new Date(y, m - 1, d);
})();

/**
 * Where a moment falls in the rotation. The rotation restarts every 1 January; a period is
 * ~15.21 days, so the year holds 24 of them (a leap year's 31 December opens a 25th that wears
 * the first naturalist, who also opens the next year).
 */
export const rotationAt = (when: Date | number = new Date()) => {
  const now = typeof when === 'number' ? new Date(when) : when;
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000);
  const slot = Math.floor(dayOfYear / PERIOD_DAYS);
  const order = now >= ROTATION_CUTOVER ? NATURALIST_THEMES : LEGACY_THEMES;
  const index = slot % order.length;
  return { dayOfYear, slot, index, theme: order[index] };
};

/** The naturalist of a moment (today by default). */
export const themeAt = (when: Date | number = new Date()): NaturalistTheme => rotationAt(when).theme;

export const getDailyTheme = (): NaturalistTheme => themeAt(new Date());
