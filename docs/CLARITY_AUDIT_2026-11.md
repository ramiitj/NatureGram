# Clarity and theme audit (November 2026)

A review of every page for clutter, cognitive load and coherence, judged as Joe Gebbia and Don Norman would judge it, plus a check that the fortnightly naturalist theme really changes the app. The screenshots were taken against live data with the clock fixed in three fortnights (Leopold, Earle, Merian).

## Part 1: does the colour change every fortnight?
**Yes, but less than the idea promises.**

**What changes:**
- the landing photo and its colour wash
- the wordmark and headings
- the tabs, chips and the challenge card
- the Lens button
- the favicon

**Why the change is muted:**
- Every primary colour is darkened to 7:1 contrast, which is good for reading but pulls all 24 themes towards "dark ink". Leopold's orange reads as brown.
- Some neighbouring fortnights are near-twins, so the change goes unnoticed:
  - Leopold → Emerson
  - Carson → Thoreau
  - three grey or slate fortnights in a row between early January and mid-February

**Things that should follow the theme but don't:**
- the Lens shutter glow (fixed orange)
- the black tiles for videos with no still
- four primary buttons in stone-900
- primary buttons that switch between the primary and accent colours
- Explore, which is barely themed
- the legal and 404 pages, which use a fixed orange
- the first visit of the day, which paints in default orange for about 0.6–0.9 s before the theme applies

**Contrast failures in every theme:**
- the inactive "Fellow explorers" tab (2.3–2.8:1)
- the search placeholders (1.9–2.4:1)
- the white "marvelled" icon in Moments, as low as 1.3:1 in some themes

**Deliberately neutral, and fine:** cream paper, stone text, amber warnings, red for destructive actions, and the gold "first plate".

## Part 2: the biggest sources of clutter and confusion
1. **One thing has many names.**
   - **A post** is called sighting, entry, page, plate, capture, specimen, expedition page, record or moment.
   - **Following** is called follow, "Read by N", "Reading" or "Fellow explorers".
   - **"Letter"** means private messages, the weekly letter and "Put it in a letter".
   - **The sign-up button** has five different labels.
   - Fix: a one-page glossary, with one word per idea.
2. **Black video tiles open the feed.**
   - Posters are fetched only on hover, so phones never fetch them.
   - Sound-only recordings appear as videos.
   - Each tile stacks three play symbols.
3. **There are two searches.**
   - The feed search covers loaded posts only, with "Hide", "searching N loaded posts" and a separate "#tag" row.
   - Explore searches the server.
4. **There are two filters with different groupings.**
   - The chips are Animals, Plants, Fungi, Sounds, Videos and Most marvelled.
   - The drawer has Birds/Other life, Photos/Videos/Sounds, Newest/Most marvelled/A to Z, plus Season and Species.
5. **The challenge appears six times:** the feed card, Explore, the naturalist page, the Activity letter, the tour and the handover card.
6. **The publish form is long and in the wrong order.** The caption comes before the species name, and eleven fields come before Share, plus a "specimen or expedition" pop-up.
7. **The 8-step tour hops** between the header and the bottom bar, with a repeated label and two progress indicators.
8. **Counts disagree.**
   - Species: 375 on a post, 55 on the profile.
   - Sightings: 222 in search, 120 on the profile.
9. **The first Lens visit stacks three layers:** the mode dialog, the Lens tour and a tooltip. There's also a camera toggle that duplicates the shutter, and "Transcript" sits where people expect Close.
10. **The profile masthead is dense,** and the Journal has two layouts with different headers, searches and empty states. The empty Journal is a dead end with no button.

**Smaller issues:**
- **Landing:** "Tap to begin" repeats the button and says "tap" on desktop, and the quote is a hidden button.
- **Feed header:** three unlabelled icons, and guests get an unread dot on Activity straight away.
- **Latin names lead,** on tiles and in post headings, instead of common names.
- **The "Why it does this" text is dense AI prose.**
- **Moments:** "Tonight's moments" shows in the morning, and the clips have no caption.
- **Sign-in:** "Log in" sits at the bottom of the whole sign-up form.
- **Admin:** eleven overlapping sections that could be six.

## The top 10 fixes
1. Fix the video tiles: fetch posters when tiles come into view, show sound-only clips as sound tiles, and use one play symbol.
2. Cut the tour from 8 steps to 3 (Wild, Lens, Challenge) and teach the rest in context.
3. Make one search.
4. Make one grouping and one control: a single row of chips, with everything else behind Filters.
5. Adopt the glossary and remove the synonyms.
6. Shorten the publish form to name → note → who can see → Share, with the rest under "More details" and no pop-up.
7. Show the challenge in two places, not six.
8. Use one source for counts.
9. Simplify the first Lens visit: no mode dialog, no camera toggle, Close at top left.
10. Thin the profile masthead and unify the Journal views, with an "Open the Lens" button in the empty Journal.

**Theme quick wins:**
- Theme the shutter glow, the video fallback and the stone buttons.
- Pick one colour for primary buttons.
- Fix the low-contrast text.
- Apply the theme before the first paint.
- Reorder the naturalists so neighbouring fortnights clearly differ.
