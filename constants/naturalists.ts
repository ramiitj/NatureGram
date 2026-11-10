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

export interface ImageCredit {
  /** The photographer, as the file page credits them */
  author: string;
  /** Licence short name, e.g. "CC BY-SA 4.0", "CC0", "Public domain" */
  license: string;
  /** The Commons file page (attribution link) */
  source: string;
}

export interface NaturalistTheme {
  id: string;
  naturalist: string;
  quote: string;
  locationName: string;
  locationCaption: string;
  imageUrl?: string;
  /** Who made the photograph and under what licence (Wikimedia Commons); CC BY / BY-SA need it shown */
  imageCredit?: ImageCredit;
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
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Tensaw_at_Blakeley.jpg/1920px-Tensaw_at_Blakeley.jpg",
    imageCredit: { author: "JodyB", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Tensaw_at_Blakeley.jpg" },
    colors: colorsOf('wilson')
  },
  {
    id: 'wallace',
    naturalist: 'Alfred Russel Wallace',
    quote: "Nature seems to have taken every precaution that these, her choicest treasures, may not lose their value by being too easily obtained.",
    locationName: "Malay Archipelago",
    locationCaption: "Where he independently conceived the theory of evolution through natural selection.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Raja_Ampat_by_Max_Mossler.jpg/1920px-Raja_Ampat_by_Max_Mossler.jpg",
    imageCredit: { author: "Max Mossler", license: "CC BY 2.0", source: "https://commons.wikimedia.org/wiki/File:Raja_Ampat_by_Max_Mossler.jpg" },
    colors: colorsOf('wallace')
  },
  {
    id: 'audubon',
    naturalist: 'John James Audubon',
    quote: "A true conservationist is a man who knows that the world is not given by his fathers, but borrowed from his children.",
    locationName: "Mississippi River",
    locationCaption: "Where he painted the comprehensive Birds of America.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Mississippi_River_from_Great_River_Bluffs_State_Park%2C_Minnesota_%2837021472150%29.jpg/1920px-Mississippi_River_from_Great_River_Bluffs_State_Park%2C_Minnesota_%2837021472150%29.jpg",
    imageCredit: { author: "Tony Webster", license: "CC BY-SA 2.0", source: "https://commons.wikimedia.org/wiki/File:Mississippi_River_from_Great_River_Bluffs_State_Park,_Minnesota_(37021472150).jpg" },
    colors: colorsOf('audubon')
  },
  {
    id: 'goodall',
    naturalist: 'Jane Goodall',
    quote: "Only if we understand, will we care. Only if we care, will we help.",
    locationName: "Gombe Stream, Tanzania",
    locationCaption: "Where she revolutionized our understanding of primates.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Lake_Tanganyika_at_Gombe_Stream_National_Park.jpg/1920px-Lake_Tanganyika_at_Gombe_Stream_National_Park.jpg",
    imageCredit: { author: "fabulousfabs", license: "CC BY 2.0", source: "https://commons.wikimedia.org/wiki/File:Lake_Tanganyika_at_Gombe_Stream_National_Park.jpg" },
    colors: colorsOf('goodall')
  },
  {
    id: 'humboldt',
    naturalist: 'Alexander von Humboldt',
    quote: "Nature is a living whole, not a dead mass.",
    locationName: "Andes Mountains, South America",
    locationCaption: "Where he pioneered the field of biogeography.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Vicu%C3%B1a_-_Chimborazo%2C_Ecuador.jpg/1920px-Vicu%C3%B1a_-_Chimborazo%2C_Ecuador.jpg",
    imageCredit: { author: "David Torres Costales", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Vicu%C3%B1a_-_Chimborazo,_Ecuador.jpg" },
    colors: colorsOf('humboldt')
  },
  {
    id: 'maathai',
    naturalist: 'Wangari Maathai',
    quote: "When we plant trees, we plant the seeds of peace and seeds of hope.",
    locationName: "Nairobi, Kenya",
    locationCaption: "Where she founded the Green Belt Movement.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Karura_Forest_Nairobi_05.JPG/1920px-Karura_Forest_Nairobi_05.JPG",
    imageCredit: { author: "Ninaras", license: "CC BY 4.0", source: "https://commons.wikimedia.org/wiki/File:Karura_Forest_Nairobi_05.JPG" },
    colors: colorsOf('maathai')
  },
  {
    id: 'muir',
    naturalist: 'John Muir',
    quote: "In every walk with nature one receives far more than he seeks.",
    locationName: "Yosemite Valley, California",
    locationCaption: "Where his activism helped preserve the wilderness.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Tunnel_View%2C_Yosemite_Valley%2C_Yosemite_NP_-_Diliff.jpg/1920px-Tunnel_View%2C_Yosemite_Valley%2C_Yosemite_NP_-_Diliff.jpg",
    imageCredit: { author: "David Iliff", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Tunnel_View,_Yosemite_Valley,_Yosemite_NP_-_Diliff.jpg" },
    colors: colorsOf('muir')
  },
  {
    id: 'emerson',
    naturalist: 'Ralph Waldo Emerson',
    quote: "Adopt the pace of nature: her secret is patience.",
    locationName: "Concord, Massachusetts",
    locationCaption: "Where he led the Transcendentalist movement.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/20250726-_DSC0706.jpg/1920px-20250726-_DSC0706.jpg",
    imageCredit: { author: "Jmeola2025", license: "CC BY 4.0", source: "https://commons.wikimedia.org/wiki/File:20250726-_DSC0706.jpg" },
    colors: colorsOf('emerson')
  },
  {
    id: 'darwin',
    naturalist: 'Charles Darwin',
    quote: "It is not the strongest of the species that survives, nor the most intelligent, but the one most responsive to change.",
    locationName: "Galápagos Islands, Ecuador",
    locationCaption: "Where his observations led to the theory of evolution.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Lobo_marino_%28Zalophus_californianus_wollebaeki%29%2C_Punta_Pitt%2C_isla_de_San_Crist%C3%B3bal%2C_islas_Gal%C3%A1pagos%2C_Ecuador%2C_2015-07-24%2C_DD_11.JPG/1920px-Lobo_marino_%28Zalophus_californianus_wollebaeki%29%2C_Punta_Pitt%2C_isla_de_San_Crist%C3%B3bal%2C_islas_Gal%C3%A1pagos%2C_Ecuador%2C_2015-07-24%2C_DD_11.JPG",
    imageCredit: { author: "Diego Delso", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Lobo_marino_(Zalophus_californianus_wollebaeki),_Punta_Pitt,_isla_de_San_Crist%C3%B3bal,_islas_Gal%C3%A1pagos,_Ecuador,_2015-07-24,_DD_11.JPG" },
    colors: colorsOf('darwin')
  },
  {
    id: 'anning',
    naturalist: 'Mary Anning',
    quote: "The earth has music for those who listen.",
    locationName: "Jurassic Coast, England",
    locationCaption: "Where her fossil discoveries reshaped our understanding of Earth's history.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Durdle_Door_Overview.jpg/1920px-Durdle_Door_Overview.jpg",
    imageCredit: { author: "Saffron Blaze", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Durdle_Door_Overview.jpg" },
    colors: colorsOf('anning')
  },
  {
    id: 'carson',
    naturalist: 'Rachel Carson',
    quote: "Those who contemplate the beauty of the earth find reserves of strength that will endure as long as life lasts.",
    locationName: "Southport Island, Maine",
    locationCaption: "Where she studied the rocky Atlantic coast.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Pemaquid_Point_Light%2C_Bristol%2C_Maine_%2868723039%29.jpg/1920px-Pemaquid_Point_Light%2C_Bristol%2C_Maine_%2868723039%29.jpg",
    imageCredit: { author: "Ken Lund", license: "CC BY-SA 2.0", source: "https://commons.wikimedia.org/wiki/File:Pemaquid_Point_Light,_Bristol,_Maine_(68723039).jpg" },
    colors: colorsOf('carson')
  },
  {
    id: 'attenborough',
    naturalist: 'David Attenborough',
    quote: "It seems to me that the natural world is the greatest source of excitement; the greatest source of visual beauty.",
    locationName: "Serengeti, Tanzania",
    locationCaption: "Where his documentaries brought the wild to the world.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/Serengeti_landscape_%286%29_%2828551999591%29.jpg/1920px-Serengeti_landscape_%286%29_%2828551999591%29.jpg",
    imageCredit: { author: "Richard Mortel", license: "CC BY 2.0", source: "https://commons.wikimedia.org/wiki/File:Serengeti_landscape_(6)_(28551999591).jpg" },
    colors: colorsOf('attenborough')
  },
  {
    id: 'fossey',
    naturalist: 'Dian Fossey',
    quote: "When you realize the value of all life, you dwell less on what is past and concentrate more on the preservation of the future.",
    locationName: "Virunga Mountains, Rwanda",
    locationCaption: "Where she dedicated her life to mountain gorillas.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Mount_Mikeno_%28DR_Congo%29_and_Mount_Karisimbi_%28Rwanda%29%2C_two_extinct_volcanoes_in_the_Virunga_mountain_range._%2819556231290%29.jpg/1920px-Mount_Mikeno_%28DR_Congo%29_and_Mount_Karisimbi_%28Rwanda%29%2C_two_extinct_volcanoes_in_the_Virunga_mountain_range._%2819556231290%29.jpg",
    imageCredit: { author: "MONUSCO Photos", license: "CC BY-SA 2.0", source: "https://commons.wikimedia.org/wiki/File:Mount_Mikeno_(DR_Congo)_and_Mount_Karisimbi_(Rwanda),_two_extinct_volcanoes_in_the_Virunga_mountain_range._(19556231290).jpg" },
    colors: colorsOf('fossey')
  },
  {
    id: 'carver',
    naturalist: 'George Washington Carver',
    quote: "I love to think of nature as an unlimited broadcasting station, through which God speaks to us every hour.",
    locationName: "Tuskegee, Alabama",
    locationCaption: "Where he transformed agricultural science and sustainable farming.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/4/40/20230521-FS-DF-021_%2853125961003%29.jpg",
    imageCredit: { author: "US Forest Service, Southern Region", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:20230521-FS-DF-021_(53125961003).jpg" },
    colors: colorsOf('carver')
  },
  {
    id: 'earle',
    naturalist: 'Sylvia Earle',
    quote: "No water, no life. No blue, no green.",
    locationName: "Gulf of Mexico",
    locationCaption: "Where she led countless expeditions to protect the oceans.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/FGBNMS_-_diver_fish_circle_-_Emma_Hickerson_NOAA_%2827026785561%29.jpg/1920px-FGBNMS_-_diver_fish_circle_-_Emma_Hickerson_NOAA_%2827026785561%29.jpg",
    imageCredit: { author: "Emma Hickerson, NOAA", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:FGBNMS_-_diver_fish_circle_-_Emma_Hickerson_NOAA_(27026785561).jpg" },
    colors: colorsOf('earle')
  },
  {
    id: 'irwin',
    naturalist: 'Steve Irwin',
    quote: "If we can teach people about wildlife, they will be touched. Share my wildlife with me.",
    locationName: "Queensland, Australia",
    locationCaption: "Where his infectious enthusiasm made wildlife conservation accessible to the world.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Sunset_over_the_Glasshouse_Mountains.jpg/1920px-Sunset_over_the_Glasshouse_Mountains.jpg",
    imageCredit: { author: "Lucbruna", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Sunset_over_the_Glasshouse_Mountains.jpg" },
    colors: colorsOf('irwin')
  },
  {
    id: 'cousteau',
    naturalist: 'Jacques-Yves Cousteau',
    quote: "The sea, once it casts its spell, holds one in its net of wonder forever.",
    locationName: "The Red Sea",
    locationCaption: "Where he explored the silent world beneath the waves.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Ras_Mohammed_coral_reefs.jpg/1920px-Ras_Mohammed_coral_reefs.jpg",
    imageCredit: { author: "Sovernigo", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Ras_Mohammed_coral_reefs.jpg" },
    colors: colorsOf('cousteau')
  },
  {
    id: 'potter',
    naturalist: 'Beatrix Potter',
    quote: "There is something delicious about writing the first words of a story. You never quite know where they'll take you.",
    locationName: "Lake District, England",
    locationCaption: "Where her keen illustrations and mycology studies captured nature's intricate details.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Derwent_Water%2C_Lake_District%2C_Cumbria_-_June_2009.jpg/1920px-Derwent_Water%2C_Lake_District%2C_Cumbria_-_June_2009.jpg",
    imageCredit: { author: "David Iliff", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Derwent_Water,_Lake_District,_Cumbria_-_June_2009.jpg" },
    colors: colorsOf('potter')
  },
  {
    id: 'linnaeus',
    naturalist: 'Carl Linnaeus',
    quote: "If you do not know the names of things, the knowledge of them is lost too.",
    locationName: "Småland, Sweden",
    locationCaption: "Where the father of modern taxonomy began his botanical journey.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/R%C3%A5shult_5.jpg/1920px-R%C3%A5shult_5.jpg",
    imageCredit: { author: "Zejo", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:R%C3%A5shult_5.jpg" },
    colors: colorsOf('linnaeus')
  },
  {
    id: 'kimmerer',
    naturalist: 'Robin Wall Kimmerer',
    quote: "Knowing that you love the earth changes you, activates you to defend and protect and celebrate.",
    locationName: "Upstate New York",
    locationCaption: "Where she bridges traditional ecological knowledge and environmental botany.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/c/cb/Adirondacks_2016_Cascade_mountain_hike.jpg",
    imageCredit: { author: "stillwellmike", license: "CC BY-SA 2.0", source: "https://commons.wikimedia.org/wiki/File:Adirondacks_2016_Cascade_mountain_hike.jpg" },
    colors: colorsOf('kimmerer')
  },
  {
    id: 'merian',
    naturalist: 'Maria Sibylla Merian',
    quote: "In my youth, I spent my time investigating insects.",
    locationName: "Suriname",
    locationCaption: "Where her detailed illustrations documented the metamorphosis of insects.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Brownsberg_jungle_%2833153964880%29.jpg/1920px-Brownsberg_jungle_%2833153964880%29.jpg",
    imageCredit: { author: "JvL", license: "CC BY 2.0", source: "https://commons.wikimedia.org/wiki/File:Brownsberg_jungle_(33153964880).jpg" },
    colors: colorsOf('merian')
  },
  {
    id: 'ali',
    naturalist: 'Salim Ali',
    quote: "I suppose I have always been a watcher of birds.",
    locationName: "Bombay, India",
    locationCaption: "Where the 'Birdman of India' popularized ornithology across the subcontinent.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/View_of_Tulsi_Lake_%287202325106%29.jpg/1920px-View_of_Tulsi_Lake_%287202325106%29.jpg",
    imageCredit: { author: "Dinesh Valke", license: "CC BY-SA 2.0", source: "https://commons.wikimedia.org/wiki/File:View_of_Tulsi_Lake_(7202325106).jpg" },
    colors: colorsOf('ali')
  },
  {
    id: 'leopold',
    naturalist: 'Aldo Leopold',
    quote: "A thing is right when it tends to preserve the integrity, stability and beauty of the biotic community.",
    locationName: "Sauk County, Wisconsin",
    locationCaption: "Where he wrote 'A Sand County Almanac'.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Wisconsin_River_from_Ferry_Bluff_Hill.JPG/1920px-Wisconsin_River_from_Ferry_Bluff_Hill.JPG",
    imageCredit: { author: "Gripper", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Wisconsin_River_from_Ferry_Bluff_Hill.JPG" },
    colors: colorsOf('leopold')
  },
  {
    id: 'thoreau',
    naturalist: 'Henry David Thoreau',
    quote: "All good things are wild and free.",
    locationName: "Walden Pond, Massachusetts",
    locationCaption: "Where he lived in a cabin for two years in simple living.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Walden_Pond%2C_2010.jpg/1920px-Walden_Pond%2C_2010.jpg",
    imageCredit: { author: "ptwo", license: "CC BY 2.0", source: "https://commons.wikimedia.org/wiki/File:Walden_Pond,_2010.jpg" },
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
