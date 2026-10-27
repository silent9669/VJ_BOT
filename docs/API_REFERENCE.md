# VJBot — REST & Edge API Reference

This reference covers all HTTP endpoints available on both the Cloudflare Worker edge runtime (`https://vjbot.dangphuc.me/`) and the local FastAPI backend (`http://localhost:8000/`).

---

## 1. Health & Status

### `GET /api/health`
Checks system health, edge runtime status, and database connectivity.

**Response `200 OK`**:
```json
{
  "status": "ok",
  "app": "vjbot",
  "edge": true,
  "d1_items": 63
}
```

---

## 2. Classroom & AI Chat

### `POST /api/chat`
Sends a message to Sensei. Sensai stores the conversation history in D1 and replies based on learner profile and curriculum context.

**Request Headers**:
- `Content-Type: application/json`

**Request Body**:
```json
{
  "user_id": "student_123",
  "message": "Sensei ơi, phân biệt giúp em 〜に際して và 〜にあたって với ạ!",
  "api_key": "OPTIONAL_CUSTOM_GEMINI_KEY"
}
```

**Response `200 OK`**:
```json
{
  "reply": "Chào bạn! Đây là câu hỏi rất hay trong kỳ thi JLPT N2...",
  "audio_base64": null,
  "recommended_topic": "N2-001"
}
```

---

### `GET /api/history`
Retrieves recent chat history for a learner.

**Query Parameters**:
- `user_id` (required, string)

**Response `200 OK`**:
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Xin chào Sensei!",
      "timestamp": "2026-10-27T14:00:00Z"
    },
    {
      "role": "bot",
      "content": "Konnichiwa! Hôm nay bạn muốn luyện tập phần nào?",
      "timestamp": "2026-10-27T14:00:02Z"
    }
  ]
}
```

---

### `DELETE /api/history`
Clears chat conversation history for a student.

**Query Parameters**:
- `user_id` (required, string)

**Response `200 OK`**:
```json
{
  "success": true,
  "message": "Chat history cleared"
}
```

---

## 3. Curriculum & Recommendations

### `GET /api/curriculum`
Lists available curriculum items, filtered by level and skill.

**Query Parameters**:
- `level` (optional, string: `N5`, `N4`, `N3`, `N2`, `N1`)
- `type` (optional, string: `grammar`, `vocabulary`, `kanji`, `reading`, `listening`)

**Response `200 OK`**:
```json
{
  "items": [
    {
      "item_id": "N5-001",
      "level": "N5",
      "item_type": "grammar",
      "display": "〜は〜です",
      "meaning_vi": "Khẳng định cơ bản: A là B",
      "example_jp": "私は学生です。"
    }
  ],
  "total": 1
}
```

---

### `GET /api/curriculum/next`
Returns the next recommended study topic based on spaced repetition due dates or identified weak spots.

**Query Parameters**:
- `user_id` (required, string)

**Response `200 OK`**:
```json
{
  "item_id": "N5-002",
  "level": "N5",
  "item_type": "grammar",
  "display": "〜じゃありません",
  "meaning_vi": "Phủ định cơ bản: A không phải là B"
}
```

---

## 4. Spaced Repetition (SM-2) & Progress

### `GET /api/progress`
Retrieves student mastery statistics, streak count, accuracy, and weak spot list.

**Query Parameters**:
- `user_id` (required, string)

**Response `200 OK`**:
```json
{
  "total_learned": 24,
  "total_correct": 82,
  "total_incorrect": 18,
  "accuracy_rate": 82,
  "streak_days": 5,
  "weak_items": [
    "〜ざるを得ない",
    "把握"
  ],
  "items": [
    {
      "item_id": "N2-001",
      "display": "〜に際して",
      "jlpt_level": "N2",
      "correct": 3,
      "incorrect": 1,
      "interval_days": 6,
      "ease_factor": 2.6,
      "next_review": "2026-11-02T14:00:00Z"
    }
  ]
}
```

---

### `POST /api/progress/record`
Records a review or test question outcome, updating SM-2 intervals.

**Request Body**:
```json
{
  "user_id": "student_123",
  "item_id": "exam-N2-t1-q1",
  "correct": true,
  "quality": 4
}
```

**Response `200 OK`**:
```json
{
  "status": "recorded",
  "interval_days": 6,
  "next_review": "2026-11-02T14:00:00Z"
}
```

---

## 5. User Profile & Account Data

### `GET /api/profile`
Fetches user settings and JLPT target.

**Query Parameters**:
- `user_id` (required, string)

**Response `200 OK`**:
```json
{
  "user_id": "student_123",
  "level": "N2",
  "track": "business",
  "updated_at": "2026-10-27T12:00:00Z"
}
```

---

### `POST /api/profile`
Updates user profile settings.

**Request Body**:
```json
{
  "user_id": "student_123",
  "level": "N1",
  "track": "it"
}
```

---

### `DELETE /api/profile`
Deletes user account, progress records, and conversation history permanently from Cloudflare D1.

**Query Parameters**:
- `user_id` (required, string)

**Response `200 OK`**:
```json
{
  "success": true,
  "message": "Account and all progress data deleted"
}
```

---

## 6. Voice & Kaiwa Speaking Lab

### `POST /api/tts`
Synthesizes authentic Japanese speech using Google Gemini multimodal voice models.

**Request Body**:
```json
{
  "text": "いらっしゃいませ！お弁当温めますか？",
  "voice": "Puck",
  "api_key": "OPTIONAL_KEY"
}
```

**Response `200 OK`**:
```json
{
  "audio_base64": "UklGRi...",
  "mime_type": "audio/wav"
}
```

---

### `POST /api/kaiwa/evaluate`
Scores Japanese speaking answers and returns Sensei's analysis.

**Request Body**:
```json
{
  "scenario_id": "combini",
  "prompt_jp": "いらっしゃいませ！お弁当温めますか？",
  "user_speech": "はい、温めてください。お願いします。",
  "api_key": "OPTIONAL_KEY"
}
```

**Response `200 OK`**:
```json
{
  "score": 95,
  "feedback": "Phản xạ rất tự nhiên và chính xác! Sử dụng thể 〜てください kết hợp お願いします rất lịch sự.",
  "model_answer": "はい、温めてください。",
  "grammar_points": [
    "Thể V-て + ください (Nhờ vả lịch sự)"
  ]
}
```
