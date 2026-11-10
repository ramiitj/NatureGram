# AI governance at NatureGram

NatureGram's purpose is to help people **notice, understand and care for** the living world. AI serves that purpose only if it is **accurate, honest about uncertainty, safe, and accountable to people**. This document records how the AI was evaluated, the controls now in place, and how they are operated. It is structured along the NIST AI Risk Management Framework (Govern, Map, Measure, Manage).

---

## 1. Evaluation (November 2026)

| Touchpoint | Model | Findings before this work |
|---|---|---|
| Live guide (voice and vision) | `gemini-2.5-flash-native-audio-latest`, prompt in `admin_config` | Any signed-in user could rewrite the global prompt. No uncertainty language. Sessions could continue indefinitely through reconnects. Full-resolution frames sent every second. Exact GPS shared with the model. |
| Media identification | `gemini-3.1-pro-preview` | No confidence. **The model inferred locations from images** (privacy and accuracy risk). Failures returned fabricated text ("Analysis failed.", "Unknown") that could be published. No retries or timeouts. A 20 MB inline limit was unchecked. |
| Collection summary | `gemini-3.1-pro-preview` | Fake fallback title on failure. Not instructed to stay within the facts. |
| Image generation (`generateImageFromSummary`) | `gemini-3.1-flash-image-preview` | Unused, but it produced **synthetic "nature photographs"**, which is incompatible with an observation record. |
| Live auto-captures | Live model labels | Saved without any verification. |
| Learning loop | none | Human corrections were recorded on posts but never measured. |

**Overall:** the AI was impressive but ungoverned. It had no accuracy measurement, no abstention, unenforced safety, client-controlled prompts and models, and unbounded cost.

---

## 2. Principles
1. **Truthful by design.** Abstain to a broader rank rather than guess. Show confidence and evidence.
2. **Humans decide.** AI proposes and explorers publish. The community can confirm or challenge any ID.
3. **Safety first.** Never advise on edibility or handling. Warn about dangerous organisms. Protect sensitive species.
4. **Privacy.** The AI never infers or states locations. Only coarse location reaches models. People in frame are not described.
5. **Transparency.** Every AI output in the product is labelled as the guide's (the AI naturalist's) suggestion, with confidence and an explanation, in the product's own voice rather than a warning sticker.
6. **Integrity of the record.** No AI-generated imagery in observations. AI text is editable and attributable (model and prompt version stored).
7. **Accountability.** Every model or prompt change is versioned, auditable and reversible.

---

## 3. Controls in place (Govern & Manage)

### Server-side, non-bypassable (`server/aiGovernance.js`)
| Control | Detail |
|---|---|
| Endpoint allowlist | Only `generateContent`, `streamGenerateContent`, `countTokens` and Live `BidiGenerateContent`. No Files API, tuned models or caches. |
| Task aliases → models | Clients request `ng-identify` or `ng-synthesize`. The server maps them via `MODEL_IDENTIFY` / `MODEL_SYNTHESIZE`. Models can be changed or rolled back without a client release. |
| Live model pinning | The Live setup frame is rewritten so only allowlisted models run (`LIVE_MODEL`, `LIVE_ALLOWED_MODELS`). |
| Platform policy | `PLATFORM_POLICY` (v`AI_POLICY_VERSION`) is appended to **every** system instruction. It covers accuracy and abstention, safety (edibility, venom), wildlife ethics, privacy (no people, no locations), scope, and prompt-injection resistance. The admin prompt cannot override it. |
| Safety settings | Harassment, hate, sexual and dangerous content are blocked at medium and above on every request. |
| Quotas | Per-user daily AI calls and live minutes (stricter for guests), a per-minute rate, concurrent live session caps, a session length cap, and body size caps. |
| Telemetry | Every call logs uid, task, model, status, latency, prompt and output tokens, finish reason and block reason. No content is logged. |

### Identification contract (`services/genAiService.ts`, prompt `identify-2026.11-1`)
- Structured output: `identifications[]` (common name, scientific name, **rank**, **confidence**, **evidence**), overall confidence, ecology narrative, hashtags, **safety flags** (`fungi`, `dangerous`, `sensitiveSpecies`, `peopleVisible`, `isNatureSubject`), `needsExpertReview`, `safetyNote`.
- Temperature 0.2, retries with backoff for transient errors, 90 s timeout, size pre-check.
- **No fabrication:** failures throw. The UI leaves the label empty and asks the explorer to identify it.
- **No location inference:** location comes only from the device and is never echoed as fact.
- Results store `aiModel`, `aiPromptVersion` and `aiPolicyVersion` for audit.
- `generateImageFromSummary` was **removed**. Synthetic imagery is not allowed in observation records.

### Live guide
- The default prompt is rewritten for hedged language and evidence. `trigger_capture` requires a `confidence`.
- **Second opinion:** every guide-triggered capture is re-identified by the governed model. If they disagree, confidence is downgraded and the capture is flagged for review.
- Frames are streamed at 768 px or less, and unchanged frames are skipped. Only coarse (~1 km) coordinates are sent.
- The fortnightly naturalist shapes what the guide encourages explorers to notice, keeping the AI aligned with NatureGram's purpose.

### Product safeguards
| Situation | Behaviour |
|---|---|
| Any AI identification | "Your guide's suggestion" line (the guide is introduced as NatureGram's AI naturalist on tap), confidence carried in the name ("Likely …", "Possibly …") and in words, plus an explanation. Fungi and other safety warnings stay explicit. |
| Fungi | A do-not-eat warning on review and on the post. |
| Dangerous organism | The safety note is shown. |
| Sensitive or threatened species | **Location is hidden automatically** on the post, and the explorer is told why. Exact GPS is never public in any case. |
| People visible | A consent reminder before public sharing. |
| Not a nature subject | A warning before posting. |
| Low confidence | "Low certainty" prompt, and the post is open to community review. |
| Human corrects the AI | `humanDelta` is set, and "Checked by explorer" is shown. |
| Community ID | Explorers agree or suggest IDs. 2 or more agreeing marks a post **Community verified**. Majority disagreement shows **ID disputed**. |
| Admin prompt change | A change note is required, and the previous version is archived in `admin_config/gemini_history_*`. |

### Automated moderation on publish (`server/publish.js`, `server/moderationText.js`)
Every sighting is checked once, on the server, before it can reach the feed. Nothing is rejected for safety reasons: a flagged sighting is saved to the explorer's journal and waits for the admin.

| Check | How | Outcome |
|---|---|---|
| Links, contact details, promotions | Existing pattern check on caption, title, notes, tags | Refused with words the explorer can act on (unchanged) |
| Edibility or medicinal claims | `findPolicyBreach` | Refused with the safety guidance (unchanged) |
| Abuse, slurs, sexual words | Whole-word list (`BASE_WORDS`) plus the admin's own words (`settings.moderationWords`, Admin → Review) | `moderation: { status: 'pending', reasons: ['words'] }`, not public, queued |
| Spam patterns | Promotions, shouting, repeated characters or words, hashtag or mention floods | `pending`, reason `spam` |
| People, faces, number plates, screens, no nature subject | The governed image check (`settings.models.moderate`, same policy and safety settings as every call) | Explorer is asked to crop or retake, or can request a review (unchanged) |
| Unsafe imagery | Same call: the schema's `unsafe` field (gore, nudity, hate symbols, cruelty to animals), **and** any safety block from the model (`promptFeedback.blockReason`, finish reason `SAFETY`, `PROHIBITED_CONTENT`, `IMAGE_SAFETY`…) counts as a flag | `pending`, reason `unsafe` |

- **One check per sighting.** The image check runs once at publish (up to four pictures) and again only if the explorer later changes the picture. Results are stored as `moderation.imageChecked`.
- **Fail-open.** If the image check itself fails (model error, timeout), the sighting is published normally, marked `moderation.unchecked: true`, logged, and queued as *Published while the image check was down* so the admin can look afterwards. `MODERATION_FAIL_OPEN=false` restores the previous behaviour (hold until reviewed).
- **Field notes (comments)** are written by the app directly, so the `moderateComment` Cloud Function runs the same word and spam checks on each new note. A flagged note gets `hidden: true` (the app shows it only to its author) and is queued; nothing is deleted.
- **Review queue** (Admin → Review → Moderation queue): kinds *safety*, *privacy*, *unchecked* and *field note*, each with approve or hide. Every decision is in the audit log.

### App Check (`server/appCheck.js`, `services/appCheck.ts`)
- The web app initialises Firebase App Check with reCAPTCHA Enterprise (or v3) **only when `VITE_APPCHECK_SITE_KEY` is set**, and sends `X-Firebase-AppCheck` on the AI proxy, publishing, visibility and live-token calls. For the live websocket the token travels as a path segment (`/api-proxy/ac/<token>/…`), which the server strips before anything reaches Gemini.
- The server verifies the token on those routes. With `APPCHECK_ENFORCE=true` a missing or invalid token is refused (401); otherwise the request goes ahead and the outcome is counted and logged (`appcheck` log lines; counts under Admin → Audit & security). Use monitoring mode to confirm coverage before enforcing.
- Native apps have no App Check provider yet; enforcing would cut them off. See `docs/OPERATIONS.md`.

### Live sessions: shared limits, and optional direct connection
- **Shared concurrency.** Each live session holds a lease in `live_leases` (heartbeat every 30 s, ignored after 90 s without one, deleted at the end). The per-explorer cap (`QUOTA_MAX_CONCURRENT_LIVE`) and an optional all-explorers cap (`LIVE_GLOBAL_MAX_CONCURRENT`) are therefore enforced across every server instance. If the shared store refuses (for example the server's service account lacks Firestore access), each instance falls back to its own in-memory count; live keeps working.
- **Direct mode (`LIVE_DIRECT_TOKENS=true`, off by default).** The app asks `/api/live/token` for a Gemini ephemeral token instead of streaming through the server. The token is minted only after the same checks as the proxy (switches, suspension, blocked networks, spending ceiling, per-minute rate, today's live minutes, per-network hourly cap, shared lease). It works once (`uses: 1`), must open a session within a minute, and expires at the session-length cap or when today's minutes run out. `liveConnectConstraints` lock the model to the admin's live model and the config to exactly what the proxy writes into the setup frame (admin live prompt, the app's session context as quoted DATA, the platform policy, NatureGram's own camera tools, generation settings) **plus** the safety settings; `lockAdditionalFields: []` locks every field that is set. If minting or connecting fails, the app falls back to the proxy automatically.
- **What changes in direct mode.** The server no longer sees the stream, so it cannot refuse a second setup frame, unknown message types or idle sessions mid-way; the token's constraints and lifetime take their place, and Gemini enforces them. Telemetry has the mint (`ai_log` task `live-token`) and the session length (task `live`, flag `direct`), never content. Live minutes are charged from the app's end report, never less than its last heartbeat and never more than the token's lifetime; if no report arrives the full lifetime is charged. Server bandwidth and CPU for live drop to almost nothing; Gemini token cost is unchanged.

---

## 4. Measurement (Measure)

**Data sources**
- `ai_feedback` collection: for every published capture, the AI's proposal vs the explorer's final label, confidence, flags, model and prompt version.
- `ecosystem_feed/{id}/identifications`: community IDs.
- Server logs: latency, tokens, errors and block reasons per task and model. Analytics: `ai_result`, `ai_second_opinion`, `post_published.corrected`.

**Dashboard:** Admin console → **AI quality** shows correction rate, calibration by confidence, correction rate by media type, most common confusions and safety-flag counts.

| Metric | Target | Action if breached |
|---|---|---|
| Correction rate at "high" confidence | < 10% | Model is overconfident: tighten the prompt or evaluate another model |
| Correction rate at "medium" | < 30% | Review common confusions; add guidance for look-alikes |
| Live vs governed disagreement (`ai_second_opinion.agree=false`) | < 20% | Review the live prompt; consider a different live model |
| AI error rate (`ai_result.ok=false`, server 5xx) | < 2% | Check quotas, model availability; roll back the alias |
| p95 identification latency | < 15 s | Consider a faster model for `ng-identify` |
| Daily cost per active explorer | Within budget | Adjust quotas or route to a cheaper model |

---

## 5. Change management
1. **Model change:** set `MODEL_IDENTIFY` (or `LIVE_MODEL`) on a staging revision. Compare the AI-quality metrics for at least 3 days or 200 identifications. Promote, or roll back by restoring the env var.
2. **Prompt change:** bump `AI_PROMPT_VERSION` (identification) or `AI_POLICY_VERSION` (platform policy). New results are stamped automatically, and the dashboard can be segmented by version.
3. **Live instructions:** edit in Admin → AI quality, with a change note. History is retained.
4. Never ship a change that removes abstention, safety flags, labelling or the platform policy.

## 6. Incident response
- **Harmful or dangerous output reported** (report reason "Dangerous misidentification"): hide the post, review it within 24 h, add the case to the prompt's look-alike guidance, and log the incident.
- **Systemic issue** (for example a model update degrades accuracy): roll back the model alias immediately, communicate in-app if users were affected, and run a post-mortem.
- **Prompt-injection attempt** (signs or captions instructing the model): the platform policy treats them as content. Review the logs and extend the policy if needed.

## 7. Roles & cadence
- **Owner:** the NatureGram admin (verified email or `admin` claim).
- **Weekly:** review the AI quality dashboard and new "dangerous misidentification" reports.
- **Monthly:** calibration review, cost review, sample audit of 50 random identifications against community IDs.
- **Per release:** confirm policy, labelling and safety flags are intact.
