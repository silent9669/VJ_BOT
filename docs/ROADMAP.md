# Việc cần làm để cải thiện

Danh sách này dựa trên trạng thái thật của mã nguồn và production. Mỗi mục ghi lý do và cách biết là xong. Thứ tự là ưu tiên đề xuất.

## Current whole-application teaching-quality priority (2026-11-13)

The current implementation-ready plan is [TEACHING_QUALITY_PLAN.md](TEACHING_QUALITY_PLAN.md), with the complete addressable structural inventory in [TEACHING_QUALITY_AUDIT.json](TEACHING_QUALITY_AUDIT.json). Baseline: `204b55b`. It covers every current N5-N1 lesson surface, task/context/translation roles, original option identities, feedback, skill diversity, runtime teaching and progress semantics. Structural traversal and AI editorial findings are not human pedagogical approval.

Fix shared task adapters and canonical evidence before expanding question counts or changing models. Keep all five levels in scope; preserve original sources, grading identities, learner history, the selected chat API and independent voice. This is a planning checkpoint, not an application fix, new inference authorization or deployment. Earlier items below are historical proposals, not a verified statement of today's model-testing or publication state.

## Cần làm ngay (rủi ro sản phẩm)

1. **Chạy thử chat với model thật.** Prompt trong `src/prompt.js` và toàn bộ lớp AI mới chỉ được kiểm tra bằng test giả lập, chưa có cuộc hội thoại thật. Xong khi: gắn API, chạy 5 lượt (trả lời sai, xin gợi ý, trả lời đúng, tự giải thích, "kết thúc") ở cấp N5 và N3 với ít nhất hai loại API, ghi lại kết quả và chỉnh prompt. Thêm một bộ hội thoại mẫu vào `tests/` hoặc `docs/` để so sánh khi đổi prompt.
2. **Teach and translate through the selected chat connection.** Follow the current teaching-quality plan instead of making bulk static translation the default. Distinguish source glosses, sentence translations and answer explanations; preserve Japanese originals and canonical grading. Missing translations require explicit Japanese-source runtime teaching with appropriate uncertainty, not an explanation copied into a meaning field. A complete structural scan found 41,001 unmapped Latin-bearing occurrences among 41,834 inspected English-source fields; these are heuristic candidates, not that many proven mistranslations. No bulk inference or provider change is authorized by this roadmap.
3. **Giấy phép bản dịch.** Bản dịch là tác phẩm phái sinh của OpenJLPT (CC BY-SA 4.0). Cập nhật `static/openjlpt/NOTICE.md` và trang `sources.html` để nêu rõ bản dịch cùng giấy phép.
4. **Đăng nhập Google và quyền admin.** Chưa ai xác nhận luồng đồng ý Google thật ở production, và quyền admin chỉ có sau lần đăng nhập Google kế tiếp. Xong khi: đăng nhập thật, thấy mục "Quản trị", `/api/admin/overview` trả 200, tài khoản khác nhận 403.

## Chất lượng và kỹ thuật

0. **Tài nguyên pixel.** Thầy Lâm pixel dùng ảnh 4 hướng và 4 khung thở lấy từ bộ nhân vật Pixel Lab cũ (`static/assets/sensei/minh`); chưa có khung vẫy tay hay đi bộ thật nên bước đi là hiệu ứng nhún. Tạo bộ khung riêng rồi xóa các thư mục `static/assets/sensei/*` không dùng.

5. **Dọn mã cũ.** `app/`, `Dockerfile`, `docker-compose.yml`, `requirements.txt`, `pytest.ini`, `tests/test_*.py` (trừ phần của `scripts/`) và `wrangler.config.ts` không thuộc hệ thống đang chạy. Quyết định xóa hay giữ, rồi bỏ `python.yml` nếu không còn gì để kiểm tra. Secret `GEMINI_API_KEY` không còn được đọc: xóa khỏi Worker và khỏi `cloudflare.config.ts`.
6. **Gộp CSS.** `style.css` (5.800 dòng) cộng `notebook.css`, `layout.css`, `workspace.css`, `practice.css`, `landing.css` chồng lên nhau và ghi đè bằng `!important`. Chọn một lớp token (màu, khoảng cách, chữ), chuyển dần từng màn hình, xóa luật chết. Xong khi mỗi màn hình chỉ cần một file.
7. **Tách `app.js` và `worker.js`.** `app.js` (1.800 dòng) và `worker.js` (630 dòng, nhiều route viết dày) khó đọc và khó thử. Tách route dữ liệu (hồ sơ, tiến độ, hoàn thành, lịch sử) thành module như `auth.js`/`providers.js`; chuyển các script sang ES module để Vite đóng gói (hiện build luôn cảnh báo "can't be bundled without type=module").
8. **Kiểm thử giao diện.** CI chỉ chạy test Node với DOM giả. Thêm một smoke test trình duyệt nhỏ (đăng ký, vào bài, gửi chat với API giả) chạy khi cần, không bắt buộc ở mọi push.
9. **Tiêu đề bảo mật.** Worker mới đặt `X-Content-Type-Options`. Chưa kiểm tra CSP, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`. Thêm CSP cho phép Google Identity và nhà cung cấp AI được gọi từ Worker (trình duyệt không gọi trực tiếp).

## Trải nghiệm học

10. **Chat có trí nhớ người học.** Prompt chỉ thấy 12 tin gần nhất. Dùng bảng `progress` (mục sai nhiều) và "điểm yếu" đã lưu để đưa vào prompt, và tóm tắt hội thoại cũ thay vì cắt bỏ.
11. **Streaming.** Chat chờ trọn câu trả lời (tối đa 28 giây). Truyền từng đoạn sẽ giảm cảm giác chờ; cần thay `callLLM` và giao diện bong bóng.
12. **Dẫn dắt lần đầu.** Sau đăng ký, người dùng thấy banner "Kết nối API". Thêm hướng dẫn ngắn lấy API key cho từng loại (không nêu giá) và nút kiểm tra ngay tại banner.
13. **Giọng đọc không cần API.** Hiện giọng chất lượng cao cần API Gemini của chính người dùng; còn lại là giọng trình duyệt, chất lượng khác nhau theo máy. Cân nhắc tệp âm thanh dựng sẵn cho kana và từ vựng cốt lõi.
14. **Email xác minh và khôi phục mật khẩu** chưa có. Cho đến khi có, tài khoản mật khẩu không thể là admin và mất mật khẩu là mất tài khoản.
15. **Cảnh báo bất thường.** Đã có giới hạn đăng nhập theo IP/email và hạn mức AI theo tài khoản, nhưng chưa có cảnh báo khi lượng đăng ký, đăng nhập sai hoặc yêu cầu AI tăng đột biến. Thêm cảnh báo trên Cloudflare.

## Vận hành

16. **Môi trường staging.** Preview của Workers Builds đang tắt vì sẽ dùng chung D1 production. Tạo D1 và Worker staging riêng rồi bật lại preview cho nhánh.
17. **Sao lưu và khôi phục.** Ghi lại quy trình khôi phục D1 (Time Travel hoặc `cf d1 export`) và diễn tập một lần. Rollback Worker không hoàn tác migration.
18. **Theo dõi.** Log hiện có `AI ok <nguồn> <model>` và `AI <nguồn> <model> <mã lỗi>`. Tạo truy vấn lưu sẵn trong Cloudflare Observability cho tỷ lệ lỗi AI và `/api/chat` 5xx.
19. **Quy trình phát hành.** `npm run release` chạy migration rồi deploy; migration lỗi sẽ chặn deploy nhưng không tự hoàn tác. Với thay đổi lược đồ, viết migration tương thích ngược để rollback Worker vẫn an toàn.
