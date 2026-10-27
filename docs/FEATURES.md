# VJBot — Complete Feature Specification & Architecture Guide

This document provides complete, implementation-grade specifications for all product features in **VJBot (Nihongo Sensei)**. It is written for core developers, frontend/backend engineers, and designers collaborating on the project.

---

## 1. Feature 1: Standalone Landing Page & OAuth Authentication

### 1.1 Architectural Separation
To deliver a premier user experience and follow modern SaaS architecture:
- **Public Surface (`/`)**: A dedicated, lightning-fast landing page serving public visitors, search engines, and prospective students.
- **Application Studio (`/app`)**: The authenticated learning workspace containing the Classroom, 4-Skill Curriculum, Flashcards, Kaiwa Lab, and Mock Exams.

### 1.2 OpenDesign Landing Page Design Specification
The landing page adheres to the **OpenDesign Landing Page Pattern** ([Reference Template](https://open-design.ai/plugins/example-open-design-landing/)) combined with **Apple Liquid Glass** minimalism:
1. **Header Navigation**:
   - Left: 8-Bit VJ Logo (`assets/logo-vj-8bit.svg`) + `VJBot` brand mark.
   - Center: Quick anchor links (`Tính năng`, `Lộ trình N5–N1`, `Phương pháp SRS`, `Thi thử`).
   - Right: "Đăng nhập" (Login button) and high-contrast CTA "Học thử miễn phí".
2. **Hero Section**:
   - Bold, high-contrast headline using **Be Vietnam Pro**: *"Luyện thi JLPT & Phản xạ Tiếng Nhật thông minh cùng AI Sensei"*.
   - Subtitle emphasizing the reversed-classroom pedagogy: Sensei chủ động đặt câu hỏi, phát hiện lỗ hổng ngữ pháp và dẫn dắt lộ trình học cá nhân hóa.
   - Dual CTAs: Primary CTA (`Bắt đầu ngay`) & Secondary CTA (`Xem bản demo`).
3. **The 1984 Macintosh Retro PC Hero Asset (`<anatomy-computer>`)**:
   - An interactive isometric Web Component styled as the 1984 classic Macintosh personal computer.
   - Features a mechanical keyboard with a coiled cable connected to the main chassis.
   - **CRT Green Phosphor Screen**: Displays a live, continuous typewriter loop typing authentic Japanese phrases:
     - `「日本語を学ぼう！」` (Hãy cùng học tiếng Nhật!)
     - `「一期一会」` (Nhất kỳ nhất hội — Trân trọng từng cuộc gặp gỡ)
     - `「継続は力なり」` (Kiên trì ắt thành công)
     - `「七転び八起き」` (Bảy lần ngã, tám lần đứng dậy)
   - Interactive mouse-tracking perspective tilt and light/dark theme support.
4. **Bento Feature Grid**:
   - **Reversed AI Classroom**: Chatbot chủ động hỏi bài, phản xạ tự nhiên.
   - **Lộ trình 4 Kỹ năng N5–N1**: Từ vựng, Ngữ pháp, Đọc hiểu, Nghe hiểu.
   - **Kaiwa Speaking Lab**: Nhận diện giọng nói, chấm điểm 0–100, nghe lại giọng bản thân.
   - **Phòng thi thử Authentic JLPT**: 4 Mondai chuẩn đề thi thật, đồng hồ đếm ngược 25 phút.

### 1.3 OAuth 2.0 & Authentication System Design
The authentication layer supports seamless Single Sign-On (SSO) with zero tech jargon exposed to students:

#### Authentication Flow
```
[User clicks "Đăng nhập Google"]
         │
         ▼
[Redirect to Google OAuth 2.0 Auth Endpoint]
 (client_id, redirect_uri, scope="openid email profile", state, code_challenge)
         │
         ▼
[User approves permissions on Google consent screen]
         │
         ▼
[Redirect back to /auth/callback?code=...&state=...]
         │
         ▼
[Cloudflare Worker / Backend exchanges code for ID Token & Access Token]
         │
         ▼
[Upsert User Profile in Cloudflare D1 (profiles table)]
         │
         ▼
[Issue Secure, HttpOnly Session Cookie or JWT] ──► [Redirect to /app]
```

#### Environment Configuration Placeholders
Add the authorized OAuth credentials in `.env` (backend) and Cloudflare Worker variables:
```bash
# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID="YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="YOUR_GOOGLE_CLIENT_SECRET"
GOOGLE_REDIRECT_URI="https://vjbot.dangphuc.me/auth/callback"
GOOGLE_AUTH_URL="https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL="https://oauth2.googleapis.com/token"

# JWT Secret for Session Signing
JWT_SECRET="YOUR_SECURE_RANDOM_SESSION_SECRET"
```

#### Frontend Login Modal Spec
The login dialog (`#auth-modal`) features:
- One-click Google Sign-In with official Google branding.
- Guest / Trial mode: Students can start immediately without registration; local progress is stored in `localStorage` and automatically merged upon subsequent OAuth login.
- Clean privacy guarantee note: *"VJBot cam kết bảo mật thông tin và chỉ sử dụng email để đồng bộ tiến độ học tập."*

---

## 2. Feature 2: Pixel Mascot Asset System & Minimalist UI Layout

### 2.1 Mascot Asset System Fixes
- **Root Cause of Past Asset Glitches**: External raster images or unpadded SVGs caused blurry rendering, broken paths, or missing textures across different device pixel ratios (DPR).
- **Architecture Solution**:
  1. **Embedded Vector Pixel Art**: The official 8-bit brand mascot is implemented as an inline, scalable SVG (`assets/logo-vj-8bit.svg`) with crisp nearest-neighbor rasterization:
     ```css
     .vj-8bit-logo-img, .loading-logo-8bit, .hero-badge-8bit {
       image-rendering: pixelated;
       image-rendering: crisp-edges;
     }
     ```
  2. **Three Native Mascot Personas**:
     - `Aoi Sensei` (Giáo viên trẻ trung, năng động, phong cách anime).
     - `Kenji Sensei` (Thầy giáo nghiêm khắc, chuẩn Shinkanzen thương mại).
     - `Hana Sensei` (Cô giáo dịu dàng, phát âm chuẩn Tokyo N5–N4).
  3. **Visual Standee & State Management**:
     - Supported animation states: `idle`, `speaking`, `cheering`, `thinking`.
     - High-DPI canvas fallback ensuring zero blurry pixels on Retina / 4K displays.

### 2.2 Minimalist Sidebar & Layout Redesign
- **Emoji Reduction**: Removed cluttered, childish emojis across the interface; replaced with refined typographic badges, subtle monochrome SVG symbols, and Apple Liquid Glass design tokens.
- **Header Isolation**: The sidebar header contains **only** the 8-bit VJ icon and the `VJBot` logotype.
- **Integrated JLPT Countdown**:
  - Automatically calculates days, hours, and minutes to the first Sunday of July and December.
  - Formatted with a clean pill card: `⏱️ JLPT Kỳ Tháng 7 • Còn 248 ngày`.
- **Drawer Slide-Out on Mobile**:
  - Uses CSS hardware-accelerated transforms (`translate3d`) with a smooth backdrop blur overlay (`backdrop-filter: blur(16px)`).

---

## 3. Feature 3: Level & Test Card Organization Architecture

### 3.1 Hierarchical Selection Model
The Mock Exam Simulator organizes test materials in a clear, 3-tier hierarchy:
```
Tier 1: Trình độ JLPT (Level Selector: N5 → N4 → N3 → N2 → N1)
   │
   ▼
Tier 2: Mã đề thi (Test Number Selector: Đề Số 01, Đề Số 02, Đề Số 03...)
   │
   ▼
Tier 3: Cấu trúc 4 Mondai Chuẩn Quốc Tế
   ├── Mondai 1: Cách đọc chữ Hán (漢字の読み方)
   ├── Mondai 2: Điền từ vựng ngữ cảnh (文脈規定)
   ├── Mondai 3: Ngữ pháp dấu sao ★ (文の組み立て)
   └── Mondai 4: Đọc hiểu văn bản (読解)
```

### 3.2 Authentic Question Bank Dataset (`static/jlpt-data.js`)
All 5 levels have dedicated, authentic mock exams:
- **N5**: 2 complete exams covering Minna I foundation, basic Kanji, particles (は, が, を, に, で), and daily announcements.
- **N4**: 2 complete exams covering Minna II, potential/passive forms, 〜そうです / 〜てしまう, and reading notices.
- **N3**: 2 complete exams covering Shinkanzen N3, formal workplace vocabulary, adverb distinctions (めきめき, あらかじめ), and medium reading passages.
- **N2**: 2 complete exams covering high-level idioms, abstract Kanji (把握, 膨大, 綿密), advanced sentence structures (〜にほかならない, 〜ざるを得ない), and business communication passages (Hou-Ren-Sou).
- **N1**: 2 complete exams covering academic nuances (巧妙, 是正, 画期的, 如実), literary sentence grammar (〜極まりない, 〜であれ〜であれ), and philosophical essays on AI and linguistics.

### 3.3 Scoring, Timer & D1 Progress Sync
1. **Dynamic Timer**: Configured per exam level (N5: 20 min, N4: 25 min, N3: 30 min, N2: 35 min, N1: 40 min).
2. **Instant Feedback**: Option buttons highlight in green (`#16a34a`) or red (`#dc2626`) upon selection, revealing the grammatical explanation.
3. **Database Persistence**:
   - Each answer automatically POSTs to `/api/progress/record` with `user_id`, `item_id`, and `correct: boolean`.
   - Cloudflare D1 updates review intervals using the SM-2 algorithm.
   - When the exam finishes, the Mastery tab (`#panel-mastery`) automatically refreshes weak spots.

---

## 4. Feature 4: 4-Skill Curriculum Roadmap (N5–N1)

### 4.1 Four-Skill Structure
Each JLPT level is partitioned into 4 core competencies:
1. **Ngữ pháp (Grammar)**: Core patterns, formulas, polite vs. plain forms, and common misuse notes.
2. **Từ vựng (Vocabulary)**: Frequency-ranked words, Kanji writing, Vietnamese definitions, and example sentences.
3. **Đọc hiểu (Reading)**: Authentic short/medium reading texts with comprehension drills.
4. **Nghe hiểu (Listening)**: Audio drills with transcripts and key takeaway explanations.

### 4.2 Interactive Breadcrumb Navigation
- Top navigation displays full path: `Lộ trình > N5 > Ngữ pháp > Bài 1`.
- Clicking any parent breadcrumb smoothly transitions back to the level or skill overview without full page reloads.

### 4.3 Detailed Lesson Modal
- Displays: Formula, In-depth explanation, Audio pronunciation button (Gemini TTS), and interactive drill quizzes.

---

## 5. Feature 5: Flashcard SRS & 3D Flip Deck

### 5.1 Card Structure
- **Front**: Large Kanji/Vocab display, Hiragana/Katakana furigana reading, Audio listen button.
- **Back**: Vietnamese meaning, context example sentence with audio, JLPT level indicator.

### 5.2 SM-2 Spaced Repetition Ratings
Three grading options for learners:
- **Học lại (Again - Quality 1)**: Resets interval, schedules immediate re-review.
- **Nhớ được (Good - Quality 4)**: Normal interval progression ($I_{n} = I_{n-1} \times EF$).
- **Rất dễ (Easy - Quality 5)**: Increases ease factor and extends review interval.
- Every rating triggers a background sync to Cloudflare D1 via `/api/progress/record`.

---

## 6. Feature 6: Kaiwa Speaking Lab & Voice Pipeline

### 6.1 Interactive Voice Pipeline
1. **Speech Recognition (`Web Speech API`)**:
   - Configured for `ja-JP` audio input.
   - Real-time transcript rendered in the user response textarea.
2. **User Voice Capture (`MediaRecorder`)**:
   - When the microphone activates, a `MediaStream` records the user's voice into high-quality WebM chunks.
   - Upon completion, generates a local blob URL and exposes the **"🎧 Nghe lại giọng bạn"** playback button.
   - Allows learners to self-critique their pitch, pronunciation, and intonation.
3. **AI Evaluation (`/api/kaiwa/evaluate`)**:
   - Evaluates grammar correctness, fluency, and politeness on a 0–100 scale.
   - Generates constructive Vietnamese feedback from Sensei.
   - Provides a model native answer with Gemini TTS audio playback.

---

## 7. Feature 7: Spawn Sensei Anywhere (Floating Dock & Global Shortcut)

### 7.1 Multi-Surface Accessibility
- **Floating Dock Standee (`#btn-spawn-sensei-float`)**: Positioned at the bottom-right corner across all tabs.
- **Global Shortcut**: Pressing `⌘K` (macOS) or `Ctrl+K` (Windows/Linux) instantly summons the Sensei Popover.
- **Popover Capabilities**:
  - Quick question input with auto-focus.
  - Streaming AI response.
  - Native Gemini TTS audio voice playback.

---

## 8. Feature 8: Settings & Student Data Management

### 8.1 API Key Management
- Local encrypted storage of Google Gemini API key.
- Obfuscated password input with toggleable eye icon.
- "Kiểm tra kết nối" button to verify API quota without leaving settings.

### 8.2 GDPR & Data Sovereignty
- "Xóa tài khoản & Dữ liệu D1": One-click cascade deletion of all user records, chat histories, profiles, and SM-2 progress from Cloudflare D1 and `localStorage`.
