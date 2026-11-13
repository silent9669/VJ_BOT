# VJBot · Sổ tay tiếng Nhật

[VJBot](https://vjbot.dangphuc.me/) giúp người Việt luyện JLPT N5–N1 theo lớp học đảo ngược: người học đọc bài trước, thầy Lâm hỏi, em tự nói và viết, thầy chỉ chấm và sửa. Giao diện chỉ dùng tiếng Việt và tiếng Nhật.

- **Learners bring their own API or OAuth connection.** Administrators automatically use server OpenAI for chat, read-aloud and GPT-Live, without entering a personal key. Saved personal connections remain intact; missing server configuration never falls back to them. The server key is never sent to the browser.
- **AI quản trị**: đổi model văn bản, mức suy luận và giọng GPT-Live trong Cài đặt > Model quản trị. Vào Thầy Lâm > Nói trực tiếp để hội thoại bằng micro.
- **Quản trị**: chủ sở hữu đăng nhập Google với email trong `ADMIN_EMAILS`; chủ sở hữu và admin có thể cấp/thu hồi quyền admin cho tài khoản đã đăng ký.
- Chạy trên Cloudflare Worker + D1; giao diện HTML/CSS/JS thuần.

## Chạy thử

```sh
npm ci
cp .dev.vars.example .dev.vars
# Điền GOOGLE_CLIENT_ID, ADMIN_EMAILS, OPENAI_API_KEY và AI_KEY_SECRET.
npm run migrate -- --local
npm run dev      # http://localhost:8787
npm test
```

Để dùng tài khoản kiểm thử cục bộ, đặt `LOCAL_TEST_ADMIN_PASSWORD` trong `.dev.vars`, rồi đăng nhập với tên `admin` và mật khẩu đó. Tài khoản tự dùng `OPENAI_API_KEY` phía máy chủ. Luồng này chỉ hoạt động trên localhost trong dev; không đặt secret kiểm thử trên Worker công khai.

## Triển khai

Merge vào `main` là tự deploy qua Cloudflare Workers Builds (kèm migration). GitHub Actions chỉ kiểm tra. Xem [Triển khai và CI](docs/DEPLOYMENT_CICD.md).

## Tài liệu

[Kiến trúc](docs/ARCHITECTURE.md) · [Tính năng](docs/FEATURES.md) · [API](docs/API_REFERENCE.md) · [Triển khai](docs/DEPLOYMENT_CICD.md) · [Đóng góp](docs/CONTRIBUTING.md) · [Việc cần làm](docs/ROADMAP.md)

Dữ liệu OpenJLPT (CC BY-SA 4.0) và ghi công: [Nguồn và quyền riêng tư](https://vjbot.dangphuc.me/sources.html).
