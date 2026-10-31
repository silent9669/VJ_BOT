# Cloudflare Worker API

Base URL: `https://vjbot.dangphuc.me`. Source: [`src/worker.js`](../src/worker.js) and [`src/auth.js`](../src/auth.js). This describes the deployed Worker, not the separate Python API.

JSON responses use `Cache-Control: no-store`. Private routes require the `vj_session` HttpOnly cookie; clients must not supply API credentials. Client `user_id` fields/query parameters are ignored for ownership. Mutating requests with an Origin different from the request origin are rejected.

## Public and authentication routes

| Method | Route | Contract |
| --- | --- | --- |
| GET | `/api/health` | `{status, app, edge, d1_items}`; queries D1, not merely process liveness |
| GET | `/api/curriculum?level=N5` | Array of flattened curriculum records; level optional; no pagination currently |
| GET | `/api/auth/config` | `{client_id, nonce}` and a ten-minute nonce cookie; client ID is public configuration |
| GET | `/api/auth/session` | `{user: null}` or `{user: {user_id, name}}` |
| POST | `/api/auth/google` | `{credential}` containing a Google ID token; verifies claims and creates session/profile |
| POST | `/api/auth/logout` | Deletes active session, clears cookie; `{ok: true}` |

The Google credential response includes `{user}` and session cookies. The current GIS flow does not exchange an authorization code or use the stored OAuth client secret.

## Authenticated routes

| Method | Route | Request / response |
| --- | --- | --- |
| GET | `/api/profile` | `{user_id, level, track, updated_at}`; provisions a default profile if absent |
| POST | `/api/profile` | `{level, track?}`; upserts and returns profile |
| GET | `/api/progress` | Totals, accuracy, streak, `weak_items`, and per-item review state |
| POST | `/api/progress/record` | `{item_id, correct, quality?, level?, item_type?, display?, attempt_id?, response_text?}`; returns `{status, next_review, interval_days}` |
| GET | `/api/next-topic` | Due or next curriculum item at the profile level, with reason |
| GET | `/api/history` | Latest 50 messages in chronological order: `{role, content, timestamp}[]` |
| DELETE | `/api/history` | Clears this account's conversation history |
| POST | `/api/chat` | `{message}`; returns `reply`, `response`, `updated_topic`; lesson practice may include context in the message |
| POST | `/api/chat/greeting` | Creates and saves a greeting at the profile level |
| POST | `/api/kaiwa/evaluate` | `{prompt_jp, user_speech, scenario_title?, level?}`; score, rating, feedback, model answer and transcript |
| POST | `/api/tts` | `{text}`; `{mimeType, audioBase64, voice}` or `{fallback: true, voice, text}` |
| POST | `/api/account/delete` | Removes own profile, progress, chat, study days, usage and sessions; `{success: true}` |

Supported levels are N5–N1. Progress `correct` must be boolean; `quality` is an integer 0–5 (default 4). A miss forces SM-2 quality below 3 regardless of submitted quality. Known curriculum items determine their own type/level; generated exercises use submitted metadata. Optional display text is stored per account/item for generated exercises (maximum 2,000 characters); curriculum display text takes precedence. Omitting display on a later answer preserves the existing label.

Progress items return `last_correct` (1/0, null for older records) and optional `response_text`. Written tasks use `item_type: "production"`; response text must be a string of at most 4,000 characters and remains private to the session owner. Omission preserves the saved text.

An optional `attempt_id` (16–80 ASCII letters, digits or hyphens) makes saving an answer idempotent per account. Reuse it only when retrying that same answer. The Worker atomically writes progress and its receipt; a retry returns the original result.

Example, from the signed-in same-origin frontend:

```js
const response = await fetch('/api/progress/record', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({item_id: item.id, correct: true, quality: 4})
});
if (!response.ok) throw new Error('Progress was not saved');
```

## Errors and limits

Errors generally return `{detail}`. Missing/expired sessions return 401; invalid input 400; cross-origin mutation 403; unknown API route 404; oversized private mutation body 413. Chat, TTS and Kaiwa share a 20-request-per-minute/account limit, returning 429 when exceeded.

Chat/Kaiwa provider failures return 503 instead of fabricated assessments. TTS can return a successful fallback response; HTTP 200 alone does not prove generated audio exists. An unexpected Worker error returns a generic 500 without exposing a stack trace. Route method handling is not uniformly hardened to 405; the table lists intended client methods.
