# API Worker

All routes are under `/api` and return JSON `{detail}` on errors. Private routes require the `vj_session` cookie. The Worker derives `user_id` from that session and ignores client `user_id` and top-level `api_key`. Device-only profiles use the explicitly validated transient `api_connection` object described below. A missing session returns `401`.

## Công khai

| Route | Mô tả |
| --- | --- |
| `GET /api/health` | `{status, app, edge, d1_items}` |
| `GET /api/curriculum?level=N5` | Danh mục phẳng từ `curriculum_items` |
| `GET /api/auth/config` | `{client_id, nonce}` (đặt cookie `vj_nonce`) |
| `GET /api/auth/session` | `{user: {user_id, name, is_admin} \| null}`. Phiên Google chưa có email trong hồ sơ bị hủy và trả `null` (phải đăng nhập lại) |
| `POST /api/auth/register` | `{name, email, password}`: mật khẩu 12–128 ký tự |
| `POST /api/auth/login` | `{email, password}` |
| `POST /api/auth/google` | `{credential}`: Google ID token |
| `POST /api/auth/logout` | Xóa phiên |

## Học tập (riêng tư)

| Route | Mô tả |
| --- | --- |
| `GET/POST /api/profile` | Cấp độ và track của tài khoản |
| `GET /api/next-topic` | Mục tiếp theo cần học |
| `GET /api/progress` | Tổng hợp và danh sách mục đã làm |
| `POST /api/progress/record` | `{item_id, correct, quality 0–5, attempt_id?, display?, item_type?, response_text?}`; `attempt_id` giúp thử lại không đếm hai lần |
| `GET/POST /api/completions` | Đánh dấu hoàn thành: `{activity_id, kind, level, title, completed}` |
| `GET/POST /api/exam-attempts` | Trạng thái bài thi thử theo đề `N5:2018` |
| `GET/DELETE /api/history` | Lịch sử chat; DELETE xóa toàn bộ |
| `POST /api/account/delete` | Xóa mọi dữ liệu của tài khoản |

## AI (riêng tư, cần API của người dùng)

Chat, Kaiwa và giọng đọc dùng API người dùng đã lưu; hạn mức 20 yêu cầu/phút mỗi tài khoản (`429` khi vượt).

| Route | Mô tả |
| --- | --- |
| `POST /api/chat` | `{message ≤ 6000 ký tự, lesson?: {id,title,level,goal,content ≤ 4000}, screen?: {route, title, level?, text ≤ 3500}, request_id?}`. `screen` là chữ hiển thị trên màn hình người học đang xem (sai định dạng: 400) → `{reply, updated_topic}`. `request_id` (UUID) bảo đảm gửi lại không tạo thêm lượt |
| `POST /api/chat/greeting` | Lời chào cố định theo cấp độ |
| `POST /api/kaiwa/evaluate` | `{scenario_title, context, prompt_jp, user_speech, level}` → `{score, rating, feedback, model_answer}` |
| `POST /api/tts` | `{text}` → `{audioBase64, ...}`; `403 {code:'no_tts'}` nếu API đã lưu không phải Gemini-Google (client dùng giọng trình duyệt) |

Mã lỗi AI chung: `403 {code:'no_ai'}` chưa lưu API; `409 {code:'rekey'}` không giải mã được khóa; `429` hết lượt; `503` nhà cung cấp lỗi (thông báo tiếng Việt, không lộ nội dung lỗi gốc).

## API người dùng và quản trị

| Route | Mô tả |
| --- | --- |
| `GET /api/ai/settings` | `{source: 'own'\|'none', is_admin, own: {protocol, base_url, model, key_last4}, bases, can_store}`; không bao giờ trả khóa |
| `PUT /api/ai/settings` | `{protocol: 'openai'\|'anthropic'\|'gemini', base_url (bỏ trống = mặc định), model, api_key?}`; bỏ `api_key` để giữ khóa cũ. `503` nếu thiếu `AI_KEY_SECRET` |
| `DELETE /api/ai/settings` | Xóa API đã lưu |
| `POST /api/ai/test` | Gửi một yêu cầu thử qua API đã lưu |
| `POST /api/ai/models` | Lists models using draft `{protocol, base_url, api_key?}` without saving credentials or generating content. Returns `{models, truncated, scope, free_only}`; see Model discovery below. |
| `GET /api/admin/overview` | Chỉ admin (`403` nếu không): `{users, active_7d, messages_24h, messages_7d, own_api_users, top[]}` |
| `GET /api/admin/users?q=&offset=` | Danh sách 25 người dùng mỗi trang, tìm theo tên/email/ID: `{users[], total, offset, guests}`; mỗi người có `kind` (`google`\|`email`\|`guest`), `level`, `messages`, `items`, `completed`, `sessions`, `api`, `last_login`, `admin` |
| `POST /api/admin/purge-guests` | Xóa các hồ sơ khách cũ (không phải Google hay email) cùng dữ liệu: `{removed}` |
| `GET /api/admin/user?id=` | Chi tiết một người dùng (cùng trường như trên); `404` nếu không có |
| `POST /api/admin/user` | `{id, action, level?}` với `action` là `set_level` (cần `level` N5–N1), `clear_chat`, `reset_progress`, `remove_api`, `revoke_sessions` hoặc `delete`. Không thể `delete` chính tài khoản đang dùng |

Routes under `/api/ai/*` and `/api/admin/*` are handled by `src/providers.js` with session checks. Profile creation/update and active-setting writes accept at most 128 KiB of UTF-8 JSON for bounded model history; other JSON bodies retain the 4 KiB limit.

## Model discovery

In Settings, enter an API base URL and key, choose its protocol, then select **Find usable models**. The app fetches candidates and asks for explicit confirmation before sending one real generation request per model. These requests use quota and can incur charges, including paid models. Opening Settings or editing a key does not start tests. The UI shows only progress and, after completion or Stop, successfully responding models.

The confirmation is an in-app native dialog matching the shared surface styles, not a browser `confirm()` popup. It shows the candidate count, per-model test scope, quota/charge warning and partial-catalog notice. Cancel receives initial focus; Escape or cancellation sends no probes. Only the explicit start action permits inference. Credential edits or logout abort a pending confirmation. The dialog reflows on mobile and uses 44-pixel action targets.

- OpenAI-compatible: `GET <base>/models` with Bearer authentication. Custom public HTTPS endpoints use the same protocol; arbitrary authentication formats are not inferred.
- Claude: `GET <base>/v1/models`, or `/models` when the base already ends in `/v1`, using `x-api-key` and `anthropic-version`.
- Gemini: `GET <base>/v1beta/models` using `x-goog-api-key`; only models supporting `generateContent` are listed.
- OpenRouter at `https://openrouter.ai/api/v1`: validates the key with `/key`, then requests `/models/user?output_modalities=text`. Free-tier or exhausted budgets only receive models with explicit zero token prices and no declared request/reasoning fees. Authentication failures never fall back to a public catalog.

`scope: "key_filtered"` indicates provider-side account filtering. `scope: "provider_catalog"` indicates a catalog without established per-key model permissions. Neither is proof of inference access. The app therefore verifies every candidate and never offers catalog-only models, empty responses, credit/permission denials, timeouts or quota failures as successful choices. `free_only` describes the initial pricing filter; `truncated` marks an incomplete catalog.

Discovery requires a signed-in session and shares the existing 20-request/account/minute AI limit. Omitting the key reuses the encrypted saved key only for the same normalized URL and protocol. Changing either requires an explicit new key for discovery and saving.

Redirects are not followed with credentials. Pagination is bounded to five pages, 1,000 model IDs, 4 MB per response and a shared ten-second timeout. Provider error bodies and API keys are never returned. Credential edits, logout and cancellation discard late catalog responses. Saving locks the form until it settles.

`POST /api/ai/models/test` accepts draft `{protocol, base_url, api_key?, model, connection_id?}`. It makes exactly one streaming request for that model and succeeds on the first non-whitespace visible text, then cancels the upstream stream. Role-only events, hidden reasoning, tool-call-only output and empty completion do not verify a model. A provider that returns JSON instead of SSE is parsed within the same request; no second generation is sent. Verification has a 15-second deadline and a 256 KiB response limit. Cancellation cannot undo provider usage or charges already incurred. Errors retain `{model, provider_status, detail, retry_after_ms?}` without exposing provider bodies or keys. Draft checks do not save credentials or chat history; saved-key reuse and connection identity checks still apply.

The settings UI runs up to four overlapping probes without a fixed four-second gap. A rolling page-memory budget allows at most 19 probe starts per 60 seconds, reserving one request for discovery under the unchanged server limit of 20 AI requests/account/minute. The same account's budget survives repeated scans and credential edits; other tabs and chat may still consume server quota. HTTP 429 reduces overlap and pauses pending candidates for `Retry-After`, or a 30-second fallback, without retrying the failed model. Stop remains available during waiting. Quota errors mean temporarily unconfirmed, not permanent denial. Revoked keys, session errors or connection changes stop dispatch and clear affected choices.

Model discovery and verification continue when the learner visits another sidebar section. Returning to Settings preserves the current scan, progress, quota waiting and Stop control rather than reinitializing the form. A delayed older Settings response cannot overwrite a newer scan. Stop, changing credentials/profiles, logout or an account change still cancels the affected scan and discards late responses. Closing or reloading the browser page still ends the page-owned scan; it is not a server background job.

**Save & use selected model** saves a previously responding model without another inference request. An empty key field reuses only the chosen profile's key for the same URL and protocol. Cached choices are historical observations, not a current quota or pricing guarantee.

## Saved API profiles

Settings supports named profiles with two explicit save locations. **This device only** is the default for new profiles. **My account on the server** is opt-in. Save a profile with its name, URL and key before fetching models, or save it after checking models. Saving and switching never start catalog or generation calls.

Device profiles store keys encrypted with AES-GCM in IndexedDB, using a per-account non-extractable WebCrypto key and fresh IVs. Raw keys are not stored in localStorage. The active profile reference and historical model IDs/timestamps are non-secret metadata. This protects against casual plaintext storage inspection, not malicious same-origin scripts, browser compromise or access to an unlocked browser profile. It is not an OS credential vault.

Server profiles retain encrypted keys under `AI_KEY_SECRET`, scoped to the signed-in account. Public responses include `{id, name, protocol, base_url, model, key_last4, connection_id, models, checked_at}` but never raw keys or ciphertext. The opaque connection identity binds the account, protocol, normalized URL and key. Existing single saved connections migrate into an active named profile without replacing their encrypted key.

| Route | Behavior |
| --- | --- |
| `GET /api/ai/profiles` | `{profiles, active_id, can_store}` for the current account only |
| `POST /api/ai/profiles` | Save a new server profile; returns `{profile}`. Does not activate or call a provider. |
| `PUT /api/ai/profiles/{id}` | Update an owned server profile; blank key retains the existing key only for the same normalized endpoint/protocol |
| `POST /api/ai/profiles/{id}/activate` | Persist the active server profile without inference |
| `DELETE /api/ai/profiles/{id}` | Delete only that owned profile; deleting the active profile leaves no active server fallback |

Profile bodies accept `{name, protocol, base_url, model, api_key?, models?, checked_at?, connection_id?}`. A profile may have `model: ""` until the user checks and chooses a model; inference then fails closed. At most 20 profiles are retained per account per location. History is dropped when credentials change unless fresh history binds to the new connection. Cached history is never an authorization grant.

The browser remembers the active device/server choice per signed-in account. Reload restores its selected model and previous check time without scanning again. A device selection overrides only the current browser's requests; it does not overwrite the server's active profile. Deleting the selected profile does not silently switch to another, possibly paid connection. Profile switching discards in-flight discovery and old choices. Quota failures do not delete profiles, trigger paid fallback or cause automatic key rotation.

For `POST /api/chat`, `/api/kaiwa/evaluate`, `/api/tts` and `/api/ai/test`, the browser sends the selected device connection as `api_connection: {protocol, base_url, model, api_key}` inside the authenticated request body. The backend validates it under the same endpoint and model restrictions, uses it only for that request, and never persists its key. The key therefore still passes through the backend during inference even when its save location is device-only. Unsupported endpoints never receive that override. Rate limits remain account-wide across all profiles. Provider quota cannot be inferred universally; later requests may return rate-limit, credit, authentication or timeout errors.

Authenticated browser requests carry `X-VJBot-Account` as the expected account. The backend compares it with the actual cookie session before reading credentials, inference or profile writes; a stale tab after another tab signs into a different account receives `409 {code:"account_changed"}`. This header is a consistency guard, never authentication by itself.

Explicit server choices also send `X-VJBot-Profile`; inference resolves that owned profile rather than silently following another device's changed active default. A deleted, inaccessible or malformed selected profile fails closed. Missing profile JavaScript or corrupt device selection likewise blocks inference instead of using a server fallback. Other clients without an explicit selection continue to use the account's active default.

Apply `migrations/0014_api_profiles.sql` through the existing D1 migration process before deploying the new Worker. The migration preserves legacy ciphertext and the active model. Back up the database before changing its schema. CI dry-run only builds; it does not migrate production data.

### Probe timing sample

A controlled three-model fixture emitted its first visible text after 300 ms and finished after 2,400 ms. The previous paced/full-response scan took 10,404 ms; burst alone took 2,403 ms; streaming alone took 8,305 ms; both together took 303 ms, then 302 ms on repetition. Every variant passed the same three models. Both streaming runs cancelled all three streams before completion.

A separate six-request Cohere Trial comparison used `command-r7b-12-2024`, `tiny-aya-earth` and `tiny-aya-global` through the production LLM helpers. The old scan passed 3/3 in 8,428 ms; the new scan passed 3/3 in 441 ms. This is one paired upstream sample, not browser end-to-end timing, a provider-wide guarantee or a benchmark of long quota-limited catalogs.

The same three models also passed the authenticated local app's draft test endpoint through a real browser: the earlier paced run took 10,295 ms; the updated streaming/burst run took 588 ms. These timings cover those endpoint calls, not a complete scan of the 37-model catalog.
