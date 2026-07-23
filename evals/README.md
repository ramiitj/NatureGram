# NatureGram Eval Harness

Scores the identification pipeline (the same taxonomy/scope-gate schema
`services/genAiService.ts` uses) against a fixture set. Run it with:

```
npm run eval
```

This calls the real Gemini API directly (not through the app's `/api-proxy`
server route — that route requires a Firebase session and isn't meant to be
called from a script), so it needs a `GEMINI_API_KEY` environment variable.
**Without one set, `npm run eval` still runs successfully — every fixture is
reported as skipped, and the script exits 0.** That's intentional: this
harness needs to be runnable in a fresh checkout with no secrets configured,
not fail closed. Set `GEMINI_API_KEY` to actually exercise it.

Reports are written to `evals/results/latest.json` and `evals/results/latest.md`
(gitignored — regenerated on every run).

## What ships out of the box

The built-in fixtures (`evals/fixtures/syntheticFixtures.ts`) are
**synthetic, programmatically-generated images — not real wildlife
photography**: a solid gray fill, a checkerboard pattern, a solid blue
fill. There is no honest way to fabricate expert-labeled species ground
truth, and doing so would undermine the entire point of this harness. What
these fixtures *can* legitimately test is the scope gate — is this even a
nature subject at all (`isNatureSubject`, see F2) — since "a solid gray
rectangle is not a plant, animal, or fungus" is unambiguous ground truth
that costs nothing to fabricate honestly.

To actually score taxonomy accuracy and confidence calibration against real
species, add your own labeled photos below.

## Adding real fixtures

Drop image files into `evals/fixtures/custom/` alongside a `manifest.json`
listing them:

```json
[
  {
    "id": "my-cardinal-01",
    "description": "Adult male Northern Cardinal, backyard feeder, daylight.",
    "imageFile": "cardinal-01.jpg",
    "mimeType": "image/jpeg",
    "expectedIsNatureSubject": true,
    "expectedLabelsContainsAny": ["Northern Cardinal", "Cardinal"]
  }
]
```

Field reference:

- `id` — unique string, shown in the report.
- `description` — free text, shown in the report.
- `imageFile` — filename of the image, relative to `evals/fixtures/custom/`.
- `mimeType` — defaults to `image/jpeg` if omitted.
- `expectedIsNatureSubject` — ground truth for the scope gate.
- `expectedLabelsContainsAny` — optional. A list of acceptable common names
  (any one matching counts as correct) — only meaningful when
  `expectedIsNatureSubject` is `true`. Omit entirely for a fixture that's
  only testing the scope gate.

`evals/fixtures/custom/` and its `manifest.json` are gitignored (see the
`.gitignore` entry) — this is a **local/CI-secret-injected corpus**, not
something to commit to a public repo, since real wildlife photos may carry
their own licensing/privacy considerations the app's own moderation
pipeline doesn't need to solve for test fixtures.

## Nightly CI

`.github/workflows/eval-nightly.yml` runs `npm run eval` once a day (not on
every PR — an LLM call per fixture is real cost and latency, and CI-grade
correctness signal like this belongs on a cadence, not the PR-blocking
path) with `GEMINI_API_KEY` from repository secrets, and uploads the
report as a build artifact. Without that secret configured, it still runs
and passes (all fixtures skipped) — configure the secret to get a real
signal.

## Why scoring is split out (`scoring.ts`)

`isNatureSubjectCorrect`, `anyLabelMatches`, and `confidenceBucketAccuracy`
in `scoring.ts` are pure functions with no network/Firestore/SDK
dependency, specifically so they're unit-testable in isolation (this repo
doesn't currently have a unit test runner like vitest/jest configured —
adding one is a natural next step, and these functions are already written
to make that easy when it happens).
