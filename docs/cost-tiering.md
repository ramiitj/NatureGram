# Cost Model & Session Tiering (Pillar U2)

## What this is

The roadmap's ask was to "model the true unit cost of Live native-audio and
design tiering... funders will build this model; have the answer first."
This document is that model, worked from real telemetry and published
pricing — and a tiering *proposal*, not an enforced feature (see
"What's not built" below).

## The unit-cost model

`services/costModelService.ts` computes real cost from telemetry this app
already collects:

- **Analysis calls** (`ai_usage_logs`, see Q1): actual logged
  `promptTokenCount`/`candidatesTokenCount` × published per-model pricing.
- **Live sessions** (`live_session_metrics`, see R1): actual measured
  session duration, actual summed output-audio seconds (from real decoded
  `AudioBuffer.duration` values), and actual video-frame-sent counts × the
  documented audio/image token rates × published pricing.

Both are genuine calculations, not placeholders — the only approximations
are noted as caveats in the code (e.g., `ai_usage_logs` doesn't currently
record whether an analysis call's input included audio, which is priced
higher than image/video input).

Live results, computed from whatever's actually been logged, are visible
in AdminConsole's "AI Usage" tab. In this environment (no production
traffic), the totals are zero — that's honest, not broken; the computation
runs the moment real usage exists.

## A worked example: what does one Live session cost?

Pricing (`gemini-2.5-flash-native-audio-preview`, sourced from
ai.google.dev/gemini-api/docs/pricing on 2026-07-23): input $3.00/1M
tokens (audio/video), output $12.00/1M tokens (audio). Token rates
(ai.google.dev/gemini-api/docs/tokens): audio 32 tokens/sec, a still image
≤384px in both dimensions 258 tokens/frame.

For a 3-minute session (the current hard cap in `geminiProxy.js`) with the
model speaking roughly half the time, streaming video frames at the
current 1fps (`LiveLens.tsx`'s capture interval):

| Component | Volume | Cost |
|---|---|---|
| Mic audio input (streamed continuously the whole session — see `sendAudioChunk`) | 180s × 32 tok/s | $0.0173 |
| Model voice output (~half the session) | 90s × 32 tok/s | $0.0346 |
| Video frames (1fps × 180s) | 180 frames × 258 tok | $0.1393 |
| **Total** | | **≈$0.191** |

**Video frames are ~73% of the per-session cost — not audio.** This is
the single most actionable finding here: cutting the Live capture frame
rate from 1fps to 0.5fps would cut total session cost by roughly a third,
with (most likely) no perceptible impact on the agent's ability to narrate
what it's seeing — worth an actual product decision, not something this
pass changes unilaterally.

At the current default quota (`MAX_DAILY_LIVE_SESSIONS=20`), a single free
user maxing out every session every day costs **≈$3.82/day** in Live API
spend alone (worst case, not typical — most sessions end long before the
3-minute cap).

## The tiering proposal

`config/tierDefinitions.ts` makes the current implicit single tier
explicit (`free`, matching `liveQuota.js`'s existing env-var defaults
exactly) and proposes a second tier's limits, sized against the cost model
above rather than picked arbitrarily:

| | Free (today) | Supporter (proposed) |
|---|---|---|
| Concurrent Live sessions | 1 | 2 |
| Live sessions / day | 20 | 100 |
| Max session length | 180s | 300s |
| Analysis calls / day | 50 (not yet enforced — see below) | 500 |

Worst-case daily Live spend per tier at these limits: free ≈$3.82,
supporter ≈$31.86 (5× the daily session cap and a 300s vs. 180s session
length both compound) — a concrete number to weigh against whatever a
"supporter" tier's price point would be.

## A gap this surfaced

**Async analysis calls (upload, manual photo/video capture) have no daily
cap at all today** — only Live sessions are quota-enforced
(`liveQuota.js`). `maxDailyAnalysisCalls` above is a proposed number, not
a description of existing behavior; there is currently no code path that
reads or enforces it. Adding one (mirroring `tryConsumeDailyLiveSession`'s
pattern, keyed by uid) is a natural, small follow-up — flagged here rather
than built, since it's a new abuse-control decision, not part of what "cost
modeling" itself required.

## What's not built (and why)

- **No payment/billing integration.** There is no Stripe (or any payment
  provider) anywhere in this codebase, and no `plan`/`tier` field on
  `UserProfileData`. Building one means real business decisions (price
  points, what "supporter" actually gets, refund policy) that aren't
  mine to make.
- **No tier enforcement.** `config/tierDefinitions.ts` is a target shape a
  future plan-aware `liveQuota.js` could read from — today, every
  signed-in user still gets exactly the `free` row's limits, unchanged
  from before this pass, via the same env vars as always.
- **This doc and the model are the deliverable for U2** — real cost
  numbers computed from real telemetry, and a concrete, cost-justified
  tiering proposal ready for a product/pricing decision. The enforcement
  layer is future work once that decision is made.
