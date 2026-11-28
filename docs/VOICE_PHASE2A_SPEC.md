# Đặc tả Kỹ thuật Thực thi — Voice v2 Phase 2A (Backend Streaming LLM, `/api/live/turn` & Unified `/api/stt`)

Tài liệu này là **spec triển khai chi tiết ở mức hợp đồng code & kiểm thử** cho **PR 2A** — task kế tiếp trực tiếp sau khi Phase 1 (`PR #1–#4`) đã hoàn tất và merge vào `main`. Xem tổng quan kiến trúc hai giai đoạn (PR 2A + PR 2B) tại [VOICE_PHASE2_GUIDE.md](VOICE_PHASE2_GUIDE.md) và [VOICE_FRAMEWORK.md](VOICE_FRAMEWORK.md).

---

## 1. Phạm vi & Nguyên tắc PR 2A

- **Chỉ đụng Backend + Unit Tests + `docs/API_REFERENCE.md`:** Không sửa UI/frontend (`static/*`) trong PR 2A để phạm vi gọn, dễ review và tránh đụng độ với PR 2B.
- **Tương thích ngược 100%:** Toàn bộ route hiện tại (`/api/chat`, `/api/tts`, `/api/stt` bản cũ, `/api/live`, `/api/live/gemini`, `/api/live/mistral`) và toàn bộ 826+ test hiện có phải tiếp tục pass không đổi hành vi.
- **Không bundler, 1 Cloudflare Worker:** Mọi module backend viết bằng ES modules thuần (Node 22 + Cloudflare Workers Runtime), không thêm dependency npm mới.
- **Fail-closed & Zero Secret Leakage:** Không fallback ngầm giữa kết nối Chat / Voice / Platform; không phản hồi error body hoặc echo API key từ provider; mọi custom origin phải qua [`voiceBase()`](../src/voice/tts-route.js#L28-L43) + `VOICE_ALLOWED_ORIGINS` + `redirect: 'manual'`.

---

## 2. Bản đồ File Tạo mới & Chỉnh sửa

| File | Hành động | Trách nhiệm chính |
| --- | --- | --- |
| [`src/llm.js`](../src/llm.js) | Sửa | Thêm `streamLLM(provider, opts)` và helper `deltaText()` giữ nguyên khoảng trắng giữa các token streaming |
| [`src/prompt.js`](../src/prompt.js) | Sửa | Thêm `voiceStreamingInstructions(level, opts)` giữ sư phạm của [`voiceInstructions()`](../src/prompt.js#L144-L174) + hợp đồng thẻ `<ja>`/`<vi>` |
| `src/voice/live-turn.js` | **Tạo mới** | Handler `liveTurnRoute(request, env)` + bộ cắt luồng tăng dần (`createSegmentChunker`) + SSE serializer |
| `src/voice/stt-route.js` | **Tạo mới** | Nâng cấp `POST /api/stt` (ElevenLabs Scribe `scribe_v2`, Mistral `context_bias`, `stt_routing` tường minh); [`src/transcription.js`](../src/transcription.js) re-export hoặc ủy quyền sang đây |
| [`src/voice/tts-route.js`](../src/voice/tts-route.js) | Sửa nhỏ | Export `selectConnection` (hoặc đặt alias `selectVoiceConnection`) để `stt-route.js` tái sử dụng nguyên vẹn logic kiểm quyền & SSRF |
| [`src/live.js`](../src/live.js) | Sửa nhỏ | Export [`lessonVocabulary()`](../src/live.js#L22-L26) (có lọc `processingAllowed`) để `stt-route.js` dùng chung cho Mistral `context_bias` |
| [`src/worker.js`](../src/worker.js) | Sửa | Gắn `POST /api/live/turn` vào `privateRoutes`, `api_connection` validation, `rateLimited`, và định tuyến tới `liveTurnRoute` |
| [`docs/API_REFERENCE.md`](API_REFERENCE.md) | Sửa | Bổ sung tài liệu cho `POST /api/live/turn` và tham số mới (`lesson`, `stt_routing`) của `POST /api/stt` |
| `tests/voice-phase2-live-turn.test.mjs` | **Tạo mới** | Unit & integration tests cho `streamLLM`, `voiceStreamingInstructions`, chunker cắt thẻ giữa chunk và `POST /api/live/turn` |
| `tests/voice-phase2-stt.test.mjs` | **Tạo mới** | Unit & integration tests cho ElevenLabs Scribe, Mistral `context_bias` + retry 422, `stt_routing` fail-closed |

---

## 3. Task 1 — `streamLLM()` trong [`src/llm.js`](../src/llm.js)

### 3.1. Chữ ký hàm & Giá trị trả về

```js
export async function streamLLM(
  provider,
  { system, turns, signal, onDelta },
  { budgetMs = 28000 } = {}
)
// Thành công: { ok: true, text: string, finishReason: string | null }
// Thất bại:   { ok: false, status: number, emitted: boolean, retryAfterMs?: number }
```

- `provider` dùng đúng cấu trúc từ [`resolveProvider()`](../src/providers.js#L34-L41): `{ source, protocol, baseUrl, apiKey, models, reasoningEffort? }`. Hoạt động đồng nhất cho Admin (`platform_openai`), Learner API key (OpenAI / Mistral / Claude / Gemini / Custom OpenAI-compatible) và **Antigravity OAuth** (`protocol: 'openai'`, xem [`antigravityProvider()`](../src/antigravity-gateway.js#L102-L110)).
- `turns` phải đi qua [`normalizeTurns(turns)`](../src/llm.js#L37-L46) trước khi gửi.
- `onDelta(chunkText)` được gọi đồng bộ (hoặc `await onDelta(chunkText)`) cho mỗi mẩu văn bản không rỗng nhận được từ upstream.

### 3.2. Endpoint & Payload theo 3 protocol

Tái sử dụng [`endpoint()`](../src/llm.js#L30-L34) và [`request()`](../src/llm.js#L57-L76) (không truyền `schema` — Live Turn không dùng JSON schema để giảm TTFB):

| `provider.protocol` | URL | Bổ sung vào `body` | Header bổ sung |
| --- | --- | --- | --- |
| `'openai'` | `${base}/chat/completions` | `body.stream = true` | `Accept: text/event-stream` |
| `'anthropic'` | `${base}/v1/messages` (hoặc `${base}/messages`) | `body.stream = true` (`max_tokens: 1024`) | `Accept: text/event-stream` |
| `'gemini'` | thay `:generateContent` bằng `:streamGenerateContent?alt=sse` | giữ nguyên `systemInstruction`, `contents` | `Accept: text/event-stream` |

### 3.3. Bốn điểm dễ lỗi BẮT BUỘC xử lý đúng

1. **KHÔNG được `.trim()` từng delta (khác với [`probeText()`](../src/llm.js#L242-L265)):**
   - `probeText()` gọi `textOf()` / `.trim()` cho mục đích kiểm tra 1 chữ `"OK"`. Nếu dùng lại `probeText()` cho streaming câu thật sẽ làm mất dấu cách giữa các từ tiếng Việt (`"Chào"` + `" em"` → `"Chàoem"`).
   - Viết hàm riêng `deltaText(protocol, data, streaming)`:
     - `openai` (`streaming = true`): đọc `data.choices?.[0]?.delta?.content`; nếu là `string` trả nguyên chuỗi (kể cả khoảng trắng đầu/cuối); nếu là mảng `parts`, lọc `!part.thought && (!part.type || ['text', 'output_text'].includes(part.type)) && typeof part.text === 'string'` rồi `.join('')` (KHÔNG `.trim()`).
     - `anthropic` (`streaming = true`): với `data.type === 'content_block_delta' && data.delta?.type === 'text_delta'`, trả nguyên `data.delta.text` (KHÔNG `.trim()`); với `content_block_start` có `content_block.type === 'text'`, trả nguyên `data.content_block.text`.
     - `gemini`: đọc `data.candidates?.[0]?.content?.parts`, lọc `typeof part?.text === 'string' && !part.thought`, `.join('')` (KHÔNG `.trim()`).
   - Nếu `data.error || data.type === 'error'`, ném lỗi stream ngay lập tức.
2. **Xử lý khung SSE cuối cùng của Gemini & `message_delta` của Anthropic:**
   - Kiểm tra trạng thái bị chặn/cắt cụt trên từng event **đúng theo schema streaming của mỗi protocol** (không gọi nguyên [`incomplete()`](../src/llm.js#L88-L96) lên `message_delta` của Anthropic vì Anthropic gửi `data.delta?.stop_reason` lồng trong `delta`, không ở top-level):
     - `openai`: `['length', 'content_filter'].includes(data.choices?.[0]?.finish_reason)`.
     - `anthropic`: `['max_tokens', 'refusal'].includes(data.delta?.stop_reason ?? data.stop_reason)`.
     - `gemini`: dùng lại [`incomplete('gemini', data)`](../src/llm.js#L91-L95) (`MAX_TOKENS`, `SAFETY`, `RECITATION`, `BLOCKLIST`, `promptFeedback.blockReason`, `safetyRatings`).
     Nếu bị chặn/cắt cụt → dừng stream và trả `{ ok: false, status: 502, emitted }`.
   - Nếu KHÔNG bị chặn/cắt cụt: **phát `delta` text TRƯỚC** (quan trọng với Gemini vì chunk cuối thường chứa cả `parts[0].text` lẫn `finishReason: "STOP"`), rồi mới ghi nhận `finishReason` (`finish_reason` / `delta?.stop_reason ?? stop_reason` / `finishReason`) và kết thúc khi gặp `[DONE]` / `message_stop` / EOF.
3. **Fallback danh sách `provider.models` CHỈ được phép trước delta đầu tiên:**
   - Lặp qua `for (const model of provider.models)`:
     - Nếu `emitted === false` và gặp mã trong `RETRYABLE` (`404, 429, 500, 502, 503, 504`) trong khi vẫn còn ngân sách thời gian (`left >= 1000ms`), được phép thử model tiếp theo (giống [`callLLM()`](../src/llm.js#L104-L136)).
     - Một khi `emitted === true` (đã gửi ít nhất 1 ký tự ra `onDelta`), **tuyệt đối không thử model thứ hai** — dừng ngay và trả `{ ok: false, status, emitted: true }` để caller phát `event: error`.
4. **Fallback JSON non-streaming & giới hạn tài nguyên:**
   - Một số proxy OpenAI-compatible bỏ qua `stream: true` và trả `Content-Type: application/json` (hoặc body bắt đầu bằng `{`). Giữ logic tự nhận diện `mode = 'json' | 'sse'` như [`probeModel()`](../src/llm.js#L183-L228): đọc đến EOF (tối đa `256 KiB`), kiểm tra `!incomplete(protocol, data)`, gọi `onDelta(text)` 1 lần rồi trả `{ ok: true, text, finishReason }`.
   - Timeout tổng `budgetMs = 28000` kết hợp `signal` từ client (`controller.abort()` khi hết hạn hoặc `signal` abort).
   - `redirect: 'manual'` (3xx quy về status `502`).
   - Giới hạn tổng byte đọc `<= 256 * 1024` bytes (vượt → `502`).
   - Trong `finally`: luôn `clearTimeout`, gỡ listener trên `signal`, và gọi `void reader.cancel().catch(() => {})` (hoặc `response.body.cancel()`).
   - Parse `Retry-After` khi gặp `429` giống `callLLM()`. Không bao giờ log hoặc trả body lỗi của provider.

---

## 4. Task 2 — `voiceStreamingInstructions()` trong [`src/prompt.js`](../src/prompt.js)

### 4.1. Chữ ký & Nội dung

```js
export function voiceStreamingInstructions(level, { japaneseOnly = false, preAnswerTask = false } = {})
```

- Kế thừa nguyên vẹn nền tảng sư phạm của [`voiceInstructions(level)`](../src/prompt.js#L144-L174) và [`VOICE_COMMANDS`](../src/prompt.js#L133-L142): vai Thầy Lâm (`thầy`/`em`), lớp học đảo ngược, `LEVEL_RULES[level]`, quy tắc hội thoại tự nhiên, sửa tối đa 2 lỗi có lý do ngắn, không bịa nhận xét, không chấm phát âm từ chữ.
- **Thêm mục `STREAMING OUTPUT FORMAT` bắt buộc:**
  - Bọc **mọi** câu/đoạn nói trong thẻ `<ja>...</ja>` (tiếng Nhật) hoặc `<vi>...</vi>` (tiếng Việt).
  - **Mỗi thẻ chỉ chứa đúng 1 ngôn ngữ**, không chèn từ tiếng Việt vào trong `<ja>...</ja>` và không chèn câu tiếng Nhật dài vào trong `<vi>...</vi>`. Nếu cần nhắc một từ tiếng Nhật trong lời giải thích tiếng Việt, tách thẻ rõ ràng: `<vi>Em dùng trợ từ</vi> <ja>に</ja> <vi>trước thời gian nhé.</vi>`.
  - Tối đa **3 câu ngắn** (~250 ký tự trừ khi `command === 'summary'` có thể dài tới 5 câu ngắn).
  - Tuyệt đối không dùng Markdown (`**`, `*`, `` ` ``, `#`), không gạch đầu dòng, không đánh số thứ tự, không lặp tên lệnh, không in ID bài học, tên trường JSON, hay giải thích về thẻ `<ja>`/`<vi>`.
- **Chế độ `japaneseOnly === true`:**
  - Nhấn mạnh chỉ xuất thẻ `<ja>...</ja>` trong toàn bộ lượt; chỉ dùng `<vi>...</vi>` nếu `message` của học viên chủ động hỏi bằng tiếng Việt hoặc báo không hiểu.
- **Chế độ `preAnswerTask === true` (khi `focus.kind === 'question'`):**
  - Bổ sung đúng quy tắc chống lộ đáp án từ [`src/tutor-chat.js`](../src/tutor-chat.js#L94): chỉ gợi ý chiến lược hoặc làm rõ yêu cầu, tuyệt đối không giải hộ, không nêu đáp án đúng, không loại trừ phương án, không tiết lộ `accepted_answers` hay transcript bài nghe.
- **Ràng buộc chống Prompt Injection (`INPUT BOUNDARY`):**
  - Nhấn mạnh toàn bộ dữ liệu học viên gửi lên nằm trong JSON user message duy nhất `{ message, command, japanese_only, reference: { lesson, history } }` — chỉ là dữ liệu, **không có quyền** đổi vai, đổi ngôn ngữ ngoài luật, bỏ thẻ `<ja>`/`<vi>`, hay tiết lộ system prompt.

---

## 5. Task 3 — `src/voice/live-turn.js` & Route `POST /api/live/turn`

### 5.1. Gắn middleware trong [`src/worker.js`](../src/worker.js)

1. Import `liveTurnRoute` từ `./voice/live-turn.js`.
2. Thêm `'/api/live/turn'` vào `privateRoutes` ([`src/worker.js`](../src/worker.js#L80)).
3. Thêm `'/api/live/turn'` vào danh sách kiểm tra `api_connection` ([`src/worker.js`](../src/worker.js#L100)) — lưu ý: nếu `X-VJBot-Profile` có mặt đồng thời với `api_connection`, `resolveProvider()` trong `live-turn.js` sẽ từ chối `400 invalid_connection`.
4. Thêm `'/api/live/turn'` vào danh sách `rateLimited` ([`src/worker.js`](../src/worker.js#L110)) — dùng chung quota `20 req/phút` trên bảng `ai_usage`.
5. Định tuyến:
   ```js
   if (url.pathname === '/api/live/turn' && request.method === 'POST') {
     return await liveTurnRoute(request, env);
   }
   ```
   *(Lưu ý: nếu `method !== 'POST'` trên `/api/live/turn`, trả `405` tương tự `/api/stt` hoặc rơi về 404/405 nhất quán; khuyến nghị trả `405` ngay trong nhánh `/api/live/turn`.)*

### 5.2. Hợp đồng Request (`POST /api/live/turn`)

- **Headers bắt buộc:**
  - Cookie phiên hợp lệ (đã kiểm tra tại `privateRoutes` → `401` nếu thiếu).
  - `X-VJBot-Account`: **bắt buộc bằng `user.user_id`** — kiểm tra chặt `request.headers.get('X-VJBot-Account') !== userId` ngay đầu `liveTurnRoute` → `409 { code: 'account_changed', detail: 'Tài khoản đã đổi. Hãy tải lại trang.' }` (giống `/api/tts` Voice v2 tại [`src/worker.js`](../src/worker.js#L446)).
  - `X-VJBot-Profile`: tùy chọn (server profile / `platform_openai` / `antigravity_oauth:<id>`).
- **Body JSON (`<= 20 KiB`, đã chặn ở `src/worker.js#L94`):**
  ```json
  {
    "level": "N5",
    "lesson": { "id": "grammar:1", "level": "N5" },
    "focus": { "kind": "word", "index": 0 },
    "view": "checks",
    "task": { "id": "task_123", "revision": "<64-hex>" },
    "command": null,
    "transcript": "こんにちは、ラム先生。",
    "history": [
      { "role": "assistant", "text": "こんにちは！お元気ですか？" },
      { "role": "user", "text": "はい、元気です。" }
    ],
    "japanese_only": false
  }
  ```

### 5.3. Ma trận Validation (fail-closed TRƯỚC khi mở SSE stream)

| Trường | Điều kiện hợp lệ | Nếu sai → HTTP & `code` |
| --- | --- | --- |
| `level` | Bắt buộc hoặc mặc định `'N5'`; phải thuộc `['N5','N4','N3','N2','N1']` | `400` `live_invalid_request` |
| `command` | `null` / `undefined` hoặc thuộc `['start','hint','explain','situation','check','slower','summary']` *(không gồm `'repeat'` vì client phát từ RAM)* | `400` `live_invalid_request` |
| `transcript` | Nếu có: `string`, sau `.trim()` dài `<= 1500` ký tự. **Bắt buộc** có ít nhất một trong hai: `command` khác rỗng HOẶC `transcript.trim().length > 0` | `400` `live_invalid_request` |
| `japanese_only` | `undefined` hoặc `boolean` | `400` `live_invalid_request` |
| `history` | `undefined` hoặc mảng tối đa **12 phần tử**; mỗi phần tử là object `{ role: 'user' \| 'assistant', text: string (1..600 ký tự) }`. Strip thẻ `<ja>`/`</ja>`/`<vi>`/`</vi>` khỏi `text` khi đóng envelope. | `400` `live_invalid_request` |
| `lesson` / `focus` / `view` / `task` | Dùng đúng chuỗi kiểm tra của [`src/tutor-chat.js`](../src/tutor-chat.js#L17-L53): `validLessonReference`, `validFocusReference`, `view ∈ ['checks','exam']`, `validTaskReference`, `teacherCatalog`, `catalogLesson`, `processingAllowed(lesson)`, `resolveTaskReference` (khi `focus.kind === 'question'`), `groundLesson(lesson, focus, view)`. | `400` (tham chiếu sai), `409` (`processingAllowed === false` hoặc task đổi), `503` (không tải được catalog) |
| Envelope size | `JSON.stringify(envelope).length <= 16000` (giống [`src/tutor-chat.js`](../src/tutor-chat.js#L91)) | `413` `live_context_too_large` |
| Chat provider | `resolveProvider(env, userId, body.api_connection, profileId)` → nếu lỗi trả trực tiếp `providerFailure(provider)` (`400`/`403`/`409`) | Dùng nguyên mã `no_ai`, `rekey`, `profile_changed`, `oauth_model`, `oauth_reconnect`, `invalid_connection` |

- **Lưu ý bảo mật dữ liệu:** `POST /api/live/turn` **KHÔNG** ghi vào bảng `conversations` hay `tutor_sessions` trên D1 (đảm bảo cam kết riêng tư phiên thoại chỉ tồn tại trên RAM trình duyệt).
- **Cấu trúc JSON User Envelope gửi sang `streamLLM()`:**
  ```js
  const envelope = {
    message: cleanTranscript || null,
    command: command ? { key: command, instruction: VOICE_COMMANDS[command] } : null,
    japanese_only: japaneseOnly,
    reference: {
      level,
      lesson: groundedLesson, // null hoặc output của groundLesson()
      history: cleanHistory   // mảng tối đa 12 phần tử { role, text }
    }
  };
  // Gọi streamLLM với turns: [{ role: 'user', content: JSON.stringify(envelope) }]
  ```

### 5.4. Bộ cắt luồng tăng dần (`createSegmentChunker`)

Thiết kế như một pure function dễ unit-test độc lập:

```js
export function createSegmentChunker({ maxSegments = 8, onSegment } = {})
// Trả về: { push(delta: string): void, flush(): { fullText: string, count: number } }
```

**Thuật toán từng bước:**

1. Giữ `buffer = ''`, `segments = []`, `tagMode = null` (`null` chưa xác định | `'tagged'` | `'plain'`).
2. Mỗi lần `push(delta)`:
   - Nếu `segments.length >= maxSegments`: bỏ qua phần dư (không emit thêm).
   - Nối `buffer += delta`.
   - Khi `tagMode === null`:
     - Nếu `buffer` (bỏ khoảng trắng đầu) bắt đầu bằng `<ja>` hoặc `<vi>` (không phân biệt hoa/thường) → `tagMode = 'tagged'`.
     - Nếu có prefix `<` ngắn hơn 4 ký tự (`<`, `<j`, `<ja`, `<v`, `<vi`) → chờ chunk tiếp theo.
     - Ngược lại, nếu tìm thấy `<ja>` hoặc `<vi>` ở sau một đoạn chữ thường ngắn → tách phần chữ thường phía trước chạy `plainEmit()`, rồi chuyển `tagMode = 'tagged'`.
     - Nếu không có dấu `<` nào và gặp dấu kết thúc câu `[。！？.!?]` (hoặc buffer vượt 160 ký tự) → `tagMode = 'plain'`.
   - Khi `tagMode === 'tagged'`:
     - Lặp tìm cặp thẻ hoàn chỉnh đầu tiên `/<(ja|vi)>([\s\S]*?)<\/\1>/i`:
       - **Luôn cắt bỏ toàn bộ phần đã khớp (kể cả `prefix` + thẻ vừa khớp) ra khỏi `buffer` TRƯỚC tiên** — bất kể bên trong thẻ có chữ hay không — để các thẻ rỗng (`<ja></ja>`) hoặc chỉ chứa dấu câu (`<ja>...</ja>`) không bao giờ làm kẹt vòng lặp vô hạn.
       - Nếu có `prefix` lọt trước thẻ mở (do LLM viết chen): chạy `plainEmit(prefix)`.
       - Lấy `lang = match[1].toLowerCase()`, `raw = match[2]`.
       - Chuẩn hóa qua [`normalizeVoiceText(raw)`](../src/voice/normalizer.js#L10-L20); nếu `lang === 'ja'`, chạy thêm [`particleReading()`](../src/voice/normalizer.js#L23-L26).
       - Chỉ gọi `emit(lang, clean)` nếu còn chữ cái (`/\p{L}/u.test(clean)`).
     - **An toàn với thẻ bị cắt đôi giữa 2 chunk TCP** (ví dụ chunk 1 kết thúc bằng `"こんにちは。</j"`, chunk 2 bắt đầu bằng `"a><vi>Chào em</vi>"`): vì regex chưa khớp thẻ đóng hoàn chỉnh, phần chưa khớp vẫn nằm nguyên trong `buffer` chờ chunk 2 ghép vào!
     - Nếu buffer có thẻ mở `<ja>` nhưng bên trong dài `> 220` ký tự chưa thấy thẻ đóng (LLM quên đóng thẻ) và đã qua một dấu kết thúc câu `[。！？.!?]`, cắt tại dấu câu gần nhất và emit ngay để không nghẽn TTFB.
   - Khi `tagMode === 'plain'` (LLM quên hoàn toàn thẻ `<ja>`/`<vi>`):
     - Cắt theo dấu kết thúc câu `/(.*?[。！？.!?…][」』”’"')）]*)(?:\s+|$)/u` (hoặc ngắt tại khoảng trắng/dấu phẩy nếu buffer `> 180` ký tự).
     - Chạy [`segmentVoiceText(normalizeVoiceText(sentence), 'bilingual')`](../src/voice/segmenter.js#L13-L75) trên câu vừa cắt, rồi emit từng segment kết quả.
3. Khi `flush()` (kết thúc `streamLLM`):
   - Nếu `buffer.trim()` còn dư:
     - Với thẻ mở chưa đóng (`/<(ja|vi)>([\s\S]*)$/i`): lấy nội dung bên trong, strip mọi thẻ lạc, chuẩn hóa và emit.
     - Ngược lại: chạy `segmentVoiceText(normalizeVoiceText(buffer.replace(/<\/?(?:ja|vi)>/gi, ' ')), 'bilingual')` và emit phần còn lại (tới tối đa `maxSegments`).
   - Trả `{ fullText: segments.map(s => s.text).join(' '), count: segments.length }`.
4. **Quy tắc `boundary` cho từng segment phát ra:**
   - Segment `index === 0` → `boundary = 'start'`.
   - Segment `index > 0`: nếu segment liền trước kết thúc bằng `[。！？.!?…][」』”’"')）]*$` → `'sentence'`, ngược lại → `'inline'`.
   - Giới hạn cứng `maxSegments = 8`. Nếu tổng `count === 0` sau `flush()`, phát `event: error` với `{ code: 'live_empty_reply', detail: 'Thầy chưa trả lời được. Em thử nói lại nhé.' }`.

### 5.5. Hợp đồng SSE Wire Format

Headers response khi bắt đầu stream:
```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store
X-Content-Type-Options: nosniff
```

Ba loại event (mỗi event kết thúc bằng `\n\n`):
```text
event: segment
data: {"index":0,"lang":"ja","boundary":"start","text":"こんにちは！お元気ですか？"}

event: segment
data: {"index":1,"lang":"vi","boundary":"sentence","text":"Em trả lời bằng tiếng Nhật nhé."}

event: done
data: {"full_text":"こんにちは！お元気ですか？ Em trả lời bằng tiếng Nhật nhé.","count":2,"japanese_only":false}
```

Khi gặp lỗi trong lúc đang stream (upstream 429/5xx, timeout, safety block, hoặc `count === 0`):
```text
event: error
data: {"code":"live_quota","detail":"Đã chạm giới hạn lượt dùng của nhà cung cấp. Hãy thử lại sau."}
```

- Các mã lỗi `event: error` chuẩn hóa:
  - `live_quota` (upstream `429`)
  - `live_billing` (upstream `402`)
  - `live_key_rejected` (upstream `401`/`403`)
  - `live_timeout` (quá 28s)
  - `live_empty_reply` (LLM kết thúc nhưng không có chữ hợp lệ)
  - `live_unavailable` (các lỗi upstream 5xx / JSON hỏng / bị chặn nội dung)
- Nếu `request.signal` bị abort (học viên barge-in hoặc đóng cuộc gọi): hủy `streamLLM` qua `signal` và đóng stream êm, không ghi log lỗi nhiễu.

---

## 6. Task 4 — Nâng cấp Unified `POST /api/stt` (`src/voice/stt-route.js`)

### 6.1. Cấu trúc module & Chia sẻ helper

- Tạo `src/voice/stt-route.js` xuất `transcriptionRoute(request, env)` (để [`src/transcription.js`](../src/transcription.js) re-export `export { transcriptionRoute } from './voice/stt-route.js';` hoặc [`src/worker.js`](../src/worker.js#L15) import trực tiếp — giữ nguyên export của `src/transcription.js` để không phá vỡ bất kỳ test nào import trực tiếp từ `src/transcription.js`).
- Export `selectConnection` từ [`src/voice/tts-route.js`](../src/voice/tts-route.js#L51-L74) (đặt tên export `selectVoiceConnection` hoặc `export async function selectConnection`) để `stt-route.js` dùng chung 100% logic:
  - Kiểm tra `admin` vs `admin_override` (`platform` chỉ cho Admin khi `override === false`; `local`/`server` chỉ cho Admin khi `override === true` hoặc Learner khi `override === false`).
  - Giải mã `key_enc` trên D1 bằng `unseal(env, userId, row.key_enc)` và khớp `storedKind(row) === kind`.
  - Xác thực URL qua `voiceBase(kind, base, env)` + `VOICE_ALLOWED_ORIGINS` + cấm leak `apiKey` trong URL.
- Tách/export helper [`lessonVocabulary(lesson)`](../src/live.js#L22-L26) từ `src/live.js`:
  - Chỉ truyền `lesson` đã đạt `processingAllowed(lesson)` (hoặc `null` nếu không gắn bài).
  - Giữ đúng logic hiện có: lọc `word` trong `lesson?.words` đạt `processingAllowed(word)` có `typeof word?.jp === 'string' && word.jp.length <= 40`, ghép với `MISTRAL_STT_STAPLES`, khử trùng bằng `Set` và cắt tối đa **40** mục.

### 6.2. Nhánh chọn kết nối STT (Hai chế độ tách biệt tuyệt đối)

1. **Chế độ Legacy / Mặc định (`!Object.hasOwn(data, 'stt_routing')`):**
   - Giữ nguyên 100% logic chọn kết nối của [`src/transcription.js`](../src/transcription.js#L28-L37) để toàn bộ test trong [`tests/worker.test.mjs`](../tests/worker.test.mjs#L1205-L1315) pass nguyên vẹn, đồng thời **bổ sung trường `provider: 'openai'` / `provider: 'mistral'`** vào 2 candidate legacy (`{ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-transcribe', label: 'OpenAI' }` và `{ provider: 'mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'voxtral-mini-transcribe-3', label: 'Mistral' }`):
     - Admin → `platform_openai` (`https://api.openai.com/v1`, `gpt-transcribe`).
     - Learner → chỉ chấp nhận Chat connection tường minh (`X-VJBot-Profile` hoặc `api_connection`) có `protocol === 'openai'` và `baseUrl` là OpenAI chính thức hoặc Mistral chính thức (`https://api.mistral.ai/v1`).
     - Tuyệt đối không mượn Voice profile nếu không có `stt_routing`.
2. **Chế độ Tường minh (`Object.hasOwn(data, 'stt_routing')`):**
   - **Loại trừ lẫn nhau (Mutual exclusion):** Nếu đồng thời tồn tại `Object.hasOwn(data, 'api_connection')` HOẶC `request.headers.has('X-VJBot-Profile')` → trả ngay `400 { code: 'stt_invalid_routing', detail: 'Chỉ gửi một cấu hình chép lời.' }`.
   - **Schema `stt_routing`:**
     ```json
     {
       "version": 2,
       "admin_override": false,
       "provider": "elevenlabs",
       "profile": {
         "scope": "local",
         "id": "prof_1",
         "connection": { "base_url": "https://api.elevenlabs.io", "api_key": "..." }
       }
     }
     ```
   - Chỉ chấp nhận `version === 2`, `provider ∈ ['elevenlabs', 'mistral', 'openai']`, `admin_override` là `undefined | boolean`. Sai schema → `400 { code: 'stt_invalid_routing' }`.
   - Gọi `selectConnection({ provider: r.provider, profile: r.profile }, env, user.user_id, admin, r.admin_override === true)`. Nếu ném `VoiceError`:
     - Map `tts_invalid_routing` → `400 { code: 'stt_invalid_routing' }`.
     - Map `tts_profile_unavailable` → `403 { code: 'stt_profile_unavailable' }`.
     - **Tuyệt đối không fallback sang kết nối Chat hay `OPENAI_API_KEY` máy chủ.**
   - Bảng model theo provider:

| `provider` | Model | Endpoint | Auth Header |
| --- | --- | --- | --- |
| `'openai'` | `'gpt-transcribe'` | `${baseUrl}/audio/transcriptions` | `Authorization: Bearer <key>` |
| `'mistral'` | `'voxtral-mini-transcribe-3'` | `${baseUrl}/audio/transcriptions` | `Authorization: Bearer <key>` |
| `'elevenlabs'` | `'scribe_v2'` | `${baseUrl}/v1/speech-to-text` | `xi-api-key: <key>` |

### 6.3. Hợp đồng `capabilities`

- Khi `data.action === 'capabilities'`:
  - Không tính vào `rateLimited`, không cần `audio`/`mime_type`.
  - Nếu có `stt_routing` hợp lệ và `selectConnection` thành công → trả `200 { supported: true, provider, model }`.
  - Nếu `stt_routing` không dùng được (`VoiceError` 403) → trả `200 { supported: false, provider: null, model: null }` (hoặc `400` nếu sai schema/trộn cả 2 loại cấu hình).
  - Nếu không có `stt_routing` → giữ nguyên `{ supported: !!engine, provider: engine?.provider ?? null, model: engine?.model ?? null }` (tương thích hoàn toàn với caller cũ chỉ đọc `.supported` và `.model`).

### 6.4. Hợp đồng ElevenLabs Scribe & Mistral `context_bias`

- **Validation `lesson` tùy chọn (dùng cho Mistral `context_bias`):**
  - Chỉ xử lý khi `data.lesson !== undefined && data.lesson !== null`.
  - Kiểm tra `validLessonReference(data.lesson)` → sai trả `400`.
  - Tải `teacherCatalog(env, data.lesson.level)` + `catalogLesson(catalog, data.lesson)`:
    - Không tìm thấy catalog → `503`; không tìm thấy lesson → `400`.
    - `!processingAllowed(lesson)` → **`409 { detail: 'Nguồn này không được phép gửi cho nhà cung cấp AI xử lý.' }`** (fail-closed trước khi gọi STT!).
  - Rút `bias = lessonVocabulary(lesson)` (tối đa 40 từ).
- **Gọi ElevenLabs Scribe (`provider === 'elevenlabs'`):**
  - `FormData`: `form.set('file', new Blob([bytes], { type: mime }), 'recording.' + formats[mime])`, `form.set('model_id', 'scribe_v2')`.
  - `fetch(`${baseUrl}/v1/speech-to-text`, { method: 'POST', redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]), headers: { 'xi-api-key': apiKey }, body: form })`.
  - Validate `typeof result?.text === 'string' && result.text.length <= 6000` → trả `200 { text: result.text.trim() }`.
- **Gọi Mistral (`provider === 'mistral'`):**
  - Khi `bias.length > 0`, gắn `context_bias` vào `FormData` bằng trường lặp theo tài liệu Mistral (`for (const term of bias) form.append('context_bias', term)`).
  - Nếu nhận `response.status === 422` (hoặc `400` do vượt ngữ cảnh khi kèm bias) và lần gọi vừa rồi có `bias.length > 0`: hủy body (`await response.body?.cancel()`) và **thử lại đúng 1 lần** với `FormData` mới không kèm `context_bias`.
- **Quản lý lỗi & Quota:**
  - Gọi `rateLimited(env, user.user_id)` **sau** mọi bước validate input/routing/lesson (tránh đốt quota vì request lỗi 400/403/409), **trước** khi gọi upstream `fetch`.
  - Never forward the provider's error body. Map `402` to HTTP `402` with `stt_billing` for both routes, and `429` to HTTP `429`. With explicit routing, map `401`/`403` to `403`, other upstream failures to `503`, timeouts to `504`, and invalid results to `502`. Legacy routing keeps its existing non-billing errors.

---

## 7. Ma trận Kiểm thử Bắt buộc cho PR 2A

### 7.1. `tests/voice-phase2-live-turn.test.mjs`

1. **`streamLLM()` trên 3 protocol (`openai`, `anthropic`, `gemini`):**
   - Giữ nguyên khoảng trắng giữa các delta (`"Chào"` + `" em."` → `"Chào em."`).
   - Gemini trả đồng thời `parts[0].text` + `finishReason: "STOP"` ở chunk cuối vẫn emit đủ chữ cuối.
   - Gemini báo `SAFETY`, OpenAI báo `content_filter`, và Anthropic gửi event `message_delta` với `delta.stop_reason: 'refusal'` / `'max_tokens'` (lồng trong `delta`, không chỉ top-level) đều trả `{ ok: false, status: 502 }`.
   - Fallback sang JSON thường khi upstream bỏ qua `stream: true`.
   - Fallback sang model thứ 2 trong `provider.models` khi model đầu trả `503` **trước** delta đầu tiên; **KHÔNG** fallback nếu đã emit delta trước khi gặp lỗi giữa chừng.
   - Abort `signal` phía caller hủy ngay upstream `fetch` và gọi `reader.cancel()`.
   - Chặn redirect `3xx` (`redirect: 'manual'`) và chặn stream vượt `256 KiB`.
2. **`createSegmentChunker()`:**
   - Thẻ `<ja>`/`</ja>` và `<vi>`/`</vi>` bị tách đôi ở mọi vị trí biên byte/ký tự:
     - Có dấu kết thúc câu: `"<j"`, `"a>おはよう。</"`, `"ja><vi>Chào em</vi>"` → cắt đúng 2 segment với `boundary: 'start'` và `'sentence'`.
     - Không có dấu kết thúc câu: `"<j"`, `"a>おはよう</"`, `"ja><vi>Chào em</vi>"` → cắt đúng 2 segment với `boundary: 'start'` và `'inline'`.
   - Thẻ rỗng hoặc chỉ chứa dấu câu (`<ja></ja>`, `<vi>...</vi>`) bị loại bỏ sạch khỏi buffer, không emit segment rỗng và không gây lặp vô hạn.
   - Chạy [`normalizeVoiceText()`](../src/voice/normalizer.js#L10-L20) và [`particleReading()`](../src/voice/normalizer.js#L23-L26) (trợ từ đứng riêng `は` → `わ`, `へ` → `え`).
   - LLM quên gắn thẻ → fallback plain text tự cắt tại dấu câu và gán đúng `lang` qua `segmentVoiceText()`.
   - Cắt trần ở 8 segment tối đa (`maxSegments = 8`).
3. **Route `POST /api/live/turn` qua `worker.fetch`:**
   - Từ chối `401` (chưa đăng nhập), `409` (thiếu hoặc lệch `X-VJBot-Account`), `400` (sai `level`, thiếu cả `transcript` lẫn `command`, `command: 'repeat'`, `history > 12`, trộn `api_connection` + `X-VJBot-Profile`), `429` (đã đạt trần 20 req/phút).
   - Xác thực đủ 7 `VOICE_COMMANDS` (`start`, `hint`, `explain`, `situation`, `check`, `slower`, `summary`).
   - Grounding bài học & `focus.kind === 'question'`: từ chối `409` khi `processingAllowed === false` hoặc `task.revision` lệch; khi hợp lệ, `system` prompt bật quy tắc không tiết lộ đáp án và envelope KHÔNG chứa `answer_index`/`accepted_answers`.
   - Prompt injection trong `transcript` và `history` luôn nằm trong JSON user envelope duy nhất, không lọt vào `system` prompt; không ghi bản ghi nào vào bảng `conversations` hay `tutor_sessions`.
   - Hoạt động với Admin (`platform_openai`), Learner (local + server profile) và Antigravity OAuth (`X-VJBot-Profile: antigravity_oauth:<id>`).
   - SSE stream trả đúng chuỗi `event: segment` → `event: done`, hoặc `event: error` khi upstream lỗi giữa chừng (không lộ API key).

### 7.2. `tests/voice-phase2-stt.test.mjs`

1. **ElevenLabs Scribe (`stt_routing` với `provider: 'elevenlabs'`):**
   - Gửi đúng `POST https://api.elevenlabs.io/v1/speech-to-text`, header `xi-api-key`, `model_id: 'scribe_v2'`, `redirect: 'manual'`.
   - Proxy custom được duyệt trong `VOICE_ALLOWED_ORIGINS` giữ nguyên versioned mount; domain chưa duyệt bị từ chối `403` trước khi gọi mạng.
   - `{ action: 'capabilities', stt_routing }` trả `{ supported: true, provider: 'elevenlabs', model: 'scribe_v2' }`.
2. **Mistral `context_bias` & retry 422:**
   - Khi kèm `lesson` hợp lệ đạt `processingAllowed`, gửi tối đa 40 từ vào `context_bias`; khi Mistral trả `422`, retry đúng 1 lần không kèm `context_bias` và thành công `200`.
   - Khi `lesson` có `processing_allowed: false` hoặc bị `quarantined` → trả `409`, 0 request tới Mistral.
3. **Cách ly tài khoản & Fail-closed cho `stt_routing`:**
   - Trộn `stt_routing` với `api_connection` hoặc `X-VJBot-Profile` → `400 stt_invalid_routing`.
   - Learner dùng `stt_routing` với Voice profile ElevenLabs/Mistral thành công ngay cả khi Chat đang dùng Antigravity OAuth hoặc không có Chat key OpenAI.
   - Profile server đã bị xóa, sai chủ sở hữu, hoặc Admin thiếu `admin_override: true` → `403 stt_profile_unavailable`, tuyệt đối không fallback sang `OPENAI_API_KEY` hay Chat key.
   - Không rò rỉ body lỗi hoặc `apiKey` khi upstream trả `429`/`503`.

### 7.3. Kiểm chứng bắt buộc trước khi mở PR 2A

```bash
git diff --check
npm test
npm run build
```

- Dùng `npm run build` (thay vì chỉ `build:worker`) để chạy đủ `prebuild` (`npm run teacher:catalog`) và `cf deploy --dry-run`.
- Vì Task 2 có sửa [`src/prompt.js`](../src/prompt.js), thực hiện thêm bước kiểm chứng bắt buộc trong [CONTRIBUTING.md](CONTRIBUTING.md#L48-L50): chạy tay một hội thoại **5 lượt** (sai, gợi ý, đúng, tự giải thích, kết thúc) ở cả **N5** và **N3** qua `voiceStreamingInstructions()` và dán kết quả vào mô tả PR.

---

## 8. Điểm nối bàn giao sang PR 2B (Frontend Cascaded Live Voice)

Sau khi **PR 2A** merge vào `main`, **PR 2B** sẽ triển khai frontend theo [VOICE_PHASE2_GUIDE.md](VOICE_PHASE2_GUIDE.md) dựa trên 3 điểm nối cố định này:

1. **`static/api-profiles.js` & `static/account.js`:**
   - Thêm `'/api/live/turn'` vào `PATHS` ([`static/api-profiles.js`](../static/api-profiles.js#L11)) và danh sách `inference` ([`static/account.js`](../static/account.js#L19)) để tự động đính kèm Chat connection (`api_connection` local hoặc `X-VJBot-Profile` server / `platform_openai` / `antigravity_oauth:<id>`).
   - Tại [`static/account.js`](../static/account.js#L20-L27): đổi nhánh `if (voiceRouting === true && speech)` thành `if (voiceRouting === true && voice)` (trong đó `voice = speech || path === '/api/stt'` đã có sẵn ở dòng 20). Khi PR 2B gọi `apiFetch('/api/stt', { method: 'POST', voiceRouting: true, body: JSON.stringify({ ..., stt_routing }) })`, nhánh này sẽ xóa `X-VJBot-Profile` và **bỏ qua cả việc gắn `platform_openai` của Admin lẫn `VJProfiles.prepareRequest` của Learner**, tránh lỗi `400 stt_invalid_routing` trên cả hai vai trò.
2. **`static/voice/live-cascaded.js`:**
   - Đọc SSE từ `POST /api/live/turn` (`event: segment` / `done` / `error`).
   - Bắn `POST /api/tts` ngay cho segment `#0`, gom `#1..#N` vào 1 request `POST /api/tts` sau khi nhận `event: done`, và **tuần tự hóa mọi lời gọi `VJVoiceStitcher.append()` qua một chuỗi promise duy nhất** để đảm bảo thứ tự phát không bao giờ bị đảo.
3. **`static/voice/voice-settings.js`:**
   - Mở rộng `VoiceRoutingConfig.live` (`engine`, `turn_mode`, `barge_in`, `stt_source`) và dùng `POST /api/stt { action: 'capabilities', stt_routing? }` để hiển thị đúng nguồn STT trước khi vào cuộc gọi.
