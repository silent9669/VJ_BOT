# Manga Club — bản thử cục bộ

## Mở bản thử

Mở `http://127.0.0.1:8787/?ui=manga`. Thanh đầu trang cho phép chuyển giữa **B · Manga Club** và **Giao diện hiện tại** mà không xóa tài khoản hoặc tiến độ. Dùng `?ui=current` để mở trực tiếp giao diện cũ.

- Chưa đăng nhập: trang giới thiệu và form tài khoản.
- Đã đăng nhập: không gian học tập, khóa học, luyện tập và tiến độ.
- Admin: menu **Quản trị** và cài đặt model quản trị hiển thị theo quyền tài khoản hiện tại.
- Theme chỉ kích hoạt trên đúng hostname loopback (`localhost`, `127.0.0.1`, `[::1]`). Host public/LAN không tải CSS/font của bản thử hoặc chèn công tắc. PR không bật Manga cho production.

## Chạy cục bộ

```sh
npm ci
cp .dev.vars.example .dev.vars
# Điền AI_KEY_SECRET bằng chuỗi ngẫu nhiên; các khóa thật chỉ lưu trong .dev.vars.
npm run teacher:catalog
npx cf d1 migrations apply eb0d49a5-7a90-4219-968c-5fcb04390859 --dir migrations --local --persist-to .cloudflare/state
npx cf dev --host 127.0.0.1 --port 8787
```

`.dev.vars` và `.cloudflare/` được Git bỏ qua. Không chạy `npm run release`, `npm run deploy` hoặc migration thiếu `--local` để thử UI: các lệnh đó có thể ghi production.

Đăng ký tài khoản email cục bộ để học. Tài khoản và phiên production không được sao chép sang máy này. Bài học và thẻ nhớ dùng dữ liệu tĩnh trong repository; danh mục D1 cần seed riêng nếu muốn kiểm tra `/api/next-topic`. Không dùng script upload production để seed database local.

## Admin kiểm thử

Đặt `LOCAL_TEST_ADMIN_PASSWORD` trong `.dev.vars`, sau đó đăng nhập bằng tên `admin` và mật khẩu vừa đặt. Tài khoản này chỉ được chấp nhận trên loopback; không cấu hình secret kiểm thử trên Worker công khai. Không commit mật khẩu hoặc file `.dev.vars`.

Admin tự dùng `OPENAI_API_KEY` phía server cho AI. Nếu khóa trống, vẫn có thể kiểm tra tài khoản/quản trị và bài học, nhưng chat/giọng đọc sẽ báo chưa cấu hình. Tài khoản học viên sử dụng kết nối riêng đã chọn. Không gọi model chỉ để kiểm tra bố cục.

## Giao diện và ảnh

`static/manga.css` tạo theme riêng; `static/local-ui.js` nạp theme có điều kiện và đồng bộ menu với route/quyền hiện tại. Các control bài học, tài khoản, progress và AI vẫn dùng luồng hiện có.

Ảnh `static/assets/knks.jpg` do người dùng cung cấp, kích thước 2048 × 1536. Khung “Học tiếp” giữ tỷ lệ 4:3, màu gốc và toàn bộ ảnh trên desktop/điện thoại. Không áp bộ lọc đen trắng hoặc cắt người.

## “Học tiếp”

Sau khi một bài hiển thị thành công, ứng dụng lưu tham chiếu bài gần nhất theo tài khoản và cấp độ trên trình duyệt này. Dashboard ưu tiên bài đó nếu chưa hoàn thành. Khi bài đã hoàn thành, ứng dụng chọn bước chưa hoàn thành tiếp theo trong lộ trình; nếu tham chiếu không hợp lệ hoặc bài bị xóa, dùng bước đầu tiên chưa hoàn thành.

Chỉ lưu ID, skill và owner; tiêu đề, membership và URL được phân giải từ danh mục hiện tại. Không tự đánh dấu các bài trước là hoàn thành. Không có đồng bộ vị trí giữa thiết bị; cần mở lại bài một lần sau khi cập nhật để ghi nhận vị trí.

## Kiểm tra trước PR

```sh
npm test
npm run build       # cf deploy --dry-run, không deploy
git diff --check
```

`.gitattributes` giữ OpenJLPT JSON ở LF để checksum upstream không bị sai do chuyển CRLF trên Windows. Không sửa manifest hoặc bỏ kiểm tra checksum.

Đã kiểm tra local: đăng ký, mở bài, lưu hoàn thành và tải lại, lật thẻ nhớ, màn hình thiếu AI, đổi theme, menu điện thoại đóng bằng Escape và trả focus. Bố cục đã được xem ở 390, 768, 1024 và 1440px; ảnh mới được kiểm tra ở desktop và điện thoại. Admin authorization được kiểm tra bằng API; menu mới có regression test cho cấp/thu hồi quyền.

`course/vi-dict.json` là từ điển dịch tùy chọn, chưa có trong repository. Các chuỗi không có bản dịch giữ nguồn gốc dự phòng. Google login, model thật, live voice và tất cả chế độ bài thi chưa được xác minh trong lần thử UI này.

Ảnh/log kiểm thử và canvas khám phá giữ local, không vào PR. Cấu hình interpreter Pyright có đường dẫn máy cá nhân cũng không vào PR. Chỉ push nhánh feature và mở PR; không merge, auto-merge hay deploy.
