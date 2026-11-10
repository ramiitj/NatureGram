import React from 'react';

/**
 * NatureGram's own line-art glyphs for the places where a stock icon read too literally
 * (a recycling leaf for the life list, a cardboard box for drafts, a robot for the guide).
 * Drawn on a 24px grid with a 1.5px stroke and round caps, the same hand as the landing's sun mark.
 * This is the app's one icon family: every control, menu and empty state draws from it.
 * Sizes: 20 inline with text, 24 in bars. They inherit `currentColor`; `filled` fills the shape
 * (an active Keep, a playing mark) without changing the line.
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
  | 'mark'          // NatureGram's own mark (the landing page's sun)
  | 'signpost'      // off the trail (errors, wrong turns)
  | 'key'          // a field-station key (password reset)
  | 'seal'          // audit & security (a wax seal with a keyhole)
  | 'scales'        // allowances and limits (a balance)
  // The explorer's day: go out, notice, record, grow, share (navigation and header)
  | 'meadow'        // Wild: grasses leaning in the wind
  | 'firefly'       // Moments: a streak of light you only see for a second
  | 'eyeEar'        // Lens: the guide sees and hears with you
  | 'rings'         // Journal: a ring for every year, the record growing outward
  | 'seedling'      // You: growing with every sighting
  | 'ripples'       // Activity: someone touched your work and it spread
  | 'leafCompass'   // Explore: a compass whose needle is a leaf
  | 'sealed'        // Letters: a wax-sealed letter, meant for one person
  | 'spark'         // Marvel: the jolt of "I had never seen that"
  // The working set: the same 1.5 line and round caps, for every control in the app
  | 'close' | 'back' | 'forward' | 'chevronLeft' | 'chevronRight' | 'chevronDown' | 'chevronUp'
  | 'more' | 'menu' | 'search' | 'filter' | 'share' | 'keep' | 'play' | 'pause' | 'stop'
  | 'soundOn' | 'soundOff' | 'pin' | 'check' | 'checkCircle' | 'plus' | 'plusCircle' | 'minus'
  | 'settings' | 'signOut' | 'trash' | 'flag' | 'edit' | 'lock' | 'globe' | 'person' | 'block'
  | 'shield' | 'link' | 'download' | 'upload' | 'image' | 'gallery' | 'stack' | 'camera' | 'video'
  | 'mic' | 'micOff' | 'torch' | 'torchOff' | 'rotate' | 'alert' | 'clock' | 'offline' | 'eye'
  | 'eyeOff' | 'grid' | 'lines' | 'bell' | 'ear' | 'landscape' | 'dawn' | 'moon' | 'info' | 'list'
  | 'chart' | 'people' | 'mailOpen' | 'external' | 'copy' | 'help';

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
  mark: <><circle cx="12" cy="12" r="3.7" fill="currentColor" /><path d="M12 3.2v2.4M12 18.4v2.4M3.2 12h2.4M18.4 12h2.4M5.8 5.8l1.7 1.7M16.5 16.5l1.7 1.7M5.8 18.2l1.7-1.7M16.5 7.5l1.7-1.7" strokeWidth={2} /></>,
  signpost: <><path d="M12 21V3.5" /><path d="M12 5.5h6.2l2 2-2 2H12" /><path d="M12 11.5H5.8l-2 2 2 2H12" /><path d="M8.5 21h7" /></>,
  key: <><circle cx="8" cy="16" r="4.5" /><circle cx="8" cy="16" r="1.3" /><path d="M11.2 12.8L20 4M15.5 8.5l2.5 2.5M18 6l2 2" /></>,
  seal: <><circle cx="12" cy="9.5" r="6.5" /><circle cx="12" cy="9.5" r="4.2" strokeDasharray="1.4 1.6" /><circle cx="12" cy="8.7" r="1.1" /><path d="M12 9.8v1.8M9 15.3 7.8 21l2.4-1.4L12 21l1.8-1.4 2.4 1.4L15 15.3" /></>,
  scales: <><path d="M12 4v15.5M8.5 20h7M5 7h14M12 4.5l-1 2.5h2z" /><path d="M7 7.5 4.5 13h5zM17 7.5 14.5 13h5z" /><path d="M4.5 13a2.5 1.8 0 0 0 5 0M14.5 13a2.5 1.8 0 0 0 5 0" /></>,
  meadow: <><path d="M3 20.5h18" /><path d="M6 20.5c0-4 .8-7 2.6-9.5M9.5 20.5c0-5.5 1-9.5 3.2-13M13.5 20.5c0-4 1.4-7 4-9M17.5 20.5c0-2.5.6-4.3 1.9-5.6" /></>,
  firefly: <><path d="M3.5 19c3-.6 5-3 6.2-6.4S13.4 6.5 16.6 6.2" strokeDasharray="1.2 2.6" /><circle cx="17.6" cy="6" r="1.7" fill="currentColor" /><circle cx="17.6" cy="6" r="3.6" opacity=".35" /></>,
  eyeEar: <><path d="M2.5 12s3-5.5 8-5.5 8 5.5 8 5.5-3 5.5-8 5.5-8-5.5-8-5.5z" /><circle cx="10.5" cy="12" r="2.2" /><path d="M20 8.5c1 1 1.5 2.2 1.5 3.5s-.5 2.5-1.5 3.5" /></>,
  rings: <><path d="M12 3.5c4.8 0 8.5 3.8 8.5 8.6s-3.8 8.4-8.5 8.4-8.5-3.7-8.5-8.5S7.2 3.5 12 3.5z" /><path d="M12 6.8c3 0 5.3 2.3 5.3 5.2s-2.4 5.2-5.3 5.2S6.7 15 6.7 12 9 6.8 12 6.8z" /><circle cx="12" cy="12" r="2" /><path d="M14 12.6 20 14.6" /></>,
  seedling: <><path d="M4 20.5h16M12 20.5v-7" /><path d="M12 13.5c-4 0-6.2-2.1-6.2-5.4 3.7 0 6.2 1.9 6.2 5.4zM12 11.6c0-3.6 2.3-5.8 6.2-5.8 0 3.7-2.4 5.8-6.2 5.8z" /></>,
  ripples: <><circle cx="12" cy="12" r="1.6" fill="currentColor" /><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" /></>,
  leafCompass: <><circle cx="12" cy="12" r="8.5" /><path d="M8.2 15.8c0-4.4 3.2-7.6 7.6-7.6 0 4.4-3.2 7.6-7.6 7.6zM8.2 15.8l7.6-7.6" /><path d="M12 2.5v1.8M12 19.7v1.8" /></>,
  sealed: <><rect x="3.5" y="6" width="17" height="12" rx="1.5" /><path d="M4 7l8 6 8-6" /><circle cx="12" cy="15.5" r="2" fill="currentColor" /></>,
  spark: <><path d="M12 3.5c.6 4.4 2.2 6 6.5 6.5-4.3.5-5.9 2.1-6.5 6.5-.6-4.4-2.2-6-6.5-6.5 4.3-.5 5.9-2.1 6.5-6.5z" /></>,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  back: <path d="M19 12H5.5M11 6l-6 6 6 6" />,
  forward: <path d="M5 12h13.5M13 6l6 6-6 6" />,
  chevronLeft: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  chevronRight: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  chevronDown: <path d="M5.5 9.5 12 16l6.5-6.5" />,
  chevronUp: <path d="M5.5 14.5 12 8l6.5 6.5" />,
  more: <><circle cx="5.5" cy="12" r="1.25" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.25" fill="currentColor" stroke="none" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></>,
  filter: <><path d="M4 7.5h8.5M17.5 7.5H20M4 16.5h2.5M11.5 16.5H20" /><circle cx="15" cy="7.5" r="2.25" /><circle cx="9" cy="16.5" r="2.25" /></>,
  share: <><path d="M12 3.5V15M8 7.5l4-4 4 4" /><path d="M7.5 10.5H6.5A1.5 1.5 0 0 0 5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7a1.5 1.5 0 0 0-1.5-1.5h-1" /></>,
  // Kept: a five-petalled flower pressed flat, as in the herbarium
  keep: <><circle cx="12" cy="12" r="1.9" />{[0, 72, 144, 216, 288].map(a => <path key={a} transform={`rotate(${a} 12 12)`} d="M12 9.6c-1.9-1.4-2.4-4.3 0-6.1 2.4 1.8 1.9 4.7 0 6.1z" />)}</>,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  pause: <path d="M9 6v12M15 6v12" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />,
  soundOn: <><path d="M4 9.5h3l4.5-4v13L7 14.5H4z" /><path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.6a7.6 7.6 0 0 1 0 10.8" /></>,
  soundOff: <><path d="M4 9.5h3l4.5-4v13L7 14.5H4z" /><path d="M15.5 9.5l5 5M20.5 9.5l-5 5" /></>,
  pin: <><path d="M12 21s-6.5-5.9-6.5-11a6.5 6.5 0 0 1 13 0c0 5.1-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.2" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  checkCircle: <><circle cx="12" cy="12" r="8.5" /><path d="M8.3 12.3l2.5 2.5 4.9-5.3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  plusCircle: <><circle cx="12" cy="12" r="8.5" /><path d="M12 8.5v7M8.5 12h7" /></>,
  minus: <path d="M5 12h14" />,
  settings: <><circle cx="12" cy="12" r="2.4" /><circle cx="12" cy="12" r="6" /><path d="M12 3.5V6M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6" /></>,
  signOut: <><path d="M13.5 4.5h-7A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5h7" /><path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5" /></>,
  trash: <><path d="M4.5 7h15M9.5 7V4.5h5V7" /><path d="M6.5 7l.9 12.1A1.5 1.5 0 0 0 8.9 20.5h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10.2 11v5.5M13.8 11v5.5" /></>,
  flag: <><path d="M5.5 21V4" /><path d="M5.5 4.8c4.3-2.1 6.8 2.1 12 0v8.4c-5.2 2.1-7.7-2.1-12 0" /></>,
  edit: <><path d="M4.5 19.5l1-4.5L15.6 4.9a2.1 2.1 0 0 1 3 3L8.5 18z" /><path d="M13.5 7l3 3" /></>,
  lock: <><rect x="5.5" y="10.5" width="13" height="10" rx="1.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.4 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.4-3.5-8.5s1.1-6.1 3.5-8.5z" /></>,
  person: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5" /></>,
  block: <><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>,
  shield: <path d="M12 3.5l7 2.6v5.4c0 4.4-2.9 7.7-7 9-4.1-1.3-7-4.6-7-9V6.1z" />,
  link: <path d="M10 14a3.8 3.8 0 0 0 5.4 0l3-3A3.8 3.8 0 0 0 13 5.6l-1 1M14 10a3.8 3.8 0 0 0-5.4 0l-3 3a3.8 3.8 0 0 0 5.4 5.4l1-1" />,
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  upload: <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 19.5h14" />,
  image: <><rect x="3.5" y="5" width="17" height="14" rx="1.5" /><circle cx="9" cy="10" r="1.5" /><path d="M4 17.5l5-4.5 3.5 3 3-2.5 4.5 4" /></>,
  gallery: <><rect x="7" y="3.5" width="13.5" height="12.5" rx="1.5" /><path d="M3.5 7.5V19a1.5 1.5 0 0 0 1.5 1.5h11.5" /><path d="M7.5 14l3.5-3 2.5 2 2.5-2 4 3.3" /></>,
  stack: <><rect x="8" y="8" width="12.5" height="12.5" rx="1.5" /><path d="M16 4.5H5A1.5 1.5 0 0 0 3.5 6v10" /></>,
  camera: <><path d="M4 8h3l1.8-2.5h6.4L17 8h3a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.3" r="3.5" /></>,
  video: <><rect x="3" y="6.5" width="12.5" height="11" rx="1.5" /><path d="M15.5 10.5l5.5-3v9l-5.5-3" /></>,
  mic: <><rect x="9" y="3.5" width="6" height="10.5" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3" /></>,
  micOff: <><rect x="9" y="3.5" width="6" height="10.5" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3M4 4l16 16" /></>,
  torch: <><path d="M8.5 3.5h7v3l-1.8 3.2V20.5h-3.4V9.7L8.5 6.5z" /><path d="M12 13v2.5M4.5 5l1.8 1M19.5 5l-1.8 1M4 10h2M18 10h2" /></>,
  torchOff: <><path d="M8.5 3.5h7v3l-1.8 3.2V20.5h-3.4V9.7L8.5 6.5z" /><path d="M12 13v2.5M4 4l16 16" /></>,
  rotate: <><path d="M18.5 12a6.5 6.5 0 1 1-1.9-4.6" /><path d="M19 4v4h-4" /></>,
  alert: <><path d="M10.7 4.5a1.5 1.5 0 0 1 2.6 0l7.4 13a1.5 1.5 0 0 1-1.3 2.2H4.6a1.5 1.5 0 0 1-1.3-2.2z" /><path d="M12 9.5v4.5" /><circle cx="12" cy="16.9" r=".5" fill="currentColor" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  offline: <><path d="M7 18.5h10a4 4 0 0 0 .6-8A5.5 5.5 0 0 0 7 9.6a4.5 4.5 0 0 0 0 8.9z" /><path d="M4 4l16 16" /></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeOff: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" /><circle cx="12" cy="12" r="2.8" /><path d="M4 4l16 16" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></>,
  lines: <path d="M5 6.5h14M5 10.5h14M5 14.5h14M5 18.5h9" />,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  ear: <><path d="M7.5 9a4.5 4.5 0 0 1 9 0c0 3.2-3 3.6-3 6.6a3 3 0 0 1-5.3 1.9" /><path d="M10.5 9.3a1.5 1.5 0 0 1 3 0" /></>,
  landscape: <><path d="M3 19.5l6-9 4 6 2.5-3.5 5.5 6.5z" /><circle cx="16.5" cy="7" r="1.8" /></>,
  dawn: <path d="M3 17h18M7 17a5 5 0 0 1 10 0M12 6.5V9M5.6 10.6l1.6 1.6M18.4 10.6l-1.6 1.6M8 20.5h8" />,
  moon: <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><circle cx="12" cy="8" r=".5" fill="currentColor" /></>,
  list: <><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="5" cy="6.5" r=".6" fill="currentColor" /><circle cx="5" cy="12" r=".6" fill="currentColor" /><circle cx="5" cy="17.5" r=".6" fill="currentColor" /></>,
  chart: <path d="M4 4v16h16M8 16v-4M12 16V8M16 16v-6" />,
  people: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c.7-3.2 2.8-4.8 5.5-4.8s4.8 1.6 5.5 4.8" /><path d="M15 5.7a3 3 0 0 1 0 5.6M17 14.5c1.9.5 3 2 3.5 4.5" /></>,
  mailOpen: <><path d="M3.5 10 12 4l8.5 6v8.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M4 10.5l8 5.5 8-5.5" /></>,
  external: <><path d="M13.5 4.5h6v6M19.5 4.5 11 13" /><path d="M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M16 5.5V5a1.5 1.5 0 0 0-1.5-1.5h-9A1.5 1.5 0 0 0 4 5v9.5A1.5 1.5 0 0 0 5.5 16H6" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.5" /><circle cx="12" cy="17" r=".5" fill="currentColor" /></>,
};

export const Glyph: React.FC<{ name: GlyphName; className?: string; size?: number; strokeWidth?: number; title?: string; filled?: boolean; style?: React.CSSProperties }> = ({ name, className = '', size = 22, strokeWidth = 1.5, title, filled, style }) => (
  <svg
    viewBox="0 0 24 24" width={size} height={size} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" style={style}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    className={`inline-block shrink-0 ${className}`}
    role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}
  >
    {title ? <title>{title}</title> : null}
    {P[name]}
  </svg>
);

export default Glyph;
