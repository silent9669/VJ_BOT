# VJBot · Học tiếng Nhật cùng thầy Lâm

[VJBot](https://vjbot.dangphuc.me/) là ứng dụng web giúp người Việt luyện JLPT N5–N1 theo mô hình **lớp học đảo ngược**: em đọc bài trước, thầy Lâm (AI) hỏi, em tự nói và tự viết, thầy chỉ chẩn đoán và sửa. Giao diện chỉ có tiếng Việt và tiếng Nhật, tối ưu cho Safari trên iPhone (Liquid Glass, safe-area, cảm ứng).

## Tính năng chính

- **Lộ trình N5–N1**: 40 chương ngữ pháp, 20 tình huống thực tế viết bằng tiếng Việt, thư viện từ vựng, ngữ pháp, Hán tự, đọc, nghe, viết (10.720 mục OpenJLPT).
- **Chat với thầy Lâm**: mỗi lượt một câu hỏi, chẩn đoán đúng câu em viết, sửa tối đa hai lỗi, bậc gợi ý không lộ đáp án. Hiểu em đang xem bài, thẻ nhớ hay bài tập nào.
- **Kaiwa**: luyện nói, AI chấm theo tiêu chí và cho điểm ước tính (không phải điểm chính thức).
- **Thẻ nhớ SM-2**, bài luyện JLPT, thi thử có tính giờ theo đề chính thức (liên kết nguồn), theo dõi tiến độ.
- **Voice (quản trị viên)**: hội thoại trực tiếp GPT-Live qua WebRTC, theo lượt (thầy nói xong em mới nói), phụ đề song ngữ có mốc thời gian, lệnh nhanh dùng chung prompt với chat.
- **Quản trị**: quản lý người dùng, cấp quyền admin, chọn model và giọng nói.
- **Tự mang API**: người học gắn API của mình (OpenAI-compatible, Claude, Gemini hoặc Antigravity OAuth); khóa được mã hóa, không có AI dùng chung.

## Công nghệ

| Lớp | Công nghệ |
| --- | --- |
| Chạy | Cloudflare Workers (một Worker vừa phục vụ file tĩnh vừa chạy API), placement `gcp:us-east4` |
| Dữ liệu | Cloudflare D1 (SQLite), migration trong `migrations/` |
| Giao diện | HTML, CSS, JavaScript thuần (không framework, không bundler), lớp `ios.css` cho Safari/iOS |
| Xác thực | Google Identity (xác minh ID token bằng `jose`), email/mật khẩu (scrypt qua `@noble/hashes`), phiên cookie HttpOnly |
| Bảo mật khóa | AES-GCM (Web Crypto) cho API key người dùng; URL do người dùng nhập chỉ nhận HTTPS công khai |
| AI | OpenAI-compatible, Anthropic Claude, Google Gemini; Antigravity qua cổng OAuth; OpenAI GPT-Live (WebRTC) và TTS cho giọng nói |
| Dữ liệu học | OpenJLPT (CC BY-SA 4.0), kịch bản Kaiwa và rubric tự viết, catalog giáo viên sinh bằng `scripts/build_teacher_catalog.mjs` |
| Công cụ | `cf` CLI, Vite plugin của Cloudflare (dev), Node test runner với `node:sqlite`, Python cho script thu thập và dịch dữ liệu |
| CI/CD | GitHub Actions (test và build thử), Cloudflare Workers Builds (deploy khi merge vào `main`) |

## Chạy thử

Cần Node 22.13+.

```sh
npm ci
cp .dev.vars.example .dev.vars
# Điền GOOGLE_CLIENT_ID, ADMIN_EMAILS, OPENAI_API_KEY và AI_KEY_SECRET.
npm run migrate -- --local
npm run dev      # http://localhost:8787
npm test
```

Để dùng tài khoản kiểm thử cục bộ, đặt `LOCAL_TEST_ADMIN_PASSWORD` trong `.dev.vars`, rồi đăng nhập với tên `admin` và mật khẩu đó. Luồng này chỉ hoạt động trên localhost trong dev; không đặt secret kiểm thử trên Worker công khai.

## Triển khai

Merge vào `main` là tự deploy qua Cloudflare Workers Builds (kèm migration); test chạy ở GitHub Actions và là check bắt buộc trước khi merge. Xem [Triển khai và CI](docs/DEPLOYMENT_CICD.md).

## Tài liệu

[Kiến trúc](docs/ARCHITECTURE.md) · [Tính năng](docs/FEATURES.md) · [API](docs/API_REFERENCE.md) · [Triển khai](docs/DEPLOYMENT_CICD.md) · [Đóng góp](docs/CONTRIBUTING.md) · [Việc cần làm](docs/ROADMAP.md)

Dữ liệu OpenJLPT (CC BY-SA 4.0) và ghi công: [Nguồn và quyền riêng tư](https://vjbot.dangphuc.me/sources.html).
