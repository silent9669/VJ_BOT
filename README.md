# Nihongo Sensei

Chatbot dạy tiếng Nhật chủ động cho luyện thi JLPT N5–N1. Bot tự chọn chủ đề theo tiến độ,
điểm yếu và lịch sử ôn tập của từng người học, thay vì chỉ trả lời khi được hỏi.

## Stack

- Backend: Python 3.12, FastAPI, Motor (MongoDB async)
- LLM: Gemini Flash qua `google-genai` (`gemini-2.0-flash`)
- Frontend: HTML + vanilla JS + CSS (không build step)
- Hạ tầng: Docker Compose (app + MongoDB 7)

## Chạy nhanh

```bash
cp .env.example .env        # điền API_KEY; BASE_URL nếu dùng proxy/gateway; MODEL nếu đổi model
docker compose up --build
```

`BASE_URL` chỉ là origin (không kèm `/v1`); trong Docker dùng `host.docker.internal`, không dùng `localhost`, khi proxy chạy trên máy host.

Mở `http://localhost:8000/`. Lần đầu, giao diện hỏi trình độ trước khi mở chat.

### Dữ liệu giáo trình

Nội dung lấy từ [OpenJLPT](https://github.com/evanclan/OpenJLPT) (CC BY-SA 4.0):
7.811 từ, 2.383 kanji, 526 mẫu ngữ pháp N5–N1. Nạp một lần:

```bash
git clone --depth 1 https://github.com/evanclan/OpenJLPT
python scripts/import_openjlpt.py OpenJLPT/data/csv --out data/curriculum.json
python scripts/seed_curriculum.py data/curriculum.json
```

`data/` bị gitignore. Nếu chưa seed, `/api/chat` và greeting trả `503 "curriculum not seeded"`.
Bản này chưa map đúng 50 bài Minna/Shinkanzen/Mimikara/Soumatome: mục được nhóm theo level,
20 mục một bài, và LLM giảng từng mục. Muốn bám giáo trình, cần bộ dữ liệu có phép dùng.

Lần chạy đầu tiên, app tự seed 20 mục N5 (vocabulary/grammar/kanji) nếu collection
`seed_items` đang rỗng. Không cần API key để xem UI; endpoint chat trả `503` khi thiếu key.

## Kiến trúc

```
static/ (HTML/JS/CSS)
        │  fetch /api/*
        ▼
app/main.py  ── routers: chat, progress, curriculum
        │
        ├── services/curriculum.py   chọn chủ đề kế tiếp (SM-2 + điểm yếu)
        ├── services/progress.py     ghi/đọc tiến độ từng mục
        ├── services/proactive.py    lời mở đầu chủ động
        └── services/llm.py          Gemini client + system prompt
        │
        ▼
   MongoDB (progress, conversations, seed_items)
```

Curriculum engine quyết định **dạy gì**; LLM chỉ sinh nội dung cho chủ đề đó.

Thứ tự ưu tiên chọn chủ đề:

1. Mục quá hạn ôn (`next_review` < hiện tại), ưu tiên ease factor thấp.
2. Mục chưa từng gặp, theo thứ tự N5 → N1 và thứ tự seed.
3. Mục có tỉ lệ đúng thấp nhất.

## API

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| POST | `/api/chat` | Gửi tin nhắn, nhận phản hồi + chủ đề kế tiếp |
| GET | `/api/chat/greeting?user_id=` | Lời mở đầu chủ động |
| GET | `/api/history?user_id=&limit=` | Lịch sử hội thoại |
| GET | `/api/progress?user_id=` | Tổng hợp tiến độ |
| POST | `/api/progress/record` | Ghi kết quả đúng/sai cho một mục |
| GET | `/api/next-topic?user_id=` | Chủ đề kế tiếp + lý do |

## Phát triển

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m pytest -q
```

Test dùng `mongomock-motor`, không cần MongoDB chạy local.

## Mở rộng ngân hàng câu hỏi

Ngân hàng câu hỏi JLPT đầy đủ chưa nằm trong phiên bản này. Thêm mục vào
`app/seed.py` theo shape:

```python
{"item_id": "...", "item_type": "grammar|kanji|vocabulary",
 "jlpt_level": "N5|N4|N3|N2|N1", "display": "...", "meaning_en": "..."}
```

Curriculum engine và progress tracker dùng chung shape này, không cần đổi code.
