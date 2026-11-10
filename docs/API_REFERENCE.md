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
| `GET /api/admin/overview` | Chỉ admin (`403` nếu không): `{users, active_7d, messages_24h, messages_7d, own_api_users, top[]}` |
| `GET /api/admin/users?q=&offset=` | Danh sách 25 người dùng mỗi trang, tìm theo tên/email/ID: `{users[], total, offset, guests}`; mỗi người có `kind` (`google`\|`email`\|`guest`), `level`, `messages`, `items`, `completed`, `sessions`, `api`, `last_login`, `admin` |
| `POST /api/admin/purge-guests` | Xóa các hồ sơ khách cũ (không phải Google hay email) cùng dữ liệu: `{removed}` |
| `GET /api/admin/user?id=` | Chi tiết một người dùng (cùng trường như trên); `404` nếu không có |
| `POST /api/admin/user` | `{id, action, level?}` với `action` là `set_level` (cần `level` N5–N1), `clear_chat`, `reset_progress`, `remove_api`, `revoke_sessions` hoặc `delete`. Không thể `delete` chính tài khoản đang dùng |

Các route `/api/ai/*` và `/api/admin/*` do `src/providers.js` xử lý riêng, tự kiểm tra phiên và giới hạn body 4 KB.
