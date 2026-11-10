# Plan: a calmer, faster, more distinct NatureGram

This plan follows the clarity audit (`docs/CLARITY_AUDIT_2026-11.md`). It is written the way Joe Gebbia works: start from the moment in the explorer's story, ask what the best version of that moment feels like, then remove everything that doesn't serve it. Nothing here deletes explorers' data; every change is to presentation, defaults or new fields added alongside existing ones.

---

## A. The feed: no black tiles, no waiting (engineering)

**The moment:** "I open NatureGram and the wild is already there."

### Why tiles are black today
1. The video-processing function makes a poster frame for every video, but saves it only to a side record (`media_variants`), never onto the post.
2. Each tile has to look the poster up itself, and only when the mouse hovers. Phones never hover, so they never look.
3. Sound-only recordings saved as "video" have no picture at all.
4. The first page of the feed carries no picture information for these posts, so the layout shifts as images arrive.

### The fix: render instantly, refine progressively
1. **Posters at the source.**
   - When a video is uploaded, the app grabs a frame on the device (canvas, at about 0.5 s) and uploads it as the post's `thumbnailUrl` and `thumbSmallUrl`. The poster exists before the post does.
   - The Cloud Function still makes its higher-quality poster and now writes it back onto the post and its `feed_thumbnails` entry, filling only fields that are empty and never overwriting.
2. **Know what a recording is.** The function asks ffmpeg whether the file has a picture. If it has none, it marks the post `soundOnly: true`, and the feed shows it as a sound tile (the SoundScape the post page already uses), not a video.
3. **A blur-up placeholder for every tile.**
   - On publish (and in the backfill), compute a tiny about 16 px preview of the poster or photo, plus the dominant colour, and store them on the post (`lqip`, `tint`, `w`, `h`). That's about 300 bytes.
   - The tile renders at its exact size immediately, painted with the blurred preview, and the real image fades in over it. Nothing jumps and nothing is ever black.
   - Posts without these fields fall back to a gradient in the naturalist's colours.
4. **First page in the HTML.**
   - `/api/feed/first` already starts loading with the page. It will now include posters, previews and sizes.
   - The server also inlines the first 6 tiles' previews into the page itself, so the first screen paints without waiting for any request.
   - Images below the fold load as they approach the viewport (IntersectionObserver with a 600 px margin), never on hover.
5. **Right-sized images from a CDN.**
   - Tiles use the 400 px `thumbSmallUrl` on phones.
   - The first two tiles get `fetchpriority="high"` and the rest `loading="lazy"`.
   - Storage objects get long cache headers (immutable names).
6. **Videos come alive gently.** A video tile that is at least 60% visible plays muted, looping its first 3 seconds, only on Wi-Fi or when the device doesn't ask to save data, and never more than one at a time. Everything else stays a still.
7. **Backfill once.** An admin action, "Give every video a poster", runs the function's poster and sound check over existing posts (batched, safe to rerun), so today's black tiles disappear without anyone re-uploading.
8. **Measure it.** The analytics already record LCP. We add `feed_first_tile_ms` and a count of tiles shown without a picture, and set a target in the admin AI-quality/overview page: first tile under 1.0 s on 4G, zero blank tiles.

---

## B. Distinct palettes, one per naturalist

**The moment:** "A new fortnight began, and I can feel it the second I open the app."

### What's wrong
- Several neighbouring fortnights share a hue (Leopold and Emerson, Carson and Thoreau, three greys in January–February).
- The readability step then darkens every colour towards the same deep ink.

### The fix
1. **Redesign all 24 palettes as a set.** Each naturalist gets a hue tied to their story: Earle ocean blue, Goodall forest green, Merian plum, Potter moss, Audubon feather red, Anning fossil ochre, Carver peanut amber, and so on.
   - The hues are spaced around the colour wheel so no two share a family.
   - Greys become real colours: Fossey misty volcanic green, Darwin Galápagos teal, Humboldt Andean violet, Muir Sierra slate-blue.
2. **Order the year for contrast.** Reorder the rotation so consecutive fortnights are always at least 90° apart on the colour wheel. Arriving from a green fortnight, you land in a red or violet one, never another green.
3. **Readable without going muddy.** Each palette is defined as four tones, designed rather than darkened by a formula:
   - **deep:** text and headings, at least 7:1 on cream
   - **primary:** buttons, white text on it at least 4.5:1
   - **accent:** highlights, at least 4.5:1
   - **vivid:** glows, the orb, the favicon, decorative only

   The automatic darkening becomes a safety net that rarely triggers, so Leopold stays orange.
4. **Prove it.** A test computes every palette's contrast and the hue distance between neighbours, and fails if any pair is too close. A preview sheet shows all 24 in order before anything ships.
5. **Theme everything that should follow it:**
   - the Lens shutter glow
   - the video-tile fallback
   - the four stone-black buttons
   - Explore's header and search
   - one colour rule for primary buttons (always primary; the accent is for highlights)
6. **No orange flash.** The day's theme is worked out from the date and applied before the first paint (the app knows it without asking the server), then refined if the server has an override.
7. **Fix the faint text:** the inactive tab, search placeholders, the feed subtitle, and the white "marvelled" icon in Moments, in every theme.

---

## C. Clarity: the 10 changes

### 1. One name for each thing
**The moment:** "I learn the words once and they mean the same thing everywhere."

The glossary, used in every screen, email, tour step and page title:

| Thing | Word | Retired |
|---|---|---|
| A post | **sighting** | entry, page, plate (except the life-list card itself), specimen, record, expedition page |
| Taking one in the Lens | **capture** | (Lens only) |
| Comments | **field notes** | "Your field notes" for the caption becomes **your note** |
| Like | **marvel** | |
| Save | **keep** | |
| Follow | **follow / following / followers** | "read by", "reading", "fellow explorers" |
| Profile | **field page** | |
| Private messages | **letters** | the weekly letter becomes **"Your week outside"**; "Put it in a letter" becomes **"Send in a letter"** |
| Sign-up button | **"Start my field page"** everywhere | four other labels |
| Public / private | **"Share with everyone" / "Only me"** | "Share with the wild", "journal only", "shared with the field" |

A small check in the build flags the retired words if they creep back into the UI text.

### 2. The feed opens alive
Covered by section A. Tiles also lead with the **common name**, with Latin underneath in italics, and there is one play symbol, not three.

### 3. One search
**The moment:** "I type 'kingfisher' and see every kingfisher."
- The feed's search field becomes the door to a single search (the server search Explore already uses). It covers species, places, tags and explorers, with results grouped.
- "Hide", "searching N loaded posts" and the separate "#tag" row go.
- Explore and the feed share one search component, one placeholder and one result layout.

### 4. One way to filter
**The moment:** "I want birds, and it's one tap."
- One row of chips using the life-list grouping: Birds, Plants, Insects, Fungi, Mammals, Water life, Other life (only kinds that exist in the loaded sightings).
- Media (photo, video, sound), season and order move behind the single Filters button.
- Delete the duplicate chips (Animals, Sounds, Videos, Most marvelled) and "A to Z".
- Explore, the feed and the life list all use the same kinds of life.

### 5. The challenge, told once
**The moment:** "There's a gentle invitation this fortnight, and I know where it lives."
- It lives on the feed card, and the card opens the naturalist page.
- It is removed from Explore (a one-line link instead), from the Activity letter, and from the tour. The tour points at the card in one sentence.
- The "changing of the guard" card stays: it's the arrival moment, not a repeat.

### 6. A publish flow that feels like finishing a thought
**The moment:** "I met something; now I name it, say one thing about it, and share."
- Order: species name (pre-filled by the guide, with its confidence) → your note → who can see it → **Share**.
- Everything else (scientific name, behaviour, place, tags) folds under **"More details"**, already filled in by the guide and editable.
- Safety notes (fungi, people in frame, location hidden) stay visible, because they matter.
- Several captures post as separate sightings by default. The "specimen / expedition" pop-up becomes a single toggle, "Combine into one sighting".
- One way to save a draft (leaving asks).

### 7. A three-step welcome
**The moment:** "I understand NatureGram in ten seconds, then I explore by myself."
- The tour becomes 3 steps:
  1. **Wild:** what others are noticing.
  2. **The Lens:** your guide sees and hears with you.
  3. **The challenge:** a small invitation every fortnight.
- One progress indicator, no repeated label, "Skip" always there.
- Journal, field page, Moments, Letters and Explore each get a one-time, one-line hint the first time they're opened, in place, dismissible.

### 8. One true count
**The moment:** "My numbers mean something, so I trust them."
- Species and sightings are computed the same way everywhere, from public sightings with the life-list rules.
- The server keeps `stats.species` and `stats.sightings` in sync on publish, edit and delete. The nightly reconciliation job corrects drift.
- Until a profile is reconciled, the post header shows no count rather than a wrong one.

### 9. The first Lens visit: one thing at a time
**The moment:** "I point the camera at something and the guide is simply there."
- No mode dialog. The Lens starts as the quiet companion. A clear switch in the Lens, "Talk with me", turns on the talkative guide, and the choice is remembered.
- The Lens's own guide shows one short line on the first visit; no stacked tooltip.
- **Close (×)** sits top-left, where people look for it. Transcript moves beside the status.
- The separate camera on/off toggle goes, because the shutter already wakes the camera. "Listen only" moves into a small menu.
- Three controls at the bottom: Talk, Shutter, Sound.
- "Bring in from your camera roll" becomes a small link, not a dialog option.

### 10. A field page that breathes, and one Journal
**The moment:** "My page shows who I am at a glance; my journal reads like a notebook."
- **Field page header:** name, two counts (species, sightings), Follow and Letter.
  - Home range and favourite season move into the life-list header.
  - "Favourite hour" goes.
  - Stamps show only when earned.
  - The duplicate "Journal" button goes.
  - Empty audio and video cards use the sound picture or poster.
- **Journal:** one header, one search, one empty state.
  - The grid view keeps the notebook's header and search, and drops the feed's chips and filters until there are more than 20 sightings.
  - The empty journal gets a clear **"Open the Lens"** button and "Bring in from your camera roll".
- Life list: "Chronicle" becomes **"By date"**, and "Their first was …" uses the common name.

---

## D. Smaller clean-ups from the audit
- **Landing:**
  - "Tap to begin" goes (the orb says it).
  - The quote gets a visible "Meet {naturalist} →".
  - The location caption moves to the naturalist page only.
- **Feed tabs:** "For you / Following".
- **Activity:** no unread dot for guests; the weekly item becomes a short "Your week outside" line.
- **Post detail:**
  - prev/next arrows move to the media edges on desktop
  - one Share button
  - "Why it does this" is capped at two sentences with "Read more", and the guide is asked for plain English
  - "Is this right?" shows only to signed-in explorers
- **Moments:**
  - a small caption (common name · place) stays on each clip
  - the "tonight" wording only appears in the evening
  - the title card shows only before the first clip
  - `volume_up` for sound
- **Sign-in:** "Log in" at the top; username asked last.
- **Admin:** eleven sections become six: Today, Review queue, People, The guide, Settings (allowances, flags, branding), Records & security.
- **Naturalist page:** the dates and the days left are each said once.
- **Static pages:** neutral ink instead of the fixed orange.

---

## E. How it ships

1. **Phase 1: the feed and colour**
   - posters at the source, sound-only detection, blur-up previews and sizes, the inline first page, the backfill and the metrics
   - the 24 new palettes, reordered, with the contrast test and the preview sheet
   - theming the leftovers, the faint text, no orange flash

   Each step is checked with Playwright timings on a throttled 4G profile, before and after.
2. **Phase 2: clarity 1, 3, 4, 5, 8:** the glossary, one search, one filter, the challenge once, one true count.
3. **Phase 3: clarity 6, 7, 9, 10 and the smaller clean-ups:** the publish flow, the 3-step welcome, the first Lens visit, the field page and the Journal.

**Checks for every phase:**
- type check, build, server tests, Firestore rules tests
- Playwright screenshots at 390 and 1280 in three fortnights
- a short before/after note sent to the owner

**Owner steps afterwards:**
- deploy the rules and functions (the poster write-back and sound check live in the function)
- run "Give every video a poster" once from the admin console
