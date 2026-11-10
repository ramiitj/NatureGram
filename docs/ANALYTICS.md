# Analytics, errors & performance

NatureGram uses **first-party analytics** (`services/analytics.ts` → `POST /api/events` → structured logs).

- **Product events** are sent **only after the explorer taps "Allow"** on the one-time consent banner.
- **Client errors** are always reported. They carry only the message, file and line: no user content and no user id.
- **Web Vitals** (LCP, CLS, INP) are sent once per page view, with consent.

## Getting the data into BigQuery
1. Cloud Logging → Log Router → **Create sink** → BigQuery dataset `naturegram_analytics`.
2. Filter: `jsonPayload.msg="analytics_event" OR jsonPayload.msg="client_error"`
3. Example funnel query:
```sql
SELECT jsonPayload.event AS event, COUNT(DISTINCT jsonPayload.sessionId) AS sessions
FROM `naturegram_analytics.*`
WHERE jsonPayload.event IN ('landing_enter','lens_open','capture','ai_result','post_published')
  AND DATE(timestamp) = CURRENT_DATE()
GROUP BY event;
```
4. Create log-based alerts on `client_error` rate and on `severity=ERROR` server logs.

## Event taxonomy
| Event | When | Key props |
|---|---|---|
| `app_open` | App boots | `standalone` |
| `analytics_consent` | Explorer allows analytics | |
| `landing_enter` | Taps Explore Wild | `naturalist` |
| `account_prompt` | An action needed an account | `reason` |
| `sign_up` / `login` | Auth success | `with_username` |
| `sign_up_age_blocked` | Sign-up stopped by the 13+ check (no account, no birth date kept) | |
| `experiment_exposure` | First time a feature flag is evaluated in a session (services/flags.ts) | `flag`, `variant`, `on` |
| `lens_open` | Live lens started | `mode`, `remembered` |
| `lens_error` | Camera/mic failed | `name` (e.g. NotAllowedError) |
| `live_session_limited` | Server ended a live session (quota/time) | `code` |
| `capture` | Photo, video, sound or upload | `type`, `keyframes` |
| `ai_result` | Identification returned | `ok`, `type`, `ms`, `confidence` |
| `lens_session_end` | Done tapped | `captures` |
| `post_published` | Publish succeeded | `count`, `mode`, `audience`, `corrected`, `caption`, `new_species` |
| `post_publish_failed` | Publish failed | `offline` |
| `post_open` | Post detail opened | `media`, `feed` |
| `like` / `unlike` / `comment` / `save` / `unsave` / `share` | Engagement | |
| `follow` / `unfollow` | Social graph | |
| `report` | Content reported | `reason` |
| `search` / `tag_open` | Discovery | `length` / `tag` |
| `push_permission` | Notification permission answered | `result` |
| `web_vitals` | Page hidden | `lcp_ms`, `cls`, `inp_ms` |
| `client_error` | JS error or render crash | `message`, `source`, `line`, `boundary` |

## North-star and health metrics
- **Weekly active explorers** who publish at least one sighting.
- **Capture → publish conversion**: `post_published` / `lens_open` sessions.
- **AI correction rate**: `post_published.corrected / count`. This is the key AI-accuracy signal (see AI_GOVERNANCE.md).
- **D1 / D7 retention** by signup week.
- **Crash-free sessions**: sessions without `client_error`.
- **p75 LCP** under 2.5 s; **p75 INP** under 200 ms.
