# VJBot · Sổ tay tiếng Nhật

[VJBot](https://vjbot.dangphuc.me/) giúp người Việt luyện JLPT N5–N1 theo lớp học đảo ngược: người học đọc bài trước, thầy Lâm hỏi, em tự nói và viết, thầy chỉ chấm và sửa. Giao diện chỉ dùng tiếng Việt và tiếng Nhật.

- **Không có AI dùng chung.** Muốn chat, chấm Kaiwa hay nghe giọng Gemini, mỗi người gắn API của mình trong Cài đặt (OpenAI-compatible, Claude hoặc Gemini).
- **Có mục Quản trị** cho tài khoản Google admin (thống kê hoạt động).
- Chạy trên Cloudflare Worker + D1; giao diện HTML/CSS/JS thuần.

## Chạy thử

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run dev      # http://localhost:8787
npm test
```

## Triển khai

Merge vào `main` là tự deploy qua Cloudflare Workers Builds (kèm migration). GitHub Actions chỉ kiểm tra. Xem [Triển khai và CI](docs/DEPLOYMENT_CICD.md).

## Tài liệu

[Kiến trúc](docs/ARCHITECTURE.md) · [Tính năng](docs/FEATURES.md) · [API](docs/API_REFERENCE.md) · [Triển khai](docs/DEPLOYMENT_CICD.md) · [Đóng góp](docs/CONTRIBUTING.md) · [Việc cần làm](docs/ROADMAP.md)

Dữ liệu OpenJLPT (CC BY-SA 4.0) và ghi công: [Nguồn và quyền riêng tư](https://vjbot.dangphuc.me/sources.html).
