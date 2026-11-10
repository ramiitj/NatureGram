# Field-notebook audit (November 2026)

**What this covers:** features that were still literal or generic after the naturalist reworks (2ea90d8, 7761b83, bea9e9f, 5e19ded, 1eaaf75), reviewed from Joe Gebbia's and Don Norman's point of view.

**Grades:**
- **A**: reworked with real nuance
- **B**: partly reworked
- **C**: still first-pass or literal

Each finding names the screen, the frame of the explorer's story it serves, and the target ("11-star") experience.

## High priority

1. **Life list is a database table (C).** `UserProfile.tsx` builds it from `labels[0]` and sorts it A–Z. It shows numbered rows (row indexes, not discovery order), "First seen 3 months ago" and a chevron. The `eco` icon is literal. `lifeListSummary` ignores `own`.
   - *Frame:* "I open my collection to feel how far I've come."
   - *Target:* a herbarium of specimen plates.
     - Each species is a plate with its discovery number ("No. 23"), the date, place and season of the first sighting.
     - Two views: grouped by kind of life, or a Chronicle in discovery order with season dividers.
     - Milestone ribbons at 10/25/50/100 that name the fortnight's naturalist.
     - "Still to find nearby" ghost plates.
     - Share a plate as an image.
2. **Journal is the feed with a filter (C).** `Journal.tsx` renders `<Community isJournalOnly>`: a masonry grid with search, filters and sort.
   - *Frame:* "Tonight I want to reread my day outside."
   - *Target:* a field notebook organised by day and outing.
     - Each entry shows place, time span, season, the guide's recap, the captures and the explorer's own words.
     - "On this day last year".
     - A season spine.
     - Drafts become "unfinished pages".
3. **The fortnight naturalist's story is never shown (C).** `bio` and `lifespan` in `naturalistExtras.ts` are never rendered. `App.tsx` computes `period`/`extra` and never uses them.
   - *Target:*
     - Tapping the quote or challenge card opens a naturalist page (portrait, life, philosophy, challenge, community answers).
     - A one-time "changing of the guard" card when the naturalist rotates.
     - Challenge stamps in the explorer's notebook.
   - *Constraint:* do not add bio, lifespan or challenge to the landing itself.
4. **The Lens peak moment is a chip list with a 15 s countdown (C).** Uppercase chips, a "FIELD NOTE" header, the toast "Identified. Added to this session." The Lens has no awareness of the life list.
   - *Target:* a specimen-tag card that rests until the next sighting. A first-time species gets a gold "First for your list" stamp and a haptic. Show "Answers X's challenge" when it applies.
5. **The public share page is first-pass (C).** `SharedPostView.tsx` has uppercase labels, a black "Post Not Found" and "Explore More in App". **Bug:** it renders raw `post.behavior`, so placeholder text ("Captured photo.") shows to strangers.
   - *Target:* the reworked detail layout, plus an invitation in the voice of the fortnight's naturalist.
6. **ShareStudio needs a second tap on a single Share button (C).** Its title falls back to "Discovery" instead of the species.
   - *Target:* a share sheet that previews the plate image, with "Copy link" and "Send as a letter". The share text leads with the species.
7. **Onboarding persona modal is jargon (C):** "Avian Bioacoustics Specialist", "Activate Curated Dispatch", lucide icons, `dark:` classes, Birds preselected.
   - *Target:* "What makes you stop and look?" with vignettes. Skippable. Offered again after the third sighting.
8. **Publish celebration is half there (B).** The guide's session summary is passed in but never shown. There's no acknowledgement of the challenge. Share sends a bare link.
   - *Target:* the plate slides into its life-list number, the guide's recap appears, the challenge is acknowledged, and Share sends the plate image.
9. **The review screen keeps composer patterns (B):** "New post", "Acoustic Signature", "Separate posts / One carousel post", a comma-separated species field, emoji notices, sky and emerald callouts.
   - *Target:* "Write up your field entry". A single species field with italic scientific subtext. "One entry per specimen / One expedition page". Glyphs instead of emoji.
10. **Community ID doesn't build trust (B).** A plain tally list. The field-marks note is collected but never shown. Reputation appears only in a hover title.
    - *Target:* determination slips ("Det. by …") showing the field marks, the identifier's species count and the date. "Confirmed by N explorers". One-tap thanks.

## Medium priority

11. **The species "Encyclopedia" modal is scaffold code:** a `pest_control` icon for every species, "Encyclopedia Data", justified text.
    - *Target:* a field-guide page: seasonality, who has seen it nearby, your own sightings of it, look-alikes, Wikipedia credit.
12. **Feed filters have broken copy:** "Filter Specific Taxons Native", "Sort Sequence", "1Wk/1Mo", a sky-50 banner, "Instagram" code comments.
    - *Target:* Kind of life / Season / Near me / This fortnight.
13. **Letters are still chat:** bubbles, Enter sends, "You: " previews.
    - *Target:* dated paper notes. The first letter shows what the two explorers have in common (shared species, region).
14. **Moments keep the TikTok structure:** an endless snap feed with no words.
    - *Target:* an "evening screening": a few clips, each with a quiet title card, and a natural end.
15. **The Kept tab is a blank grid.** Tiles with no thumbnail are empty.
    - *Target:* "pressed pages" with names, and folios.
16. **The profile header is generic.** Species / sightings / followers / following.
    - *Target:* a field-page masthead: home range, favourite season and hour, challenge stamps, latest plate.
17. **The profile grid is a photo grid.** **Bug:** the video and collection icons overlap.
    - *Target:* specimen drawers grouped by month.
18. **The upload modal is first-pass:** "Direct Media Upload", "Stitch into unified entry".
    - *Target:* "Bring in from your camera roll", with the date prefilled from EXIF.
19. **Lens chrome and jargon:** "Multi-Modal Mastery", ZOOM, a `smart_toy` icon, "ends in Ns to save resources", RETRY/DISMISS.
    - *Target:* copy in the guide's voice, and a breathing-dot state for the guide.
20. **The end of a Lens session is a spinner.** The fallback summary reads "Exploration concluded."
    - *Target:* a short "closing the notebook" moment.
21. **The weekly field letter is thin.**
    - *Target:* a Sunday letter: new species as plates, challenge progress, what to look for next.
22. **Icons are used literally everywhere:** eco, pest_control, flutter_dash, smart_toy, psychology, inventory_2, Activity sharing Marvel's glyph.
    - *Target:* a naturalist glyph set (`components/Glyph.tsx`).
23. **Notifications are one row per event.**
    - *Target:* grouped ("7 explorers marvelled at your Kingfisher"), with meaningful events raised to the top.

## Low priority

24. **PublisherStudio:** the typo "speciman", plus "OG Meta Link" and "PRO TIP". Fold it into the share sheet.
25. **The `/s/:postId` link card:** emerald colouring, and the caption is used before the species in og:title.
    - *Target:* "Indian Roller, seen near Jaipur · NatureGram".
26. **Drafts tray:** a cardboard-box icon and `window.confirm`.
    - *Target:* "Unfinished pages".
27. **Lens mode chooser:** generic option cards.
    - *Target:* companion framing.
28. **Media editor:** brightness and contrast "filters".
    - *Target:* "Frame the specimen" (crop and rotate).
29. **Loaders:** generic spinners.
    - *Target:* a single "pressing" leaf loader.
30. **Comments are a flat list.**
    - *Target:* pin observations, and show species counts consistently.
31. **The delete-account sheet:** offer to download your plates before deleting.

## Bugs found along the way

1. Icon names flash as text before Material Symbols loads.
2. Raw placeholder behaviour on the share page.
3. A garbled filter label.
4. The "speciman" typo.
5. Overlapping profile tile icons.
6. Blank Kept tiles.
7. The guide's session summary is never shown.
8. Community-ID field marks are never shown.
9. Dead code in App and lifeListSummary.
10. Off-palette colours and emoji.

## Already right (keep)

- the landing
- the first-visit Lens
- Wonder/marvel
- the post-detail order
- the hour-of-day note
- Fresh tracks
- the challenge card
- sound sightings
- the fungi warning
- the guest field page
- the error and 404 pages
- the empty-state tone
- the Moments loader
- the spam and ID-notification loops
- Keep, and the name "Letters"
