# Research Warehouse Export

Firestore documents can answer "what did this user post" but can't
efficiently answer "how has the count of *Cardinalis cardinalis*
observations near this region changed over time" — that's a
species x place x time analytical query, and Firestore has no
aggregation/join support for it. This script is what turns the
community-verified observation corpus this app collects into an actual
queryable research dataset.

## What it does

```
npm run export:warehouse
```

1. Reads every **community-verified** observation (`verificationState ===
   'confirmed'`, see Q3) from Firestore — unverified AI labels have no
   place in a dataset meant to support a scientific claim.
2. Writes them as newline-delimited JSON to `warehouse/exports/observations-<date>.ndjson`,
   matching the schema in `warehouse/schema.json`. **This file is always
   produced** and is a valid deliverable on its own, independent of whether
   BigQuery is configured.
3. If `BIGQUERY_DATASET` is set (see below), also loads that file into
   BigQuery — creating the dataset/table from `schema.json` if they don't
   already exist.

**Without a BigQuery project configured, this still runs successfully** —
it produces the NDJSON export and prints the exact `bq load` command to
run manually once you have one. That's intentional, same posture as the
eval harness (`evals/`) and Live-session quota (`server/lib/liveQuota.js`):
a script that only works with production infrastructure attached should
still be honestly runnable in a fresh checkout, not silently no-op or
hard-fail.

## Configuration

| Env var | Required | Default |
|---|---|---|
| `BIGQUERY_DATASET` | to actually load into BigQuery | none — skips the load |
| `BIGQUERY_PROJECT_ID` | no | falls back to `firebase-applet-config.json`'s `projectId` |
| `BIGQUERY_TABLE` | no | `observations` |

Also needs Google Cloud Application Default Credentials with BigQuery
access (e.g. `gcloud auth application-default login` locally, or a service
account with the BigQuery Data Editor role in CI/production) — same
credential requirement as the Firestore Admin SDK access this script
already needs to read `ecosystem_feed`.

## Privacy

Precise coordinates (`lat`/`lng`) are withheld for sensitive-species
observations — the same protection already applied to the community feed's
display and the audio dataset export (S3). `geohash`, `location_area`, and
everything else still exports normally; only the exact point withholds.

## Schema

See `warehouse/schema.json` — a `canonical_taxa` and `soundscape` repeated
RECORD per observation (see T3 and S2), plus identification/verification
metadata, geohash, and timestamp. No `user_id` or any other
directly-identifying field is included.

## Why this can't be fully verified in this environment

There is no BigQuery project or GCP credentials available here — same
"needs a live environment" limitation as every AI-behavior feature in this
project that needs a real Gemini key. What's been verified: the Firestore
read/transform logic, the NDJSON output format against `schema.json`, and
that the script degrades gracefully (exits 0, produces a valid export)
without `BIGQUERY_DATASET` set. The actual `dataset.create()` /
`table.load()` calls against a real BigQuery project have not been
exercised end-to-end.
