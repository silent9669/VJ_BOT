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
| `GET/DELETE /api/history` | General chat history, or one lesson selected by `lesson_id` and `level`. DELETE clears conversations, teaching state and request claims only for that scope, invalidating any running generation. `GET ?archive=legacy` reads preserved pre-migration history; the archive is read-only. |
| `POST /api/account/delete` | Xóa mọi dữ liệu của tài khoản |

## AI (riêng tư, cần API của người dùng)

Chat and speaking feedback use the learner's selected API-key or Antigravity OAuth connection. Read-aloud uses a separate selected Google Gemini API-key profile. AI requests share a limit of 20 requests per minute per VJBot account (`429` when exceeded).

| Route | Mô tả |
| --- | --- |
| `POST /api/chat` | `{message ≤ 6000 characters, lesson?: {id,level}, focus?: {kind:'word'\|'example'\|'question',index:integer ≥ 0}, intent?: 'message'\|'start'\|'hint'\|'explain'\|'situation'\|'check'\|'summary'\|'restart', screen?: {route,title,level?,text ≤ 3500}, channel?: 'chat'\|'quick', request_id?}`. Canonical lesson/item membership is server-validated. Returns plain `{reply,response,updated_topic}`; internal teaching fields are not exposed. A completed retry returns its saved reply. Concurrent or changed-payload UUID reuse returns 409. |
| `POST /api/kaiwa/evaluate` | `{scenario_id, prompt_index?: 0, user_speech, level}`. The server resolves the question and scenario; client-supplied `scenario_title`, `context` and `prompt_jp` are rejected. Returns `{score, rating, feedback, model_answer, user_text, scenario}` after strict validation. |
| `POST /api/tts` | `{text, speech_model?}` returns `{audioBase64, mimeType, voice, model}`. `{action:"models"}` lists compatible speech candidates without audio generation. Official OpenAI connections (including admin shared access) use `gpt-4o-mini-tts` and `alloy`; selected Google Gemini profiles retain their speech models. Unsupported providers return `403 {code:"no_tts"}`; no browser-voice fallback. |

TTS sends `text` as the verbatim transcript. Reading directions stay in `speech_metadata`, never prepended to spoken text, preserving the transcript fix merged in PR #24.

Common AI failures: `403 {code:"no_ai"}` for a missing selected API, `409 {code:"rekey"}` for an undecryptable key, `409 {code:"profile_changed"}` for a removed pinned profile, `403 {code:"oauth_model"}` for an unselected OAuth model, `409/503 {code:"oauth_reconnect"}` for unavailable OAuth, `429` for quota/rate limits and `503` for provider failures. Provider response bodies and secrets are not exposed.

### Grounded tutor sessions

- Both classroom chat and the quick popover send the selected canonical lesson and optional focus. Focus is a zero-based position within that lesson's complete word/example/question collection, not an option index. Extra keys, unsupported kinds, negative/noninteger indexes, missing lesson references and out-of-range selections return 400 before inference.
- The model receives a compact lesson overview plus the exact selected record. Question focus includes authored answers/options and relevant examples; source IDs and URLs remain attached. These fields support diagnosis, not permission to reveal answers. Ungraded corpus sentences are not treated as certified N5/N4 grammar.
- `intent` defaults to `message`; natural learner requests still reach the model. Buttons supply explicit actions. A `hint` response cannot declare itself a solution. Repeated hints preserve the unresolved probe and saturate at scaffold stage two, never an automatic answer stage. Schema checks do not prove that the visible prose obeys these semantic constraints.
- Existing lesson entry restores history without sending a new start. `restart` keeps stored UI history but establishes a fresh model-history boundary and teaching state only after successful generation. Failed restarts leave the previous boundary intact.
- Apply `0019_tutor_sessions.sql` after the existing migrations through `0018_antigravity_accounts.sql` before serving this code. It adds account/scope teaching state and expiring database request/scope leases without changing API profiles or OAuth bindings. Identical in-flight UUIDs and another running message in the same scope return 409 without a second provider generation. Expired owners cannot commit after takeover or cleanup. A pre-migration request UUID without a bound fingerprint cannot be replayed; send a new UUID. Back up the database before migration; local build checks do not migrate production.
- Retry identity includes an explicit `X-VJBot-Profile` selection and transient device connection fields, persisted only as a digest. Reusing the UUID with a different explicit selection returns 409. Clients without a pinned selection retain active-default behavior; editing a saved profile under the same ID does not change its retry identity.
- Tutor providers must support native structured output `{reply,action,open_probe}`. Invalid JSON, incompatible explicit actions and known truncated/blocked finish metadata return 503 without persisting a completed turn or replacing previous teaching state. No unconstrained retry or automatic provider switch is added. `request_id` remains optional for external callers; browser entry points always generate one.
- The unused Worker `POST /api/chat/greeting` endpoint has been removed. Start a tutor session through `POST /api/chat` with `intent: 'start'`; it shares normal generation ownership, validation, rate limits and teaching state. The separate Python application's GET route is unchanged.

### Tutor evaluation

`node scripts/evaluate_tutor.mjs` inspects the 12 authored cases offline and never sends inference. `node scripts/evaluate_tutor.mjs --report <recording.json>` validates retained case/step bindings. Both report `HUMAN_REVIEW_REQUIRED`; transport or structural success does not certify Japanese, grading or teaching quality.

Only after explicit authorization for the saved provider's usage, set `TUTOR_EVAL_COOKIE` in the local environment and run:

```sh
node scripts/evaluate_tutor.mjs --live --base-url http://127.0.0.1:8787 --output <new-recording.json>
```

Live mode accepts loopback origins only, refuses an existing output file, isolates cases in new quick-chat routes, records actual replies without credentials, stops on transport failure and never retries inference. Request starts are spaced by at least 3.1 seconds to respect the account's 20-request/minute limit; each step times out after 35 seconds. It does not delete learner history or change provider settings. Supply human review decisions separately; no approval is fabricated.


### Prompt-injection boundaries

- Trusted tutor and grading instructions occupy the provider's system field. Screen text, canonical source material, learner notes, quoted history and the current submission occupy a JSON user envelope; embedded role labels do not create provider roles.
- Lessons resolve by `{id,level}` against `course/teacher-N5.json` through `teacher-N1.json`, generated from the same repository-owned lesson builders as the UI. Missing catalogs return 503 before inference. `npm run teacher:catalog` regenerates them; `npm run dev`, `build` and `deploy` run it automatically.
- Learner notes use canonical curriculum/catalog labels. Arbitrary `progress.display` values and unknown item IDs never enter the model's notes. Existing progress records and UI labels are preserved.
- History is scoped to general chat, a canonical lesson, or a quick-chat screen route. Previous assistant responses are quoted data, never replayed as authoritative assistant messages. Migration `0015_conversation_scope.sql` archives existing rows without deleting them. Use `GET /api/history?archive=legacy` to read them. Number 0014 is reserved by the separate API-profile change; this migration does not depend on that change.
- Kaiwa requests schema-constrained output using OpenAI `response_format.json_schema`, Anthropic `output_config.format`, or Gemini `responseJsonSchema`. Unsupported providers fail visibly; no unconstrained retry is performed. Server validation requires exactly four fields, integer score 0–100, a consistent rating and bounded nonempty feedback/model-answer strings. Invalid output returns 503, not a successful grade.
- Visible Kaiwa sessions contribute only scenario/question text; hidden sessions contribute nothing. Feature hubs/lists use their visible content instead. Route-derived levels override stale curriculum selections. Learner inputs, generated feedback and grading results are excluded from screen reference.
- These are defense-in-depth boundaries, not proof that an LLM cannot be manipulated. Schema validation verifies structure, not grading truth. Model discovery and connection probes are not security evaluations.
- Local tests use synthetic provider responses, not live attack-success measurements. No deployment or paid inference is implied.

Integration evidence: the security branch combined with PR #22 at `b417dca52f512d49d5feb93a1f36864a70dfc0d8` passed all 173 Node tests and the Cloudflare build dry-run. On Windows, the unchanged pinned lesson assets were restored from their Git blobs with LF bytes for the hash check; no manifest or test assertion was changed.

Chromium exercised lesson-scoped history, the lesson-reference-only chat payload, return to general chat, canonical Kaiwa references, and exclusion of submitted text and generated feedback from screen capture. API responses and the signed-in account were synthetic and isolated. No live model call, existing-database migration, production deployment or merge to main was performed.


## API người dùng và quản trị

| Route | Mô tả |
| --- | --- |
| `GET /api/ai/settings` | `{source: 'own'\|'platform'\|'none', is_admin, platform: {configured, model} hoặc null, own: {protocol, base_url, model, key_last4}, bases, can_store}`; không bao giờ trả khóa |
| `PUT /api/ai/settings` | `{protocol: 'openai'\|'anthropic'\|'gemini', base_url (bỏ trống = mặc định), model, api_key?}`; bỏ `api_key` để giữ khóa cũ. `503` nếu thiếu `AI_KEY_SECRET` |
| `DELETE /api/ai/settings` | Xóa API đã lưu |
| `POST /api/ai/test` | Gửi một yêu cầu thử qua API đã lưu |
| `POST /api/ai/models` | Lists models using draft `{protocol, base_url, api_key?}` without saving credentials or generating content. Returns `{models, truncated, scope, free_only}`; see Model discovery below. |
| `GET /api/admin/overview` | Chỉ admin (`403` nếu không): `{users, active_7d, messages_24h, messages_7d, own_api_users, top[]}` |
| `GET /api/admin/users?q=&offset=` | Danh sách 25 người dùng mỗi trang, tìm theo tên/email/ID: `{users[], total, offset, guests}`; mỗi người có `kind` (`google`\|`email`\|`guest`), `level`, `messages`, `items`, `completed`, `sessions`, `api`, `last_login`, `admin` |
| `POST /api/admin/purge-guests` | Xóa các hồ sơ khách cũ (không phải Google hay email) cùng dữ liệu: `{removed}` |
| `GET /api/admin/user?id=` | Chi tiết một người dùng (cùng trường như trên); `404` nếu không có |
| `POST /api/admin/user` | `{id, action, level?, role?}` với `action` là `set_level` (cần `level` N5–N1), `set_role`, `clear_chat`, `reset_progress`, `remove_api`, `revoke_sessions` hoặc `delete`. `set_role` nhận `role: admin` hoặc `free`, chỉ áp dụng cho Google/email đã đăng ký. Không thể sửa quyền bản thân hay chủ sở hữu; không thể xóa chủ sở hữu hay chính tài khoản đang dùng |

API-key and admin routes are handled by `src/providers.js`; Antigravity account routes are handled separately by `src/antigravity-oauth.js`. Both authenticate the VJBot session. Profile creation/update and active-setting writes accept at most 128 KiB of UTF-8 JSON for bounded model history; other API-key JSON bodies retain the 4 KiB limit.

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

### Resume an unfinished scan

The browser stores a bounded `vjbot_ai_scan_v1` checkpoint per account and opaque connection identity, not the raw API key. It records the catalog, successful/failed/dispatched model IDs and rolling request timestamps/cooldown. Each dispatch is checkpointed before sending the request. Stop or reload preserves this checkpoint; continuing fetches the catalog again to validate the actual key and endpoint, then requests only model IDs never dispatched. Earlier successes remain visibly historical. Completed failures and requests interrupted after dispatch are not retried automatically, because upstream quota or charges may already have been consumed.

**Continue unchecked models** is the default. If all candidates already have a dispatch record, the button shows saved results without another generation. **Recheck all models (uses quota again)** explicitly starts a fresh generation pass after confirmation, while retaining applicable cooldown/rate budget. Invalid checkpoints fail closed until an explicit fresh recheck. When Web Locks is available, a second tab cannot start a simultaneous scan for the same account/connection. Browser storage failures show a warning; progress cannot then be guaranteed across reloads. Checkpoints created before this feature are unavailable and cannot reconstruct unseen requests.

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

### Connection-manager storage boundaries

The connection manager combines saved API-key profiles and Antigravity accounts under the signed-in **VJBot account**, not under a browser session or a displayed email alone. VJBot login and provider OAuth login are separate identities.

| Connection | Secret storage | Saved choices and lifetime |
| --- | --- | --- |
| API key: this device | Per-owner AES-GCM IndexedDB profile | Restores in this browser/origin for the same VJBot account; does not sync to another device |
| API key: server | D1 ciphertext under `AI_KEY_SECRET` and owner-bound AAD | Owned named profiles, selected model and matching historical checks survive app logout/login |
| Antigravity OAuth | Dedicated gateway's private credential store | D1 stores an opaque connection ID, gateway binding, unique routing prefix and per-connection model; gateway refreshes its own provider token |

Changing the app session does not erase completed connections. Expired pending authorization must restart; revoked provider grants or invalid refresh credentials require reconnection. Deleting one connection must not select another implicitly. Account deletion removes every owned gateway connection before deleting local ownership records. Provider permission revocation remains a separate Google action.

The **Accounts & models** panel starts with the current saved model and **Chat with Thay Lam**. The **My account** chooser switches saved API-key profiles and OAuth accounts without regenerating content. **Add account** opens an explicit choice between API key and Google/Antigravity sign-in; canceling an API draft restores the saved setup and clears the unsaved key. An OAuth model test/save action appears only for a changed selection, with a quota/cost warning; the old model stays active until success. Connection details, API model discovery/resume, OAuth account management, per-model limits and read-aloud settings open on demand. The overview displays only the currently reported lowest model percentage, not a percentage range or shared account balance. Storage/security explanations remain available under **Storage & privacy**. Each OAuth account retains its own model. API scan checkpoints remain tied to the exact account, protocol, URL and key.

Remaining usage includes a native meter for each model with a known finite fraction. Missing data has no meter; exhausted quota has an empty meter and an explicit 0% label. The overview meter represents the lowest reported model limit, not a sum, average or shared account balance.

### Antigravity remaining quota

`GET /api/ai/oauth/antigravity/usage?connection_id=<opaque-id>` reads only the current user's requested saved OAuth account. It returns `{connection_id, available, checked_at, models:[{model, remaining_fraction, reset_at}], detail?}`. Zero is exhausted quota; missing data is unavailable, never zero or unlimited.

The backend chooses the owned gateway credential and uses the fixed daily Antigravity `fetchAvailableModels` metadata endpoint through the gateway's authenticated API-call transport. The browser cannot choose the upstream URL, project, auth index, token or headers. Only quota fields and bounded model IDs cross the application boundary; upstream error bodies do not.

Fractions and reset timestamps are provider observations at `checked_at`, not guaranteed future access, billable credit balances or remaining request counts. Native quota model IDs are displayed as supplied; the app does not assume they equal a gateway's chat alias. Opening or refreshing quota never tests models, generates content, resets quota or buys credits. API-key providers without an implemented usage endpoint display unavailable rather than an estimated OAuth-style balance.


### Probe timing sample

A controlled three-model fixture emitted its first visible text after 300 ms and finished after 2,400 ms. The previous paced/full-response scan took 10,404 ms; burst alone took 2,403 ms; streaming alone took 8,305 ms; both together took 303 ms, then 302 ms on repetition. Every variant passed the same three models. Both streaming runs cancelled all three streams before completion.

A separate six-request Cohere Trial comparison used `command-r7b-12-2024`, `tiny-aya-earth` and `tiny-aya-global` through the production LLM helpers. The old scan passed 3/3 in 8,428 ms; the new scan passed 3/3 in 441 ms. This is one paired upstream sample, not browser end-to-end timing, a provider-wide guarantee or a benchmark of long quota-limited catalogs.

The same three models also passed the authenticated local app's draft test endpoint through a real browser: the earlier paced run took 10,295 ms; the updated streaming/burst run took 588 ms. These timings cover those endpoint calls, not a complete scan of the 37-model catalog.

## Antigravity account OAuth

Settings offers **API key** and **Antigravity**. The earlier Google Cloud OAuth experiment is retired; users do not need to create a Google Cloud project to connect an Antigravity account here. VJBot Google sign-in remains a separate feature.

Antigravity uses a dedicated [CLIProxyAPI v8 gateway](https://github.com/router-for-me/CLIProxyAPI/releases/tag/v8.0.67). This is a third-party gateway integration, not a claim that Antigravity subscriptions expose the public Gemini API or a TTS API. The user must personally review Google's permissions and complete consent. Do not bypass provider warnings, eligibility checks or account restrictions.

**Gateway compatibility:** the unmodified 8.0.67 release completes normal Antigravity login with only `status: ok`; it does not retain the `auth_id`/saved/adopted outcome needed for safe per-user binding. Apply `scripts/antigravity-oauth-outcome.patch` to the pinned 8.0.67 source and build that gateway, or use a future gateway version only after confirming the same completion contract. Do not remove VJBot's identity checks or guess the account from catalog changes. The patch changes only the existing Antigravity completion call's `alwaysTrackOutcome` argument to `true`, preserving the existing save/adoption path.

For a source checkout at tag `v8.0.67` with Go 1.26.10 or newer:

```sh
git apply /path/to/VJ_BOT/scripts/antigravity-oauth-outcome.patch
CGO_ENABLED=0 go build -p=1 -trimpath -buildvcs=false -o cli-proxy-api ./cmd/server
```

Use an `.exe` output name on Windows. A patched build is not the unmodified official release binary. Keep its private configuration and credentials outside the application repository.

### Operator setup

1. Run a dedicated gateway with its own private credential directory. Do not import credentials from OMP, another application or an existing shared account pool.
2. Bind the gateway to loopback for a local preview. Set `routing.force-model-prefix: true`, disable automatic generation retries and disable Antigravity credits fallback. Use separate management and inference client keys; disable the control panel, automatic panel downloads, discovery, plugins and request-body logging unless independently required.
3. Configure server-only `ANTIGRAVITY_GATEWAY_URL`, `ANTIGRAVITY_MANAGEMENT_KEY`, `ANTIGRAVITY_API_KEY` and the existing `AI_KEY_SECRET`. Never put these in browser storage, Git or screenshots. Local HTTP loopback additionally requires `ANTIGRAVITY_ALLOW_LOOPBACK=true`; that flag is intentionally absent from production bindings.
4. Cloudflare Workers cannot run the gateway executable or reach this laptop's loopback. Production needs an operator-protected, reachable **HTTPS** gateway with authenticated management access. Do not publish the raw local management port. No gateway hosting or production deployment is provisioned by this feature.
5. Back up existing data, then apply migrations through `0018_antigravity_accounts.sql` using the approved migration process. Migration 0018 copies existing OAuth identities, prefixes and per-account models into multiple-account storage and preserves the selected account. Migration 0016 remains historical and unused for new inference. Build dry-run does not migrate production.
6. Choose **Add account → Sign in with Google**, optionally label the account, then continue Google sign-in. The gateway owns authorization-code exchange, refresh and its private token files. VJBot stores only account bindings and encrypted, session-bound pending metadata, never provider access/refresh tokens.
7. Complete Google sign-in personally. A local callback opens automatically when browser and gateway run on this machine. For a remote gateway, the expandable callback control accepts only the exact callback origin, port, path and state from that session; VJBot never fetches the pasted URL.
8. Choose a different model and press **Test & save this model**. This sends one generation and may consume quota or incur charges. Only visible text commits the model; a catalog entry or successful login is not inference verification.

### Routes and isolation

All routes require a VJBot session. Mutations require matching `Origin`; `X-VJBot-Account` rejects stale-tab account drift. Pending OAuth is bound to the exact session, expires after five minutes and can resume after reload. Only one pending authorization can own the gateway's fixed callback listener at a time; established saved accounts and chat connections are not serialized.

| Route | Behavior |
| --- | --- |
| `GET /api/ai/oauth/antigravity` | Returns owned `connections:[{id,name,model,state}]`, `active_id`, the active connection's status and only this session's pending sign-in; never exposes gateway keys, credential files or another account. |
| `POST /api/ai/oauth/antigravity/start` | Reserves the callback slot and returns an allow-listed Google authorization URL. Adds another account without deleting existing connections. |
| `POST /api/ai/oauth/antigravity/status` | Accepts `{handle}`. Requires the exact gateway completion identity, reserves unique ownership and sets a unique credential prefix before storing/activating the new connection. |
| `POST /api/ai/oauth/antigravity/callback` | Accepts `{handle, redirect_url}` for manual callback forwarding to the fixed gateway endpoint; rejects mismatched state and arbitrary destinations. |
| `POST /api/ai/oauth/antigravity/cancel` | Cancels the owned sign-in. A completed result belonging to another VJBot account is never deleted. |
| `POST /api/ai/oauth/antigravity/connections/{id}/activate` | Selects only that owned completed account. Does not generate content or replace other accounts. |
| `GET /api/ai/oauth/antigravity/models?connection_id={id}` | Reads exactly that owned credential's catalog, requires correctly prefixed IDs, excludes known non-chat IDs and reports `verified:false`; no generation. |
| `PUT /api/ai/oauth/antigravity/model` | Accepts `{connection_id,model}`. Requires catalog membership, uses the shared limiter and changes only that connection's model after one successful visible-text probe. |
| `GET /api/ai/oauth/antigravity/usage?connection_id={id}` | Returns sanitized remaining fractions, native model IDs and reset/check timestamps for that account, or an explicit unavailable result. No generation or quota reset. |
| `DELETE /api/ai/oauth/antigravity` | Accepts `{connection_id}`. Removes only the requested owned gateway credential before its local binding. Failure keeps closed ownership for retry. Active deletion leaves no implicit fallback. |

Chat and speaking feedback pin `X-VJBot-Profile: antigravity_oauth:<connection-id>`. The backend routes only that owned connection's `<unique-account-prefix>/<selected-model>`. Strict-prefix routing is checked before use; a missing, disabled, mismatched, unqualified or disconnected selection fails closed. No unprefixed request, account-pool fallback or API-key fallback is used. A provider account cannot be linked to two VJBot users.

Account deletion and administrative API removal remove all owned gateway connections first. A gateway failure remains an error and preserves remaining local ownership for retry rather than claiming every credential was erased. Disconnecting one account does not remove the others. Google permissions can be revoked separately by the user.

### Voice remains separate

Read-aloud uses the API-key profile selected under **API key**, even when chat uses Antigravity. Google profiles retain `gemini-3.8-flash-tts`, Charon and the existing explicit compatible-model selector. Official OpenAI profiles and admin shared access use `gpt-4o-mini-tts` with alloy. Requests use the resolved provider key, never the gateway management key or Antigravity OAuth credentials. An explicit Antigravity profile on the TTS endpoint is rejected. Quota errors remain errors; there is no browser-voice fallback or silent voice/model substitution.

Sources: [gateway configuration](https://help.router-for.me/configuration/options), [v8 management API](https://help.router-for.me/management/apiv8), [Antigravity Voice Mode](https://antigravity.google/docs/voice-mode.md), [Gemini TTS](https://ai.google.dev/gemini-api/docs/speech-generation).

## Admin AI preferences and live conversation

- `GET /api/admin/ai`: admin-only configured state, per-account settings, supported text models, reasoning efforts and live voices. Never returns a key.
- `PUT /api/admin/ai`: `{model,reasoning_effort,live_voice}`; validates the model's reasoning enum and persists it for this admin. Personal API profiles retain precedence. Settings apply to new text requests and new calls.
- `POST /api/live`: authenticated admin only, with `X-VJBot-Account` matching the cookie. Accepts `{sdp,level,lesson?:{id,level}}` (64 KiB max, audio only). The Worker resolves canonical lesson context and exchanges SDP with OpenAI `/v1/live/sessions` using its secret. Returns only the answer SDP, opaque session ID, model, voice and greeting.
- GPT-Live uses `gpt-live-1` and delegates detailed explanations to the admin's selected text model/reasoning. The untrusted WebRTC data channel can only append greeting commentary or close a session; it cannot change model, instructions, tools or server settings. No tools are configured.
- Microphone and generated audio travel over WebRTC to/from OpenAI. Captions stay in this page and are not saved as text chat or progress. Explicit End stops microphone input immediately, sends `session.close`, then releases the transport after `session.closed` (or a bounded timeout). Navigation releases media; calls close after ten minutes in the client.
- Startup shares the account AI request limiter and checks the current admin grant. Revocation stops new calls; it does not disconnect an already established OpenAI media session.
- Local dev can declare `LOCAL_TEST_ADMIN_PASSWORD` from ignored `.dev.vars`. Username `admin` creates a local session/grant only when the URL host is loopback. Both the local flag and host are checked when that session is read, so its cookie is unusable on the public host. Production config never declares this binding.
- Apply `0021_admin_ai_preferences.sql` after migration 0020. Account deletion removes preferences along with the existing owned data.

API references: [GPT-Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), [live session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations), [model reasoning](https://developers.openai.com/api/docs/guides/reasoning).
