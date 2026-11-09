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
5. **Transparency.** Every AI output in the product is labelled as an AI suggestion, with confidence and an explanation.
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
| Any AI identification | "AI suggestion" badge with confidence and an explanation ("Why the AI thinks so": field marks). |
| Fungi | A do-not-eat warning on review and on the post. |
| Dangerous organism | The safety note is shown. |
| Sensitive or threatened species | **Location is hidden automatically** on the post, and the explorer is told why. Exact GPS is never public in any case. |
| People visible | A consent reminder before public sharing. |
| Not a nature subject | A warning before posting. |
| Low confidence | "Low certainty" prompt, and the post is open to community review. |
| Human corrects the AI | `humanDelta` is set, and "Checked by explorer" is shown. |
| Community ID | Explorers agree or suggest IDs. 2 or more agreeing marks a post **Community verified**. Majority disagreement shows **ID disputed**. |
| Admin prompt change | A change note is required, and the previous version is archived in `admin_config/gemini_history_*`. |

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
