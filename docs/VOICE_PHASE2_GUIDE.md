# Voice v2 Phase 2 Implementation Guide

This guide describes the Cascaded Live and unified STT architecture following Voice v2 Phase 1. The current implemented wire contract is maintained in [API_REFERENCE.md](API_REFERENCE.md#cascaded-live-voice-backend); historical targets below are not release evidence.

The reliability repair separates display text from speech synthesis, preserves interrupted conversation context, adds explicit or automatic Vietnamese/Japanese transcription, and conditions teaching prompts on the current turn. Local protocol checks, real-provider output review and physical microphone/audio acceptance are separate gates. Existing provider credentials and source-permission boundaries remain unchanged.

---

## 1. Mục tiêu & Phạm vi Phase 2

1. **Cascaded Live Voice Engine (Mới — mặc định khi bật Voice v2):**
   - Pipeline: `Micro (Auto-VAD hoặc Nhấn để nói) → POST /api/stt → POST /api/live/turn (SSE streaming LLM) → Incremental <ja>/<vi> Chunker → POST /api/tts (Voice v2) → VJVoiceStitcher (Gapless + Barge-in)`.
   - Dùng được **chính cấu hình giọng song ngữ Phase 1** (ElevenLabs, Mistral, Mix ElevenLabs ↔ Mistral, hoặc Custom TTS URL) cho hội thoại trực tiếp.
   - Dùng được **mọi Chat LLM** đang có trong VJ_BOT (Mistral, OpenAI, Claude, Gemini, Antigravity OAuth, Custom OpenAI-compatible).
   - Hỗ trợ đủ **100% Quick Commands** (`Gợi ý`, `Nhắc lại`, `Nói chậm`, `Sửa câu`, `Tình huống`, `Tự giải thích`, `Tóm tắt`), kể cả trên Mistral.
   - Có **Barge-in thực sự** (ngắt lời Thầy trong `< 5ms` bằng hủy `turnId` + `stitcher.stop()` + `AbortController`).
2. **Unified STT (`POST /api/stt`):**
   - Bổ sung **ElevenLabs Scribe** (`POST <base>/v1/speech-to-text`, `xi-api-key`) bên cạnh **Mistral `voxtral-mini-transcribe-3`** và **OpenAI `gpt-transcribe`**.
   - Gắn server-derived `context_bias` (từ vựng bài học đạt `processingAllowed`) cho Mistral STT.
   - Cho phép người dùng (tường minh trong Cài đặt Voice) dùng profile **Mistral / ElevenLabs / OpenAI ở mục Âm thanh** làm nguồn STT khi Chat đang dùng Antigravity OAuth / Claude / Gemini (fail-closed, không fallback ngầm).
3. **Giữ Native Realtime Engines ở dạng tùy chọn (Opt-in):**
   - Không phá vỡ OpenAI GPT-Live / Gemini Live / Mistral LiveKit hiện tại ([`src/live.js`](../src/live.js), [`static/live.js`](../static/live.js)); tách rõ adapter interface để Phase 3 tinh gọn tiếp.

### Chiến lược tách PR khuyến nghị (tránh PR quá lớn, dễ review & test)

- **PR 2A (Backend Core & Unified STT):** Tasks 1 → 4 (`streamLLM`, `voiceStreamingInstructions`, `POST /api/live/turn`, nâng cấp `POST /api/stt` + unit tests) — xem đặc tả thực thi chi tiết tại [VOICE_PHASE2A_SPEC.md](VOICE_PHASE2A_SPEC.md).
- **PR 2B (Frontend Cascaded Live Engine & Settings):** Tasks 5 → 8 (`vad-worklet`, `live-core`, `live-cascaded`, nối Settings & UI Classroom Voice + unit & Chromium tests).

---

## 2. Kiến trúc Luồng Dữ liệu & Kiểm soát Quota

```mermaid
sequenceDiagram
    actor U as Học viên
    participant Core as live-core.js + vad-worklet.js
    participant STT as Worker POST /api/stt
    participant Turn as Worker POST /api/live/turn (SSE)
    participant TTS as Worker POST /api/tts (Voice v2)
    participant Stitch as VJVoiceStitcher (Phase 1)

    Note over Core: activeTurn = ++turnSeq
    U->>Core: Nói (Auto-VAD hoặc Nhấn để nói)
    opt Barge-in khi Thầy đang nói
        Core->>Core: activeTurn = ++turnSeq (vô hiệu hóa lượt cũ TRƯỚC khi abort)
        Core->>Stitch: stitcher.stop() (< 5ms)
        Core->>Turn: turnAbort.abort()
        Core->>TTS: ttsAbort.abort()
    end

    Core->>STT: POST /api/stt { audio, mime_type, level, lesson?, stt_routing? }
    STT-->>Core: { text: "昨日映画を見ました。" }
    Core->>Core: Kiểm tra turnId === activeTurn -> Hiện caption User

    Core->>Turn: POST /api/live/turn (SSE)<br/>{ level, lesson?, focus?, view?, task?, command?, transcript, history[], japanese_only }
    Turn-->>Core: event: segment { index: 0, lang: "ja", text: "いいですね！何の映画を見ましたか？" }
    Core->>TTS: POST /api/tts { text: "<ja>...</ja>", mode: "bilingual", stream: true, routing }
    Note over Core,Stitch: Câu #0 bắn TTS ngay để đạt TTFB thấp (~1.1–1.8s)
    TTS-->>Stitch: Audio câu #0 -> PHÁT NGAY!

    Turn-->>Core: event: segment { index: 1, lang: "vi", text: "Em kể tên phim bằng tiếng Nhật nhé." }
    Turn-->>Core: event: done { full_text, count: 2, japanese_only: false }
    Core->>TTS: Batch remaining segments after done (personal: 1 batch; managed: up to 2)
    TTS-->>Stitch: Khâu nối tiếp (trim + 15ms/25ms pad + RMS match + pause 200ms)
```

> **Rate limit (`ai_usage`: 20 requests/minute per account):**
> - Send segment `#0` immediately. Send the remaining segments after `done`: one batch for personal voices (up to 15 segments), or batches of at most 8 if the batch uses a `platform` voice.
> - With server STT, a transcript turn uses 3 requests for a one-segment reply, normally 4 for a multi-segment reply, and 5 if a managed voice needs two continuation batches.
> - Browser STT saves one server request. These counts exclude other requests sharing the account's budget.
> Đặc biệt, lệnh **Nhắc lại** phát lại trực tiếp từ bộ nhớ lượt vừa rồi (**0 API call**) và lệnh **Nói chậm** chỉ gọi lại TTS (không gọi STT/LLM).

---

## 3. Kế hoạch Triển khai Chi tiết (8 Tasks)

### PR 2A — Backend Streaming LLM, Live Turn Route & Unified STT

#### Task 1: Thêm `streamLLM()` vào [`src/llm.js`](../src/llm.js)
- **Mục tiêu:** Tái sử dụng logic SSE đã có trong [`probeModel()`](../src/llm.js#L142-L240) để cung cấp hàm streaming hoàn chỉnh cho `openai`, `anthropic`, `gemini` (và giữ tương thích với Antigravity gateway).
- **Contract đề xuất:**
  ```js
  export async function streamLLM(provider, {system, turns, signal, onDelta})
  // Returns { ok: true, text, finishReason } or { ok: false, status, emitted, reason, upstreamStatus?, retryAfterMs? }.
  ```
- **Yêu cầu kỹ thuật bắt buộc:**
  - Dùng chung `request()` và `endpoint()` hiện có trong `src/llm.js`; đặt `body.stream = true` (OpenAI/Anthropic) hoặc `:streamGenerateContent?alt=sse` (Gemini).
  - Không gửi `response_format` JSON schema (Live Turn cần streaming text/tag tốc độ cao, không đợi đóng JSON).
  - Timeout tổng **28 giây** (`AbortSignal.any([signal, AbortSignal.timeout(28000)])`), `redirect: 'manual'`, giới hạn dung lượng stream `<= 256 KiB` để tránh OOM trên Worker.
  - Nếu provider trả JSON thường (không hỗ trợ SSE dù gửi `stream: true`), parse toàn bộ JSON sau EOF rồi gọi `onDelta(text)` 1 lần — không fail oan.
  - Luôn `reader.cancel()` trong `finally` khi `signal` bị abort (barge-in!).
  - Tuyệt đối không lộ provider error body hay API key.

#### Task 2: Bổ sung `voiceStreamingInstructions()` trong [`src/prompt.js`](../src/prompt.js)
- **Mục tiêu:** Giữ toàn bộ chất lượng sư phạm của [`voiceInstructions(level)`](../src/prompt.js#L144-L174) và [`VOICE_COMMANDS`](../src/prompt.js#L133-L142), bổ sung hợp đồng output cho Cascaded Live Voice.
- **Quy ước output bắt buộc trong system prompt:**
  - Bọc mỗi câu hoặc đoạn đơn ngôn ngữ trong thẻ `<ja>...</ja>` hoặc `<vi>...</vi>`.
  - **Mỗi câu chỉ chứa 1 ngôn ngữ**, không trộn từ Việt vào trong `<ja>...</ja>` (tránh lặp lại lỗi `#73`).
  - Use at most **three short sentences** (aim for about 250 characters), or up to **five short sentences** for `command === 'summary'`. Both use at most **16 tagged segments**.
  - Không Markdown, không danh sách gạch đầu dòng, không số thứ tự, không lộ ID bài học hay tên thẻ cho người học.
  - Khi `japanese_only === true`: chỉ xuất thẻ `<ja>...</ja>`, chỉ dùng `<vi>` nếu học viên chủ động hỏi lại bằng tiếng Việt hoặc nói không hiểu.
- **Ràng buộc chống Prompt Injection:**
  - Toàn bộ `lesson`, `focus`, `history`, `transcript` nằm trong JSON user envelope duy nhất (`{ message, command, japanese_only, reference: { lesson, focus, history } }`), tương tự [`src/tutor-chat.js`](../src/tutor-chat.js), **không** nối trực tiếp transcript hay history vào system prompt.

#### Task 3: Tạo `src/voice/live-turn.js` và gắn route `POST /api/live/turn` trong [`src/worker.js`](../src/worker.js)
- **Routing & Middleware (`src/worker.js`):**
  - Thêm `'/api/live/turn'` vào `privateRoutes` (và `rateLimited` + `api_connection` validation giống `'/api/chat'`).
  - Kiểm tra `X-VJBot-Account === user.user_id` (409 `account_changed` nếu lệch), body `<= 20 KiB`.
- **Request Payload Contract:**
  ```json
  {
    "level": "N5",
    "lesson": { "id": "grammar:1", "level": "N5" },
    "focus": { "kind": "word", "index": 0 },
    "view": "checks",
    "task": { "id": "...", "revision": "..." },
    "command": null,
    "transcript": "こんにちは、ラム先生。",
    "history": [
      { "role": "assistant", "text": "こんにちは！お元気ですか？" },
      { "role": "user", "text": "はい、元気です。" }
    ],
    "japanese_only": false
  }
  ```
- **Validation chặt trước khi gọi LLM:**
  - `level` ∈ `['N5','N4','N3','N2','N1']`.
  - Bắt buộc có `transcript` (1–1500 ký tự) **hoặc** `command` ∈ `['start','hint','explain','situation','check','slower','summary']` (`repeat` xử lý ở client từ cache, không cần gọi server).
  - Nếu có `lesson` / `focus` / `task`: dùng đúng `validLessonReference`, `validFocusReference`, `catalogLesson`, `processingAllowed`, `resolveTaskReference`, `groundLesson` từ [`src/tutor-context.js`](../src/tutor-context.js) (tuyệt đối không để lộ đáp án bài tập chưa làm!).
  - `history`: tối đa **12 lượt**, chỉ chấp nhận `role ∈ ['user','assistant']`, `text` string `<= 600` ký tự; strip thẻ `<ja>`/`<vi>` khỏi history nếu có.
  - While a canonical multiple-choice task is focused, the Worker gives answer-safe strategy guidance, or a closing reminder for `summary`, without calling a Chat provider. Live does not verify a choice submission. Model-based conversation resumes after leaving the choice.
  - Phân giải Chat provider bằng [`resolveProvider(env, userId, body.api_connection, profileId)`](../src/providers.js#L34-L41) → tự động hoạt động cho Admin (server OpenAI), Learner (API key local/server hoặc Antigravity OAuth!).
- **Incremental Tag & Sentence Chunker (trong `src/voice/live-turn.js`):**
  - Đọc từng delta từ `streamLLM()` vào buffer:
    1. Emit display segments from complete language blocks without TTS normalization or particle respelling. Pronunciation transformations belong only in `/api/tts`.
    2. Nếu model quên thẻ (plain text không có `<ja>`/`<vi>`): cắt tại dấu kết thúc câu `[。！？.!?]\s*` rồi chạy [`segmentVoiceText()`](../src/voice/segmenter.js) để gán đúng `lang`.
    3. Allow at most **16 ordered segments** per Live Turn. Exceeding that limit or the 4,000-character playable text budget ends the stream with `live_reply_too_long`, not `done`.
  - At EOF, flush the display buffer and emit `done` with `{full_text,count,japanese_only}` only after valid generation completion. Failed generation emits `{code,detail,request_id}` and closes the stream; the request ID links to sanitized server diagnostics rather than provider text.

#### Task 4: Nâng cấp `POST /api/stt` (`src/voice/stt-route.js`, thay/bọc [`src/transcription.js`](../src/transcription.js))
- **Giữ tương thích ngược 100%** với mọi caller hiện có (Kaiwa `recorded-input.js` gửi `{action: 'capabilities'}` và `{audio, mime_type}`).
- **Mở rộng 3 tính năng mới:**
  1. **Hỗ trợ ElevenLabs Scribe STT:**
     - Endpoint: `POST <base>/v1/speech-to-text` (mặc định `https://api.elevenlabs.io`, cho phép proxy nằm trong `VOICE_ALLOWED_ORIGINS` qua [`voiceBase()`](../src/voice/tts-route.js#L28-L42)).
     - Header: `xi-api-key: <apiKey>`; multipart fields include `file`, `model_id: 'scribe_v3'` and `tag_audio_events: 'false'` (25 s timeout, `redirect: 'manual'`).
     - Validate transcript length and detected language. `language: auto|ja|vi` controls hints; auto sends none. Preserve validated detection confidence without treating it as correctness or inventing a cutoff.
  2. **Server-derived `context_bias` cho Mistral `voxtral-mini-transcribe-3`:**
     - Nếu request kèm `lesson: {id, level}` (đã qua `validLessonReference` + `catalogLesson`), server tự rút tối đa **40 từ vựng** đạt `processingAllowed` (tái dùng helper tương tự [`lessonVocabulary()`](../src/live.js#L22-L26) — tách ra dùng chung!).
     - Gửi `context_bias` (JSON array / repeated form fields theo spec Mistral `/v1/audio/transcriptions`), nếu nhận `422` thì retry 1 lần không kèm `context_bias` (giống [`src/live.js`](../src/live.js#L140-L151)).
  3. **Tùy chọn nguồn STT tường minh (`stt_routing`):**
     - Mặc định (`stt_routing` vắng mặt): giữ nguyên hành vi cũ — dùng Chat connection (OpenAI / Mistral) hoặc server OpenAI cho Admin.
     - Khi client gửi `stt_routing: { version: 2, admin_override?, provider, profile: { scope, id?, connection? } }` (từ hồ sơ giọng nói Voice v2 đã chọn tường minh trong Settings — xem schema đầy đủ tại [VOICE_PHASE2A_SPEC.md](VOICE_PHASE2A_SPEC.md#62-nh%C3%A1nh-ch%E1%BB%8Dn-k%E1%BA%BFt-n%E1%BB%91i-stt-hai-ch%E1%BA%BF-%C4%91%E1%BB%99-t%C3%A1ch-bi%E1%BB%87t-tuy%E1%BB%87t-%C4%91%E1%BB%91i)): xác thực bằng đúng hàm `selectConnection` trong [`tts-route.js`](../src/voice/tts-route.js#L51-L74) (chỉ chấp nhận `mistral`, `openai`, `elevenlabs`, fail-closed, không bao giờ fallback sang Chat hay tài khoản khác).
     - `{ action: 'capabilities', stt_routing? }` trả `{ supported, provider, model }` để UI hiển thị rõ đang dùng STT nào trước khi thu âm.

---

### PR 2B — Frontend Cascaded Live Engine, AudioWorklet VAD & UI Controls

#### Task 5: Tạo `static/voice/vad-worklet.js` (VAD sạch ngoài Main Thread)
- Viết một `AudioWorkletProcessor` nhỏ gọn (`vjbot-vad-processor`):
  - Tính RMS mỗi frame 128 samples (~2.6ms @ 48kHz), post message `{ rms }` về main thread mỗi ~30ms (giảm tải IPC).
  - Không thực hiện xử lý nặng; không lưu trữ audio raw.
- Trong `live-cascaded.js`, bọc bộ **Voice Activity Detector** có 2 ngưỡng (hysteresis) để chống kích hoạt nhầm tiếng ồn nền:
  - `speechStartThreshold` (vd. `rms > 0.022` liên tục `>= 120ms`) → chuyển sang đang nói, kích hoạt **barge-in** nếu `barge_in === true` và Thầy đang nói.
  - `silenceHangoverMs` (mặc định `750ms` sau khi `rms < 0.012`) → dừng `MediaRecorder` và gửi blob sang `/api/stt`.
  - Độ dài bản ghi giới hạn `[350ms, 30s]` và `<= 2 MiB` (tránh gửi tiếng click/ho ngắn dưới 350ms làm rác STT!).
  - Fallback tự động sang `AnalyserNode` polling (30ms) nếu trình duyệt không hỗ trợ `audioWorklet` (ví dụ HTTP local hoặc WebView cũ).

#### Task 6: Tạo `static/voice/live-core.js` & chuẩn hóa `LiveEngineAdapter`
- Định nghĩa interface chung cho mọi Live Engine (cả Cascaded lẫn 3 Native cũ):
  ```js
  // LiveEngineAdapter interface:
  // {
  //   name: 'cascaded' | 'openai' | 'gemini' | 'mistral',
  //   start({ microphone, audioContext, level, lesson, focus, callbacks }): Promise<void>,
  //   sendCommand(commandKey): Promise<void> | void,
  //   setMuted(muted): void,
  //   setTurnMode(mode): void,   // 'vad' | 'ptt'
  //   triggerTalk(pressed): void, // dùng cho nút Nhấn để nói (PTT)
  //   stop(immediate?): Promise<void> | void
  // }
  ```
- **State Machine & Barge-in Guard (Bắt buộc kiểm tra bằng unit test):**
  - Biến `turnSeq = 0`, `activeTurn = 0`.
  - Hàm `interruptTurn()`:
    1. `activeTurn = ++turnSeq;` *(đặt TRƯỚC mọi hành động async!)*
    2. `stitcher?.stop();`
    3. `turnAbort?.abort(); ttsAbort?.abort();`
  - Sau MỌI `await` (STT, SSE chunk, `prepared()`, TTS fetch, `audio.append()`), kiểm tra `if (myTurn !== activeTurn || run !== sessionVersion) return;`.
- **Quản lý vòng đời & iOS Safari:**
  - Tạo & `resume()` `AudioContext` ngay trong sự kiện `click` nút **"Bắt đầu nói"** (trong user gesture!).
  - Giữ `WakeLock` (`navigator.wakeLock.request('screen')`), release sạch ở `cleanup()` và lấy lại ở `focus`.
  - Giới hạn phiên 10 phút (`600s`), hủy sạch ở `pagehide`, `hashchange` rời `#classroom`, `vjbot-account-ready` đổi tài khoản, và `vjbot-voice-changed`.

#### Task 7: Tạo `static/voice/live-cascaded.js`
- Luồng chi tiết một lượt nói trong `CascadedAdapter`:
  1. **Mở phiên (`start`):**
     - Kiểm tra `VJVoiceRouting.stored()` (phải có cấu hình Voice v2 hợp lệ) + kiểm tra `/api/stt` `capabilities` (hoặc fallback `SpeechRecognition` trình duyệt nếu user không có STT server, hiển thị rõ trạng thái đang dùng STT nào).
     - Gọi `POST /api/live/turn` với `{ command: 'start', level, lesson, focus }` để Thầy Lâm chào mở đầu tự nhiên bằng chính giọng song ngữ Voice v2.
  2. **Tiếp nhận người nói (`vad` hoặc `ptt`):**
     - Ở chế độ **`ptt` (Chạm/Nhấn để nói — rất hữu ích trên iOS & nơi ồn)**: hiện nút **"Giữ / Bấm để nói"** (`min-height: 44px`), bấm lần 1 → `interruptTurn()` + bắt đầu thu; bấm lần 2 (hoặc nhả) → dừng thu & gửi `/api/stt`.
     - Ở chế độ **`vad` (Rảnh tay)**: `vad-worklet.js` tự phát hiện bắt đầu/kết thúc câu; nếu tắt `barge_in`, tạm khóa kích hoạt VAD trong lúc Thầy đang nói.
  3. **Gọi `/api/live/turn` (SSE) & Pipelining sang Voice v2 `/api/tts`:**
     - Ngay khi nhận SSE `event: segment` có `index === 0`:
       - Hiển thị ngay lên [`createLiveTranscript`](../static/live-transcript.js) (`timeline.upsert`).
       - Gửi ngay segment `#0` sang `/api/tts` (`{ text: '<ja>...</ja>', mode: 'bilingual', stream: true, routing }`) và đẩy từng audio chunk vào hàng đợi tuần tự của `VJVoiceStitcher` để phát ngay.
     - Thu gom các segment `#1..#N` cho tới `event: done`:
       - Cập nhật caption realtime khi từng segment về.
       - On `done`, send segments `#1..#N` with their normalized language tags. Personal routing uses one continuation request (up to 15 segments). If the selected routing uses a `platform` voice, split the remaining segments into batches of at most 8. Do not raise the managed TTS limit.
       - HTTP requests can overlap, but every [`VJVoiceStitcher.append()`](../static/voice/audio-stitcher.js) must go through one ordered queue. Complete each batch's appends before the next batch appends its first chunk, even if the later HTTP response arrives first.
     - Lưu mảng `lastAssistantSegments` (audio encoded của lượt Thầy vừa nói) trong RAM phiên để lệnh **`Nhắc lại`** phát lại tức thì (0ms, không gọi LLM/TTS).
     - Lệnh **`Nói chậm`**: giảm hệ số tốc độ tiếng Nhật cho phiên hiện tại (`sessionJaRate = Math.max(0.75, current - 0.12)`) và gọi phát lại câu cuối (hoặc gửi `command: 'slower'`).
  4. **Giữ lịch sử ngắn trong phiên:**
     - Lưu mảng `history` tối đa 12 lượt (`user` / `assistant`) trong RAM trang (không ghi D1, đúng cam kết quyền riêng tư ở `#live-privacy` & `docs/API_REFERENCE.md`). Xóa trắng khi kết thúc cuộc gọi hoặc đổi tài khoản.
     - Retain accepted learner text before generation, and validated assistant text before playback. Assistant `generation` and `playback` metadata distinguish completion, interruption and audio failure; they do not prove what the learner heard. Never reuse invalid generation as a complete reply.

#### Task 8: Cập nhật Wiring (`static/api-profiles.js`, `static/account.js`, `static/voice/voice-settings.js`, `static/index.html`, `static/live.js`)
- **`static/api-profiles.js` & `static/account.js`:**
  - Thêm `'/api/live/turn'` vào `PATHS` và danh sách `inference` của `apiFetch` để **tự động** gắn `X-VJBot-Profile` (server / Antigravity OAuth / `platform_openai`) hoặc `api_connection` (local IndexedDB) cho Live Turn giống hệt `/api/chat`!
- **`static/voice/voice-settings.js` & `static/index.html`:**
  - Mở rộng `VoiceRoutingConfig.live` trong form Cài đặt → Âm thanh → *Giọng song ngữ Nhật–Việt*:
    - **Chế độ Hội thoại trực tiếp:** `Giọng song ngữ (Cascaded — khuyên dùng)` | `Native Realtime (OpenAI / Gemini / Mistral gốc)`.
    - **Kiểu thu micro:** `Tự động (VAD)` | `Bấm để nói (PTT)`.
    - **Cho phép ngắt lời (Barge-in):** checkbox (mặc định `true`).
    - **Nguồn chép lời (STT):** `Tự động theo kết nối Chat` | `Dùng kết nối giọng nói (Mistral / ElevenLabs / OpenAI)`.
    - **Spoken language:** automatic Vietnamese/Japanese detection (default), Vietnamese or Japanese. Browser STT requires an explicit language; unsupported auto mode does not silently select Japanese.
- **`static/index.html` (trong `#classroom-voice`):**
  - Thêm nút chuyển nhanh `Tự động / Bấm để nói` + nút `Bấm để nói` (hiện khi chọn PTT, `min-height: 44px`).
  - Nạp thêm các script theo thứ tự cuối `index.html`: `voice/live-cascaded.js`, `voice/live-core.js` (trước hoặc thay thế thân monolithic của `live.js`).
  - Cập nhật dòng thông báo `#live-privacy` phản ánh đúng nhà cung cấp STT/LLM/TTS đang dùng.

---

## 4. Ràng buộc Bảo mật & An toàn (Bắt buộc kiểm tra)

1. **Không rò rỉ khóa & SSRF:** Mọi custom URL cho STT (ElevenLabs / Mistral proxy) bắt buộc đi qua `voiceBase()` + `VOICE_ALLOWED_ORIGINS` + `redirect: 'manual'`.
2. **Không fallback ngầm:** Nếu STT từ Voice profile thất bại hoặc bị xóa, báo lỗi rõ ràng — không tự mượn Chat key hay tài khoản khác. Admin không có `admin_override: true` không được dùng profile cá nhân.
3. **Bản quyền bài học (`processingAllowed`):** Kiểm tra trước khi rút `context_bias` cho STT và trước khi nhúng `groundLesson` vào `/api/live/turn`.
4. **Prompt Injection Boundary:** `transcript` và `history` luôn được serialize trong JSON user envelope, không bao giờ ghép vào `system` prompt.
5. **Chống lỗi âm thanh trễ (Stale Turn):** Hủy `turnId` trước mọi `abort()`, không bao giờ schedule `AudioBuffer` thuộc lượt đã bị ngắt lời hoặc thuộc tài khoản cũ.

---

## 5. Checklist Kiểm thử & Tiêu chí Nghiệm thu (Acceptance Criteria)

### Tự động (CI bắt buộc pass 100%)
- [ ] `tests/voice-phase2-live-turn.test.mjs`:
  - SSE streaming chuẩn trên cả 3 protocol (`openai`, `anthropic`, `gemini`), bao gồm case thẻ `<ja>`/`</ja>` bị cắt đôi giữa 2 TCP chunk và case fallback khi LLM quên gắn thẻ.
  - Đủ 7 `VOICE_COMMANDS`, từ chối `lesson`/`focus`/`task` sai hoặc không `processingAllowed`, không lộ đáp án câu hỏi chưa làm.
  - Lịch sử vượt 12 lượt hoặc prompt-injection trong `transcript`/`history` vẫn giữ trong JSON user envelope.
  - Abort request phía client hủy sạch upstream `fetch` của provider.
- [ ] `tests/voice-phase2-stt.test.mjs`:
  - ElevenLabs Scribe v3 with API-key isolation, auto/explicit language modes, safe confidence metadata and no unapproved origin.
  - Mistral STT tự gắn server `context_bias` đạt `processingAllowed`, retry sạch nếu 422.
  - `stt_routing` dùng Voice profile hoạt động khi Chat dùng Antigravity OAuth; fail-closed khi profile bị xóa hoặc sai quyền Admin.
- [ ] `tests/voice-phase2-live-ui.test.mjs`:
  - State machine chuyển đủ trạng thái, Quick Commands gọi đúng payload, `Nhắc lại` không gửi thêm request mạng.
  - **Barge-in race test:** audio segment đến muộn sau khi người dùng ngắt lời tuyệt đối không được phát ra loa.
  - Đổi tài khoản (`vjbot-account-ready`), đổi giọng (`vjbot-voice-changed`), rời `#classroom` và `pagehide` dừng sạch mic, `AudioContext`, `WakeLock` và mọi `AbortController`.
- [ ] `tests/voice-v2-browser.mjs` (hoặc `tests/voice-phase2-browser.mjs`) chạy trên Chromium thật trong CI: giả lập 1 lượt Cascaded Live (SSE → NDJSON TTS → Web Audio playback) + 1 lượt Barge-in ngắt giữa chừng.
- [ ] Toàn bộ test hiện có (`npm test`) và `npm run build:worker` đều pass không lỗi.

### Kiểm thử thủ công trước khi chốt production
- [ ] **Desktop Chrome (Mistral LLM + ElevenLabs `eleven_flash_v2_5` clone):** Nói tiếng Nhật + hỏi giải thích bằng tiếng Việt → nghe chuyển ngữ mượt, không vỡ giọng, đủ nút Gợi ý / Sửa câu / Nhắc lại / Nói chậm.
- [ ] **Desktop Chrome (Mix Split-API: Mistral `Haruto` JA + ElevenLabs VI + Mistral STT):** Âm lượng cân bằng (RMS match), độ trễ mở câu `< 2s`.
- [ ] **iPhone Safari (HTTPS thật):** Mở khóa audio ngay lần chạm đầu, màn hình không tự tắt (Wake Lock), chế độ **Bấm để nói (PTT)** hoạt động ổn định, ngắt lời Barge-in dừng tiếng ngay lập tức.
