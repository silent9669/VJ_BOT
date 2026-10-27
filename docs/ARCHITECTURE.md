# VJBot — System Architecture & Data Engineering

This document outlines the technical architecture, edge deployment model, database schemas, and algorithms powering **VJBot (Nihongo Sensei)**.

---

## 1. High-Level Architecture Overview

VJBot utilizes a dual-engine architecture:
1. **Production Edge Stack**: Hosted globally on **Cloudflare Workers** with **Cloudflare D1 (Serverless SQLite)** for sub-50ms latency across Asia and worldwide.
2. **Local / Container Development Stack**: **FastAPI (Python 3.12)** with **Motor (Async MongoDB 7)** and Docker Compose.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        User Client Browser                              │
│   (Apple Liquid Glass UI • Anatomy 1984 PC • Web Speech • Audio API)   │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │ HTTPS / TLS 1.3
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Cloudflare Global Edge Network                       │
│                     (vjbot.dangphuc.me)                                │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │               Cloudflare Worker (src/worker.js)                │   │
│   │                                                                │   │
│   │  ├── Static Asset Handling (index.html, JS, CSS, SVG)          │   │
│   │  ├── REST API Router (/api/chat, /api/progress, /api/tts...)   │   │
│   │  └── Authentication & CORS Middleware                          │   │
│   └──────────────────────┬────────────────────────┬────────────────┘   │
└──────────────────────────┼────────────────────────┼────────────────────┘
                           │                        │
                           ▼                        ▼
        ┌────────────────────────────┐    ┌──────────────────────────────┐
        │   Cloudflare D1 Database   │    │  Google Gemini AI Studio API │
        │     (Serverless SQLite)    │    │   (gemini-2.5-flash / TTS)   │
        │                            │    │                              │
        │ • profiles                 │    │ • Conversational Tutor       │
        │ • progress (SM-2 SRS)      │    │ • Kaiwa Pronunciation Eval   │
        │ • conversations (History)  │    │ • Natural Voice Synthesis    │
        │ • curriculum_items         │    └──────────────────────────────┘
        └────────────────────────────┘
```

---

## 2. Cloudflare D1 Database Schema

Cloudflare D1 acts as the authoritative relational data store in production:

### 2.1 Table: `profiles`
Stores learner profiles, target JLPT levels, and study track preferences.
```sql
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  level TEXT DEFAULT 'N5',           -- N5, N4, N3, N2, N1
  track TEXT DEFAULT 'general',       -- general, business, travel, it
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2.2 Table: `progress`
Stores Spaced Repetition (SM-2) state per student and curriculum/exam item.
```sql
CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT DEFAULT 'grammar',  -- grammar, vocabulary, kanji, reading, listening, exam
  jlpt_level TEXT DEFAULT 'N5',
  correct INTEGER DEFAULT 0,
  incorrect INTEGER DEFAULT 0,
  last_reviewed DATETIME DEFAULT CURRENT_TIMESTAMP,
  next_review DATETIME DEFAULT CURRENT_TIMESTAMP,
  interval_days REAL DEFAULT 1.0,
  ease_factor REAL DEFAULT 2.5,
  UNIQUE(user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_user_due ON progress (user_id, next_review);
```

### 2.3 Table: `conversations`
Maintains recent chat history for the reversed-classroom AI context loop.
```sql
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,                -- 'user' | 'bot'
  content TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations (user_id, id);
```

### 2.4 Table: `curriculum_items`
Static reference dataset of 8,000+ vocabulary, Kanji, and grammar points across N5–N1.
```sql
CREATE TABLE IF NOT EXISTS curriculum_items (
  item_id TEXT PRIMARY KEY,
  level TEXT NOT NULL,               -- N5, N4, N3, N2, N1
  item_type TEXT NOT NULL,           -- vocabulary, kanji, grammar
  display TEXT NOT NULL,
  reading TEXT,
  meaning_vi TEXT,
  meaning_en TEXT,
  example_jp TEXT,
  example_vi TEXT
);
CREATE INDEX IF NOT EXISTS idx_curriculum_lvl_type ON curriculum_items (level, item_type);
```

---

## 3. Spaced Repetition (SM-2) Algorithm

VJBot implements the modified **SuperMemo-2 (SM-2)** algorithm for both Flashcards and Mock Exams.

### 3.1 Mathematical Formulation
Given a user recall rating $q \in \{0, 1, 2, 3, 4, 5\}$:
- $q \ge 3$: Successful recall
- $q < 3$: Failed recall (lapse)

#### Ease Factor ($EF$) Update:
$$EF' = \max\left(1.3, \; EF + \left(0.1 - (5 - q) \times (0.08 + (5 - q) \times 0.02)\right)\right)$$

#### Interval ($I$) Update:
$$I' = \begin{cases}
1 & \text{if } q < 3 \\
1 & \text{if } q \ge 3 \text{ and repetitions } = 0 \\
6 & \text{if } q \ge 3 \text{ and repetitions } = 1 \\
I \times EF' & \text{if } q \ge 3 \text{ and repetitions } \ge 2
\end{cases}$$

### 3.2 Implementation (`src/worker.js`)
```javascript
function calculateSM2(quality, repetitions, previousInterval, previousEF) {
  let ef = previousEF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ef < 1.3) ef = 1.3;

  let interval;
  if (quality < 3) {
    interval = 1;
  } else if (repetitions === 0) {
    interval = 1;
  } else if (repetitions === 1) {
    interval = 6;
  } else {
    interval = Math.round(previousInterval * ef);
  }

  const nextReview = new Date(Date.now() + interval * 86400000).toISOString();
  return { interval, easeFactor: ef, nextReview };
}
```

---

## 4. LLM Prompt Architecture & Reversed Tutor Persona

### 4.1 System Prompt Philosophy
Rather than acting as a passive assistant, VJBot operates as an active teacher (Reversed Classroom):
1. **Proactive Initiation**: Sensei introduces topics, checks prior memory, and initiates questions.
2. **Targeted Drill**: Questions align with the learner's JLPT level and track.
3. **Bilingual Guidance**: Japanese input/output supported by natural, friendly Vietnamese explanations.
4. **Structured Assessment**: Points out subtle grammatical nuances (e.g. difference between 〜に際して and 〜にあたって).

### 4.2 System Prompt Template (`app/services/llm.py` & `src/worker.js`)
```
Bạn là VJBot (Nihongo Sensei) — giáo viên tiếng Nhật thông minh, nhiệt tình và thân thiện.
Nhiệm vụ của bạn:
1. Luôn chủ động đặt câu hỏi rèn luyện phản xạ cho học viên theo cấp độ JLPT ({level}).
2. Sử dụng chữ Hán có Furigana/Katakana khi cần thiết để hỗ trợ người học.
3. Giải thích ngữ pháp ngắn gọn, súc tích bằng tiếng Việt tự nhiên và đưa ra 1-2 ví dụ thực tế.
4. Khi học viên trả lời sai hoặc chưa tự nhiên, nhẹ nhàng sửa lỗi và đưa ra cách nói chuẩn người bản xứ.
5. Luôn giữ phong cách tôn trọng, tích cực và tạo động lực cho học viên.
```

---

## 5. Voice & Speech Pipeline

### 5.1 Speech-to-Text (`Web Speech API`)
- Zero external dependency; uses native operating system speech models on Chrome, Safari, and Edge.
- Set to `lang = "ja-JP"` for high-accuracy Japanese speech transcription.

### 5.2 Speech-to-Buffer Recording (`MediaRecorder`)
- Connects directly to the user's `audio/webm` media stream.
- Collects raw audio packets during microphone engagement.
- Creates a local Blob URL for immediate, low-latency playback comparison with Sensei's model audio.

### 5.3 Text-to-Speech (`Google Gemini TTS` / Browser SpeechSynthesis)
- Endpoints request audio bytes using Gemini multimodal voice synthesis.
- Gracefully falls back to browser-native `window.speechSynthesis` (`ja-JP`) when offline or when no API key is provided.
