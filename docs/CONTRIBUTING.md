# Hướng dẫn đóng góp

## Chạy cục bộ

Cần Node 22.13+ (test dùng `node:sqlite`).

```sh
npm ci
cp .dev.vars.example .dev.vars   # điền ADMIN_EMAILS, AI_KEY_SECRET, GOOGLE_CLIENT_ID
npm run dev                      # http://localhost:8787
```

- D1 cục bộ nằm trong `.cloudflare/state`. Áp migration mới vào đó trước khi thử (ví dụ `sqlite3 <file>.sqlite < migrations/00NN_*.sql`, với file nằm dưới `.cloudflare/state/v3/d1/`).
- Đăng nhập Google cục bộ cần origin `http://localhost:8787` trong Google OAuth. Cách nhanh để thử giao diện: đăng ký tài khoản email (mật khẩu 12+ ký tự) ngay trên trang.
- Muốn thử chat, vào Cài đặt > API AI và dùng API của bạn. Không có khóa hệ thống.

## Quy trình

1. Tạo nhánh từ `main`, commit nhỏ, push. CI (`Test & Quality Checks`) chạy ở mọi push.
2. Mở PR vào `main`, squash merge sau khi check xanh và mọi thread đã giải quyết.
3. Merge vào `main` tự deploy production (Workers Builds, kèm migration). Đừng merge khi chưa sẵn sàng deploy. Chi tiết ở [DEPLOYMENT_CICD](DEPLOYMENT_CICD.md).
4. Không thêm dòng đồng tác giả AI vào commit/PR.

## Kiểm tra trước khi mở PR

```sh
npm test
npm run build
git diff --check
```

`npm run test:python` chỉ cho `scripts/` và `app/` cũ. Test Node dùng DOM giả: với thay đổi giao diện hãy mở trang thật, kiểm tra bàn phím, 375 px và 1280 px, console, `prefers-reduced-motion`. Với thay đổi lưu dữ liệu, thử tải lại và hai tài khoản khác nhau. Đừng báo "đã xác nhận" Google login, giọng đọc hay chat khi chưa chạy thật; phân biệt rõ test cục bộ, CI và production.

## Quy ước

- **Ngôn ngữ giao diện**: chỉ tiếng Việt và tiếng Nhật. Không thêm chuỗi tiếng Anh vào giao diện, `title`, `aria-label`, `alt`. Dữ liệu nguồn tiếng Anh đi qua `vi-labels.js`/`vi-dict.json`.
- **Giữ stack hiện tại**: HTML/CSS/JS thuần. Không chuyển React nếu chưa thống nhất. Tránh thêm `!important` mới; xem [ROADMAP](ROADMAP.md) về việc gộp CSS.
- **Văn bản ngắn**: bỏ khẩu hiệu, nhãn phụ, chữ trợ giúp. Nếu màn hình cần chúng mới hiểu được thì sửa bố cục.
- **Trợ năng**: giữ điều hướng bàn phím, `dialog` gốc, mục chạm tối thiểu 44 px trên điện thoại, giảm chuyển động.
- **Bí mật**: không để khóa ở phía trình duyệt hay trong mã. Quyền sở hữu luôn do Worker xác định từ phiên, không tin `user_id` của client. Mọi URL do người dùng nhập đi qua `cleanBaseUrl` (`src/llm.js`).
- **Khóa AI**: chỉ dùng khóa của chính người dùng đó. Không bao giờ ghép URL của người này với khóa của người khác, và không trả lại nội dung lỗi thô từ nhà cung cấp.
- **Nội dung bài học**: dựa trên nguồn đã duyệt, giữ ghi công và giấy phép, không tuyên bố bao phủ toàn bộ JLPT. Không đổi ID đã có sang nhiệm vụ khác (ID có phiên bản như `practical:v1:...`).
- **Migration**: file mới, tương thích ngược, thêm vào danh sách trong `tests/worker.test.mjs`.
- **Phạm vi**: mỗi thay đổi có lý do trực tiếp; tái hiện lỗi trước khi sửa mã lân cận.

## Thay đổi prompt của thầy Lâm

`src/prompt.js` quyết định chất lượng dạy. Sau khi sửa: chạy `npm test`, rồi chạy tay một hội thoại 5 lượt (sai, gợi ý, đúng, tự giải thích, kết thúc) ở N5 và N3, và dán kết quả vào PR.
