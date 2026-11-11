# API Worker

Tất cả route nằm dưới `/api`, trả JSON `{detail}` khi lỗi. Route "riêng tư" cần cookie `vj_session`; Worker lấy `user_id` từ phiên và bỏ qua `user_id`/`api_key` do client gửi. Thiếu phiên: `401`.

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
| `GET/DELETE /api/history` | General chat history, or one lesson selected by `lesson_id` and `level`. DELETE clears only that scope. `GET ?archive=legacy` reads preserved pre-migration history; the archive is read-only. |
| `POST /api/account/delete` | Xóa mọi dữ liệu của tài khoản |

## AI (riêng tư, cần API của người dùng)

Chat, Kaiwa và giọng đọc dùng API người dùng đã lưu; hạn mức 20 yêu cầu/phút mỗi tài khoản (`429` khi vượt).

| Route | Mô tả |
| --- | --- |
| `POST /api/chat` | `{message ≤ 6000 characters, lesson?: {id,level}, screen?: {route,title,level?,text ≤ 3500}, channel?: 'chat'\|'quick', request_id?}`. Lesson IDs resolve against the server-owned catalog; unknown IDs and client-supplied lesson content return 400. Returns `{reply, updated_topic}`. A request UUID cannot be reused in another conversation scope (409). |
| `POST /api/chat/greeting` | Fixed greeting stored only in general chat. |
| `POST /api/kaiwa/evaluate` | `{scenario_id, prompt_index?: 0, user_speech, level}`. The server resolves the question and scenario; client-supplied `scenario_title`, `context` and `prompt_jp` are rejected. Returns `{score, rating, feedback, model_answer, user_text, scenario}` after strict validation. |
| `POST /api/tts` | `{text}` → `{audioBase64, ...}`; `403 {code:'no_tts'}` nếu API đã lưu không phải Gemini-Google (client dùng giọng trình duyệt) |

Mã lỗi AI chung: `403 {code:'no_ai'}` chưa lưu API; `409 {code:'rekey'}` không giải mã được khóa; `429` hết lượt; `503` nhà cung cấp lỗi (thông báo tiếng Việt, không lộ nội dung lỗi gốc).

### Prompt-injection boundaries

- Trusted tutor and grading instructions occupy the provider's system field. Screen text, canonical source material, learner notes, quoted history and the current submission occupy a JSON user envelope; embedded role labels do not create provider roles.
- Lessons resolve by `{id,level}` against `course/teacher-N5.json` through `teacher-N1.json`, generated from the same repository-owned lesson builders as the UI. Missing catalogs return 503 before inference. `npm run teacher:catalog` regenerates them; `npm run dev`, `build` and `deploy` run it automatically.
- Learner notes use canonical curriculum/catalog labels. Arbitrary `progress.display` values and unknown item IDs never enter the model's notes. Existing progress records and UI labels are preserved.
- History is scoped to general chat, a canonical lesson, or a quick-chat screen route. Previous assistant responses are quoted data, never replayed as authoritative assistant messages. Migration `0015_conversation_scope.sql` archives existing rows without deleting them. Use `GET /api/history?archive=legacy` to read them. Number 0014 is reserved by the separate API-profile change; this migration does not depend on that change.
- Kaiwa requests schema-constrained output using OpenAI `response_format.json_schema`, Anthropic `output_config.format`, or Gemini `responseJsonSchema`. Unsupported providers fail visibly; no unconstrained retry is performed. Server validation requires exactly four fields, integer score 0–100, a consistent rating and bounded nonempty feedback/model-answer strings. Invalid output returns 503, not a successful grade.
- Kaiwa screen capture excludes generated feedback and learner submissions. It captures only the scenario and current question.
- These are defense-in-depth boundaries, not proof that an LLM cannot be manipulated. Schema validation verifies structure, not grading truth. Model discovery and connection probes are not security evaluations.
- Local tests use synthetic provider responses, not live attack-success measurements. No deployment or paid inference is implied.


## API người dùng và quản trị

| Route | Mô tả |
| --- | --- |
| `GET /api/ai/settings` | `{source: 'own'\|'none', is_admin, own: {protocol, base_url, model, key_last4}, bases, can_store}`; không bao giờ trả khóa |
| `PUT /api/ai/settings` | `{protocol: 'openai'\|'anthropic'\|'gemini', base_url (bỏ trống = mặc định), model, api_key?}`; bỏ `api_key` để giữ khóa cũ. `503` nếu thiếu `AI_KEY_SECRET` |
| `DELETE /api/ai/settings` | Xóa API đã lưu |
| `POST /api/ai/test` | Gửi một yêu cầu thử qua API đã lưu |
| `GET /api/admin/overview` | Chỉ admin (`403` nếu không): `{users, active_7d, messages_24h, messages_7d, own_api_users, top[]}` |
| `GET /api/admin/users?q=&offset=` | Danh sách 25 người dùng mỗi trang, tìm theo tên/email/ID: `{users[], total, offset, guests}`; mỗi người có `kind` (`google`\|`email`\|`guest`), `level`, `messages`, `items`, `completed`, `sessions`, `api`, `last_login`, `admin` |
| `POST /api/admin/purge-guests` | Xóa các hồ sơ khách cũ (không phải Google hay email) cùng dữ liệu: `{removed}` |
| `GET /api/admin/user?id=` | Chi tiết một người dùng (cùng trường như trên); `404` nếu không có |
| `POST /api/admin/user` | `{id, action, level?}` với `action` là `set_level` (cần `level` N5–N1), `clear_chat`, `reset_progress`, `remove_api`, `revoke_sessions` hoặc `delete`. Không thể `delete` chính tài khoản đang dùng |

Các route `/api/ai/*` và `/api/admin/*` do `src/providers.js` xử lý riêng, tự kiểm tra phiên và giới hạn body 4 KB.
