import React from 'react';

/**
 * NatureGram's own line-art glyphs for the places where a stock icon read too literally
 * (a recycling leaf for the life list, a cardboard box for drafts, a robot for the guide).
 * Drawn on a 24px grid with a 1.5px stroke so they sit beside Material Symbols without clashing,
 * and inherit `currentColor` so they follow the fortnight's theme.
 */
export type GlyphName =
  | 'notebook'      // the journal / field notebook
  | 'fern'          // the life list (a pressed frond)
  | 'press'         // kept sightings (herbarium press)
  | 'lens'          // the hand lens
  | 'letter'        // letters (envelope with a wax seal)
  | 'tracks'        // activity (bird tracks)
  | 'tag'           // specimen tag / identification
  | 'satchel'       // drafts
  | 'guide'         // the AI naturalist (a breathing dot inside a ring)
  | 'compass'       // explore
  | 'feather'       // writing / field note
  | 'stamp'         // challenge stamp
  | 'plate'         // a specimen plate
  | 'sun'           // season / time of day
  | 'binoculars'    // spotting
  | 'leaf'          // plants
  | 'bird'          // birds
  | 'insect'        // insects
  | 'mushroom'      // fungi
  | 'paw'           // mammals
  | 'fish'          // fish & water life
  | 'frog'          // amphibians & reptiles
  | 'shell'         // molluscs & other life
  | 'sound'         // sound sightings
  | 'mark'          // NatureGram's own mark (a sun rising over an opening leaf)
  | 'signpost'      // off the trail (errors, wrong turns)
  | 'key';          // a field-station key (password reset)

const P: Record<GlyphName, React.ReactNode> = {
  notebook: <><path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6z" /><path d="M6 3.5v17M4 7h3M4 12h3M4 17h3" /><path d="M10 8h5M10 11h4" /></>,
  fern: <><path d="M12 21V4" /><path d="M12 7c-2-1-3.5-1-5 0M12 7c2-1 3.5-1 5 0M12 11c-2.5-1.2-4.5-1-6 .3M12 11c2.5-1.2 4.5-1 6 .3M12 15c-2.5-1-4.5-.6-5.6.8M12 15c2.5-1 4.5-.6 5.6.8" /></>,
  press: <><rect x="3.5" y="15" width="17" height="4" rx="1" /><rect x="3.5" y="5" width="17" height="4" rx="1" /><path d="M7 9v6M17 9v6" /><path d="M12 11.2c-1 .3-1.8 1-2 1.8 1 .2 1.8 0 2-.8.2.8 1 1 2 .8-.2-.8-1-1.5-2-1.8z" /></>,
  lens: <><circle cx="10" cy="10" r="5.5" /><path d="M14 14l6 6" /><path d="M7.5 9a3 3 0 0 1 2-2" /></>,
  letter: <><rect x="3.5" y="6" width="17" height="12" rx="1.5" /><path d="M4 7l8 6 8-6" /><circle cx="12" cy="15.5" r="2" /></>,
  tracks: <><path d="M7 20v-3M7 17l-2-2.5M7 17l2-2.5M7 17v-1" /><path d="M16 11V8M16 8l-2-2.5M16 8l2-2.5" /><circle cx="7" cy="20.5" r=".4" /><circle cx="16" cy="11.5" r=".4" /></>,
  tag: <><path d="M3.5 12.5V5a1.5 1.5 0 0 1 1.5-1.5h7.5l8 8-9 9z" /><circle cx="8" cy="8" r="1.4" /><path d="M10 14l3-3M12 16l2-2" /></>,
  satchel: <><path d="M4 9h16v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" /><path d="M9 9V6.5a3 3 0 0 1 6 0V9" /><path d="M4 9l3 5h10l3-5" /><path d="M12 14v2" /></>,
  guide: <><circle cx="12" cy="12" r="8.5" strokeDasharray="2.5 2.5" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></>,
  compass: <><circle cx="12" cy="12" r="8.5" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
  feather: <><path d="M20 4c-7 0-12 5-12 12v4" /><path d="M20 4c0 7-4 11-10 12" /><path d="M8 16l-3 3" /><path d="M12 12l-3 1M15 9l-3 1" /></>,
  stamp: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5.5" strokeDasharray="1.5 1.8" /><path d="M9.5 12l1.8 1.8 3.3-3.6" /></>,
  plate: <><rect x="4" y="3" width="16" height="18" rx="1" /><rect x="6.5" y="5.5" width="11" height="9" /><path d="M7 17.5h10M9 19.2h6" /></>,
  sun: <><circle cx="12" cy="12" r="3.8" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
  binoculars: <><circle cx="7" cy="15.5" r="3.5" /><circle cx="17" cy="15.5" r="3.5" /><path d="M10.5 15.5h3M5 12l1.5-6h3l.5 6M19 12l-1.5-6h-3l-.5 6" /></>,
  leaf: <><path d="M5 19C5 10 11 5 20 4c0 9-5 15-14 15z" /><path d="M5 19l9-9" /></>,
  bird: <><path d="M4 13c2-.5 3.5 0 4.5 1.5C10 9 14 7 17 7.5l3-1.5-1 3c0 5-4.5 8.5-10 8.5-2.5 0-4-1.5-5-4.5z" /><circle cx="16.5" cy="9.5" r=".5" /><path d="M10 17.5l-1 3M13 17.5l.5 3" /></>,
  insect: <><ellipse cx="12" cy="14" rx="3" ry="5" /><circle cx="12" cy="7.5" r="1.8" /><path d="M10.5 6l-2-2.5M13.5 6l2-2.5M9 12l-4-2M15 12l4-2M9 15H4.5M15 15h4.5M9.5 18l-3 2.5M14.5 18l3 2.5" /></>,
  mushroom: <><path d="M3.5 12a8.5 6.5 0 0 1 17 0z" /><path d="M9.5 12v6.5a2.5 2.5 0 0 0 5 0V12" /><circle cx="9" cy="9" r=".6" /><circle cx="14.5" cy="8" r=".6" /></>,
  paw: <><ellipse cx="12" cy="16" rx="3.8" ry="3" /><circle cx="6.5" cy="11" r="1.6" /><circle cx="9.5" cy="7" r="1.6" /><circle cx="14.5" cy="7" r="1.6" /><circle cx="17.5" cy="11" r="1.6" /></>,
  fish: <><path d="M3.5 12c3-4.5 9-5.5 13 0-4 5.5-10 4.5-13 0z" /><path d="M16.5 12l4-3v6z" /><circle cx="7.5" cy="11.2" r=".5" /></>,
  frog: <><path d="M5 15c0-4 3-6.5 7-6.5s7 2.5 7 6.5c0 2-2 3.5-7 3.5S5 17 5 15z" /><circle cx="8.5" cy="8" r="2" /><circle cx="15.5" cy="8" r="2" /><path d="M9.5 14.5c1.5 1 3.5 1 5 0M5 17l-2 2.5M19 17l2 2.5" /></>,
  shell: <><path d="M12 20c-5 0-8-3.5-8-7.5C4 8 8 4 12 4s8 4 8 8.5c0 4-3 7.5-8 7.5z" /><path d="M12 20V4M12 20l-5-13M12 20l5-13" /></>,
  sound: <><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></>,
  mark: <><circle cx="12" cy="8.5" r="3" /><path d="M12 3v1.2M7.6 4.9l.8.8M16.4 4.9l-.8.8M5.8 8.5h1.2M17 8.5h1.2" /><path d="M12 21c-3.6-1-6.2-3.8-6.2-7.2 2.8 0 5.1 1.2 6.2 3.2 1.1-2 3.4-3.2 6.2-3.2 0 3.4-2.6 6.2-6.2 7.2z" /><path d="M12 21v-4" /></>,
  signpost: <><path d="M12 21V3.5" /><path d="M12 5.5h6.2l2 2-2 2H12" /><path d="M12 11.5H5.8l-2 2 2 2H12" /><path d="M8.5 21h7" /></>,
  key: <><circle cx="8" cy="16" r="4.5" /><circle cx="8" cy="16" r="1.3" /><path d="M11.2 12.8L20 4M15.5 8.5l2.5 2.5M18 6l2 2" /></>,
};

export const Glyph: React.FC<{ name: GlyphName; className?: string; size?: number; strokeWidth?: number; title?: string }> = ({ name, className = '', size = 22, strokeWidth = 1.5, title }) => (
  <svg
    viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    className={`inline-block shrink-0 ${className}`}
    role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}
  >
    {title ? <title>{title}</title> : null}
    {P[name]}
  </svg>
);

export default Glyph;
