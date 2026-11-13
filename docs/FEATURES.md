# Tính năng hiện có

Giao diện chỉ dùng tiếng Việt và tiếng Nhật. Mọi tính năng học tập cần đăng nhập. Tài khoản miễn phí tự gắn API để chat và nhận xét Kaiwa. Admin tự dùng OpenAI của máy chủ khi chưa có API riêng.

## Luồng người dùng

```mermaid
flowchart TD
  L[Landing] --> R[Đăng ký / Đăng nhập]
  R --> D[Góc học tập: Học tiếp]
  D --> S{Đã gắn API?}
  S -- chưa --> B[Banner Kết nối API] --> C[Cài đặt: API AI] --> T[Lưu và kiểm tra]
  S -- rồi --> Q
  T --> Q[Chat với thầy Lâm]
  D --> K[Lộ trình, bài học, 5 câu kiểm tra]
  K -->|Luyện với thầy Lâm| Q
  K --> M[Đánh dấu hoàn thành, Bài tiếp]
```

## Học

- **Lộ trình N5–N1**: 40 chương ngữ pháp (8 mỗi cấp, 163 mẫu câu, giải thích tiếng Việt) và 20 tình huống thực tế viết riêng bằng tiếng Việt (N5: 6, N4: 5, N3: 4, N2: 3, N1: 2). Mỗi tình huống gồm từ cần dùng, hiểu tình huống, tự trả lời bằng văn bản, Kaiwa và bài kiểm tra riêng. Chương kana là tùy chọn.
- **Thư viện**: từ vựng, ngữ pháp, Hán tự, đọc, nghe, viết theo cấp độ (10.720 mục OpenJLPT: 7.811 từ, 526 ngữ pháp, 2.383 Hán tự; 20 bài kana). Phần từ vựng/Hán tự/câu ví dụ trong thư viện còn tiếng Anh cho đến khi chạy `scripts/translate_corpus.py`.
- **Mỗi bài**: tham khảo, 5 câu kiểm tra dựng từ chính ví dụ và bài tập của bài, xem lại câu sai, nút "Luyện với thầy Lâm" (cố định ở đáy màn hình), đánh dấu hoàn thành có thể hoàn tác (độc lập với điểm).
- **Thẻ nhớ**: buổi 20 thẻ ưu tiên thẻ đến hạn, lịch SM-2 (đặt lại sau khi sai).
- **Luyện nói (Kaiwa)**: gõ hoặc ghi âm để chép lời (OpenAI chính thức, nhận diện trình duyệt cho kết nối khác); AI chấm bản chép lời, không chấm phát âm.
- **Bài luyện JLPT**: bộ câu hỏi theo chủ đề và bài thi thử có tính giờ theo từng phần dựa trên đề chính thức 2012/2018 (liên kết tới nguồn; điểm thô, không phải thang điểm JLPT). Mỗi đề lưu bài làm gần nhất.
- **Tiến độ**: số mục, độ chính xác, chuỗi ngày, bài đã hoàn thành, sổ điểm yếu.

## Lớp học đảo ngược cùng thầy Lâm

Người học đã đọc bài; trong chat thầy hỏi, em tự nói và viết. Mỗi lượt: một câu hỏi, chờ trả lời, chẩn đoán đúng câu học viên viết, sửa tối đa hai lỗi kèm lý do, rồi một câu tiếp theo khó hơn hoặc dễ hơn. Có bậc gợi ý, nhắc "tự giải thích" mỗi 4 lượt, tóm tắt khi "kết thúc". Các nút gợi ý nhanh gửi những câu cố định mà prompt đã biết cách xử lý. Chi tiết trong `src/prompt.js`.

Thầy Lâm hiểu người học đang xem gì ở bất kỳ màn hình nào (bài học, thẻ nhớ, quiz, Kaiwa, lộ trình): ô ⌘K và chat đều gửi kèm chữ trên màn hình và vài mục người học hay sai, nên "câu này", "từ này" được hiểu đúng; với bài tập đang làm, thầy gợi ý chứ không đưa đáp án. Chat mang theo bài đang học (cấp độ, tiêu đề, mục tiêu, nội dung giới hạn 4.000 ký tự), có thử lại/bỏ qua khi lỗi, `request_id` chống gửi trùng, và không lưu lượt bị lỗi vào lịch sử.

## API AI của người dùng

Cài đặt > API AI: chọn OpenAI-compatible, Claude (Anthropic) hoặc Gemini, nhập URL (bỏ trống để dùng mặc định), model và API key; "Lưu và kiểm tra". Hồ sơ API có thể lưu trên thiết bị (IndexedDB, AES-GCM) hoặc máy chủ (AES-GCM). Danh sách chỉ hiển thị 4 ký tự cuối. Tài khoản miễn phí chưa kết nối API thấy ô chat khóa và nút dẫn tới Cài đặt; admin có thể dùng OpenAI của Worker.

## Quản trị

Chủ sở hữu (Google có email đã xác minh trong `ADMIN_EMAILS`) và tài khoản được cấp quyền admin thấy mục "Quản trị": số người dùng, người hoạt động 7 ngày, tin nhắn 24 giờ, số người dùng API riêng, danh sách hoạt động nhiều nhất, và **quản lý người dùng**: tìm theo tên/email/ID, xem chi tiết (loại tài khoản, cấp độ, số tin, tiến độ, phiên đang mở, API đã lưu), đổi cấp độ, xóa lịch sử chat, đặt lại tiến độ, xóa API đã lưu, đăng xuất mọi thiết bị, xóa tài khoản. Nút "Dọn tài khoản khách cũ" xóa các hồ sơ ẩn danh từ trước khi có đăng nhập. Tên và email của mọi tài khoản được lưu để quản lý; tài khoản Google cũ chưa có email phải đăng nhập lại một lần. Mỗi thao tác phá hủy đều hỏi xác nhận. Admin có thể cấp/thu hồi quyền admin cho tài khoản Google hoặc email đã đăng ký. Quyền dùng OpenAI chung thay đổi ngay ở yêu cầu tiếp theo. Không thể tự đổi quyền hay đổi quyền/xóa chủ sở hữu. Admin không đọc được nội dung chat.

## Tài khoản và dữ liệu

Google và email/mật khẩu (không có xác minh email hay khôi phục mật khẩu). Xóa tài khoản xóa toàn bộ dữ liệu của tài khoản, kể cả API đã lưu. Tiến độ khách không có: mọi tuyến học cần đăng nhập.

## Giao diện

Cài đặt chia hai cột (menu bên trái, thẻ bên phải): thẻ tài khoản (tên, email, loại đăng nhập, đăng xuất), thẻ API AI có chọn loại API dạng nút, gợi ý model, hiện/ẩn khóa và nhãn trạng thái (Chưa kết nối, Đã lưu, Kết nối được, Lỗi), thẻ âm thanh, thẻ xóa dữ liệu có nút đỏ. Trang bài học có cột "Trong chương" bên phải (vị trí hiện tại, bài đã xong, bấm để chuyển bài), khối cấu trúc, giải thích và thẻ ví dụ đánh số. Hộp đăng nhập, ô hỏi ⌘K, bảng chọn cấp độ và hộp quản trị dùng chung một khung. Hộp đăng ký có thanh độ dài mật khẩu, trường sai được viền đỏ, nút gửi có vòng chờ.

Thầy Lâm nằm trong sidebar, có hoạt ảnh đứng nghỉ và bấm để hỏi về bài đang xem. Nút Hỏi thầy Lâm ở thanh đầu vẫn dùng được khi sidebar thu gọn hoặc đóng. Tôn trọng giảm chuyển động, điều hướng bàn phím và không che bài học.

## Không gian học và Voice

- Sidebar 232 px có nhãn trên máy tính; tablet 740–1099 px mặc định dùng rail 72 px và có nút mở rộng. Dưới 740 px dùng drawer, đóng bằng Escape hoặc nền, giữ focus trong menu và trả focus về nút mở. Có nhóm Học tập, Luyện tập, quản trị/cài đặt và tài khoản.
- Dashboard: tiếp tục bài đang học, tiến độ thực, khóa học và lịch sử hoàn thành. Bài học có tìm kiếm, lọc hoàn thành và phân trang.
- Bài luyện JLPT: hai mục **Luyện theo bài** và **Thi thử có giờ**. Bài ngắn có tìm kiếm/lọc tiến độ; đề chính thức giữ đồng hồ, đáp án đã lưu và cơ chế tự đối chiếu. Không tuyên bố điểm thi chứng chỉ.
- Chat: một cột hội thoại, ô soạn luôn ở cuối, công cụ ngắn và cuộn ngang trên điện thoại. Admin nhấn **Voice** để tự mở micro và bắt đầu GPT-Live; không cần gửi từng bản ghi.
- Voice: âm thanh hai chiều qua WebRTC, sóng âm đo từ micro và giọng thầy, phụ đề riêng cho học viên/thầy, tắt/bật micro, kết thúc và về nhắn tin. Phiên tối đa 10 phút phía client. Phụ đề không lưu vào lịch sử chat; chuyển từ chat sang Voice không tự chuyển lịch sử chat sang phiên nói.
- Kaiwa: ghi một câu rồi dừng để chép lời bằng `gpt-transcribe` khi dùng OpenAI chính thức (API riêng hoặc mặc định admin). Ghi tối đa 60 giây/2 MiB, nghe lại và sửa bản chép trước khi chấm. Nhà cung cấp khác dùng nhận diện trình duyệt nếu hỗ trợ; luôn có thể nhập tay. Chỉ đánh giá nội dung bản chép, không chấm phát âm.
- Admin: 13 model văn bản, gồm GPT-6.1 Sol/Terra, GPT-6 Luna/Sol/Astra, GPT-5.5, GPT-5.4/mini, GPT-5 mini, GPT-4.1/mini, GPT-4o và o3. Mức suy luận theo model; lựa chọn riêng từng admin, API cá nhân vẫn ưu tiên. Thiết lập áp dụng với yêu cầu và phiên mới.
- Tài khoản miễn phí tự gắn API cho AI. Admin dùng khóa Worker khi chưa chọn API riêng. GPT-Live chỉ dành cho admin. Khóa quản trị không xuất hiện trong bundle hoặc phản hồi API.
- Favicon SVG/ICO và biểu tượng cảm ứng dùng cùng chân dung với sidebar. Lần tải dashboard không tự quét model hay danh mục giọng nói.

## Nguồn và giấy phép

OpenJLPT, bản `0d1d3410bec90bd4098a7c72de820543cb4f707c` (`evanclan/OpenJLPT`), CC BY-SA 4.0: xem [NOTICE](../static/openjlpt/NOTICE.md), [LICENSE](../static/openjlpt/LICENSE), [manifest](../static/openjlpt/manifest.json) và trang [Nguồn](https://vjbot.dangphuc.me/sources.html). Tài liệu Irodori và JLPT/Japan Foundation chỉ được liên kết, không sao chép. Mức độ N5–N1 của OpenJLPT là ước lượng của cộng đồng, không phải danh sách chính thức.
