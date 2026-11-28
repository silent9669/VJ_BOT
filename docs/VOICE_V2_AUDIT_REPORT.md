# Báo cáo Audit & Code Review — Voice v2 (PR #2 & PR #3)

- **Phạm vi kiểm tra:** Toàn bộ 25 file thay đổi từ `74ecfcc` đến `4282598` (`+1,717 / -53` dòng), bao gồm PR #2 (`feature/voice-v2-tts`) và PR #3 (`fix/voice-v2-devin-review`).
- **Tình trạng CI tại `4282598`:** `815/815` Node tests pass, Chromium Web Audio test pass, Cloudflare Worker build pass, Devin Review pass.
- **Kết luận tổng quan:** Kiến trúc bảo mật, cách ly tài khoản và streaming NDJSON ở PR #2–#3 được làm chắc tay. Tuy nhiên, còn **9 lỗi kỹ thuật** (4 Cao, 5 Trung bình) và **1 lưu ý vận hành quan trọng** chưa được bộ test hiện tại phát hiện — nên xử lý dứt điểm trước khi đưa vào dùng rộng rãi với **ElevenLabs / Mistral / iOS Safari** và trước khi triển khai **Phase 2 (Cascaded Live Voice)**.

---

## 1. Bảng tổng hợp Findings

| ID | Mức độ | Hạng mục | File & Dòng | Ảnh hưởng chính |
| --- | --- | --- | --- | --- |
| **F-01** | **Cao** | `readDuration()` qua `<audio>` rời | [`static/voice/audio-stitcher.js`](../static/voice/audio-stitcher.js#L15-L27), [`L44-L46`](../static/voice/audio-stitcher.js#L44-L46) | Chặn nhầm MP3 streaming/VBR (`duration = Infinity`) và dễ timeout trên iOS Safari |
| **F-02** | **Cao** | Trần cứng `MAX_SEGMENTS = 8` trả `413` | [`src/voice/segmenter.js`](../src/voice/segmenter.js#L68), [`src/voice/tts-route.js`](../src/voice/tts-route.js#L148) | Câu giải thích ngữ pháp ngắn (~50 từ, 4 từ Nhật xen kẽ) đã ra 9 đoạn → fail `413` |
| **F-03** | **Cao** | `playbackRate = 0.9` làm tụt cao độ giọng Nhật | [`static/voice/audio-stitcher.js`](../static/voice/audio-stitcher.js#L65), [`static/voice/voice-settings.js`](../static/voice/voice-settings.js#L15) | `AudioBufferSourceNode` không giữ pitch → chuyển từ Việt sang Nhật bị trầm/méo giọng |
| **F-04** | **Cao** | ElevenLabs params không khớp `eleven_v3` & v1 | [`src/voice/tts-adapters.js`](../src/voice/tts-adapters.js#L129-L133) | Gửi `previous_text`/`next_text` cho `eleven_v3` và `language_code` cho model v1 dễ bị 422 |
| **F-05** | **Trung bình** | Cache Hit vẫn gọi `prepared()` | [`static/voice/voice-player.js`](../static/voice/voice-player.js#L78-L83) | Mọi lần nghe lại từ đã cache vẫn gọi `GET /api/ai/profiles` (server) / giải mã IndexedDB |
| **F-06** | **Trung bình** | Nút Nghe tin nhắn Chat sai CSS & mất vùng bôi đen | [`static/app.js`](../static/app.js#L394-L403) | Dùng nhầm `.chat-audio-btn` (nút 52px/44×44px) thay vì `.bubble-tts-btn`; `mousedown` làm mất selection |
| **F-07** | **Trung bình** | Trim silence 0ms đệm + fade 12ms | [`static/voice/audio-stitcher.js`](../static/voice/audio-stitcher.js#L52-L70) | Cắt sát mẫu `-42 dBFS` rồi fade 12ms đè lên phụ âm bật hơi đầu/cuối |
| **F-08** | **Trung bình** | `SUFFIX['elevenlabs']` là `undefined`, không cắt `/v1` | [`static/api-profiles.js`](../static/api-profiles.js#L8-L38), [`src/voice/tts-route.js`](../src/voice/tts-route.js#L33) | Gọi `.replace(undefined, '')`; dán `https://api.elevenlabs.io/v1` bị lỗi `403` / `/v1/v1/...` |
| **F-09** | **Trung bình** | `kanji_native` bỏ qua `reading` từ vựng đa âm | [`src/voice/normalizer.js`](../src/voice/normalizer.js#L4-L7) | Flashcard/từ vựng (`一日` → `ついたち`) bị bỏ qua `reading` dù cache key vẫn tính |
| **OPS-01** | **Lưu ý** | `VOICE_ALLOWED_ORIGINS` chưa có trong docs deploy | [`src/voice/tts-route.js`](../src/voice/tts-route.js#L39-L40), [`docs/DEPLOYMENT_CICD.md`](DEPLOYMENT_CICD.md) | Custom TTS URL / proxy bị chặn `403` nếu không khai báo `VOICE_ALLOWED_ORIGINS` trên Cloudflare |

---

## 2. Phân tích chi tiết từng Finding & Hướng sửa

### F-01 (Cao): `readDuration()` bằng `<audio preload="metadata">` dễ làm lỗi phát MP3 & iOS Safari

- **Vị trí:** [`static/voice/audio-stitcher.js`](../static/voice/audio-stitcher.js#L15-L27) và [`L44-L46`](../static/voice/audio-stitcher.js#L44-L46)
- **Code hiện tại:**
  ```js
  const durationHint = await readDuration(encoded, uri.slice(5, uri.indexOf(';')), abort.signal);
  if (!Number.isFinite(durationHint) || durationHint <= 0 || durationHint > maxSeconds)
    throw new Error('Đoạn âm thanh quá dài. Hãy chọn đoạn ngắn hơn.');
  ```
- **Nguyên nhân & Kịch bản tái hiện:**
  1. `readDuration()` tạo một phần tử `new Audio()` tách rời DOM sau khi `await fetch('/api/tts')` hoàn tất (tức **ngoài user gesture**). Trên **iOS Safari**, WebKit thường trì hoãn/không tự nạp `preload="metadata"` cho `<audio>` detached → dễ chạm timeout 5 giây (`Không đọc được thời lượng âm thanh.`).
  2. Với các luồng **MP3 VBR / streaming MP3 không có Xing header** hoặc **OGG/Opus** từ ElevenLabs / custom TTS server, `media.duration` trả về `Infinity`. Điều kiện `!Number.isFinite(durationHint)` ném lỗi *"Đoạn âm thanh quá dài"* dù đoạn audio chỉ dài 1–2 giây.
  3. Test [`tests/voice-v2-browser.mjs`](../tests/voice-v2-browser.mjs#L77-L90) chưa phát hiện vì chỉ tạo fixture `WAV` và `PCM` (luôn có kích thước RIFF cố định), chưa có fixture `audio/mpeg`.
- **Đề xuất sửa:**
  - Bỏ chặn cứng khi `durationHint` không hữu hạn hoặc timeout — hoặc bỏ hẳn `readDuration()` vì server đã chặn trần byte `MAX_AUDIO = 5 MiB` ([`tts-adapters.js`](../src/voice/tts-adapters.js#L4)) và ngay sau `context.decodeAudioData()` tại [`L49`](../static/voice/audio-stitcher.js#L49) đã có kiểm tra chính xác `buffer.duration > maxSeconds`.
  - Bổ sung case MP3 vào [`tests/voice-v2-browser.mjs`](../tests/voice-v2-browser.mjs).

---

### F-02 (Cao): Trần cứng `MAX_SEGMENTS = 8` trả `413` khiến câu giải thích song ngữ bình thường bị lỗi

- **Vị trí:** [`src/voice/segmenter.js`](../src/voice/segmenter.js#L68), [`src/voice/tts-route.js`](../src/voice/tts-route.js#L148)
- **Nguyên nhân & Kịch bản tái hiện:**
  - Thử một câu trả lời ngữ pháp hoàn toàn bình thường (~45 từ) của Thầy Lâm:
    > *"Trong tiếng Nhật, trợ từ は đánh dấu chủ đề, còn が nhấn mạnh chủ ngữ. Ví dụ 「私は学生です」 và 「誰が来ますか」. Ngoài ra, trợ từ を đi với tân ngữ như 「本を読みます」 nhé!"*
  - Do tách tại từng từ/trợ từ Nhật xen kẽ, câu này tạo ra **11 đoạn** (`vi → ja → vi → ja → vi → ja → vi → ja → vi → ja → vi`), vượt `MAX_SEGMENTS = 8` → trả ngay **`413`** (*"Đoạn cần đọc có quá 8 phần. Hãy chọn đoạn ngắn hơn."*).
  - Người dùng bấm **Nghe** trên tin nhắn Chat của Thầy Lâm sẽ gặp `413` rất thường xuyên.
- **Đề xuất sửa:**
  - Hai tầng kết hợp:
    1. **Client-side batching theo câu/đoạn** trong [`voice-player.js`](../static/voice/voice-player.js): nếu đoạn văn dài có nhiều câu, chia thành từng nhóm câu nhỏ hơn gửi lần lượt vào `AudioStitcher` (giữ trải nghiệm phát liền mạch).
    2. **Server-side coalescing trong [`segmenter.js`](../src/voice/segmenter.js):** thay vì fail cứng ở 8 mảnh cho đoạn ngắn, cho phép tăng giới hạn hợp lý (vd. `MAX_SEGMENTS = 16` khi tổng ký tự nhỏ, hoặc gom các câu ngắn lại) trước khi từ chối `413`.

---

### F-03 (Cao): `AudioBufferSourceNode.playbackRate = 0.9` làm trầm và méo cao độ giọng tiếng Nhật

- **Vị trí:** [`static/voice/audio-stitcher.js`](../static/voice/audio-stitcher.js#L65), [`static/voice/voice-settings.js`](../static/voice/voice-settings.js#L15)
- **Nguyên nhân & Kịch bản tái hiện:**
  - Web Audio `AudioBufferSourceNode.playbackRate` thay đổi tốc độ bằng cách resample trực tiếp, **không giữ cao độ (pitch)**.
  - Vì mặc định `ja.speed = 0.9` còn `vi.speed = 1.0`, mọi đoạn song ngữ (kể cả dùng **cùng 1 cloned voice Thầy Lâm**) đều bị tụt cao độ ~10% (~2 bán cung) mỗi khi chuyển từ tiếng Việt sang tiếng Nhật. Nếu học viên N5 chỉnh `0.7`–`0.75`, giọng bị trầm đục rõ rệt.
- **Đề xuất sửa:**
  - Truyền `speed` gốc (có thuật toán time-stretch giữ cao độ của nhà cung cấp) cho các adapter hỗ trợ:
    - **ElevenLabs:** `voice_settings: { speed }` (clamp theo phạm vi API `0.7–1.2`, phần còn lại nếu vượt mới fallback client).
    - **OpenAI & `openai_compatible`:** truyền `speed` trong body `/audio/speech`.
  - Khi provider đã áp dụng `speed` phía server, trả `speed: 1` (hoặc `playbackRate: 1`) về client để `AudioStitcher` phát ở cao độ gốc.
  - Với provider không có tham số `speed` native (**Mistral / Gemini**), đặt tốc độ mặc định `ja` là `1.0` (tránh tự làm méo giọng ở cấu hình mặc định).

---

### F-04 (Cao): ElevenLabs Adapter gửi `previous_text`/`next_text` và `language_code` không tương thích với `eleven_v3` & model v1

- **Vị trí:** [`src/voice/tts-adapters.js`](../src/voice/tts-adapters.js#L112-L133)
- **Code hiện tại:**
  ```js
  const response = await send(provider, `/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${format}`, signal, {
    text, model_id: model, ...(model === 'eleven_multilingual_v2' ? {} : {language_code: lang}),
    ...(prevText ? {previous_text: prevText} : {}), ...(nextText ? {next_text: nextText} : {})
  });
  ```
- **Nguyên nhân & Kịch bản tái hiện:**
  1. Khi văn bản có mũi tên `→` giữa 2 đoạn cùng ngôn ngữ (vd. `「学校を行きます」→「学校に行きます」`), `tts-route.js` điền `prevText` / `nextText`. Với `eleven_v3`, ElevenLabs `/v1/text-to-speech` chưa hỗ trợ `previous_text`/`next_text` → dễ bị lỗi 400/422 (`tts_voice_unavailable`).
  2. Điều kiện loại trừ `language_code` chỉ chặn `eleven_multilingual_v2`; nếu người dùng chọn model v1 từ danh sách `GET /v1/models` (`eleven_multilingual_v1`, `eleven_monolingual_v1`), gửi `language_code` sẽ bị API từ chối.
- **Đề xuất sửa:**
  - Chỉ gửi `language_code` cho họ model hỗ trợ: `/^eleven_(?:flash|turbo)_v2_5$|^eleven_v[34](?:_|$)/`.
  - Chỉ gửi `previous_text`/`next_text` khi model KHÔNG thuộc họ `eleven_v3*` / `eleven_v4*`.

---

### F-05 (Trung bình): Cache Hit vẫn gọi `prepared()` (tốn mạng `GET /api/ai/profiles` & giải mã key)

- **Vị trí:** [`static/voice/voice-player.js`](../static/voice/voice-player.js#L78-L83)
- **Nguyên nhân:**
  - `window.VJVoiceRouting.prepared(config, controller.signal)` chạy ở dòng 78 **trước** `cache.get(cacheKey, persist)` ở dòng 82.
  - Với người dùng lưu profile trên server, [`prepared()`](../static/voice/voice-settings.js#L159-L165) luôn gọi `GET /api/ai/profiles` lên Worker + D1, khiến **cache hit vẫn tốn 1 vòng mạng và fail nếu rớt mạng**. Với profile local, mỗi cache hit vẫn phải giải mã WebCrypto từ IndexedDB dù không gửi request nào.
- **Đề xuất sửa:**
  - Chuyển `const routing = await window.VJVoiceRouting.prepared(config, controller.signal);` vào nhánh `else` (chỉ chạy khi `hit` là `null`, ngay trước `apiFetch('/api/tts', ...)`). Vì `identity` đã tính trước ở dòng 59 từ fingerprint của `rows`, đổi profile vẫn tự đổi `cacheKey`.

---

### F-06 (Trung bình): Nút Nghe trong tin nhắn Chat dùng sai class CSS và dễ làm mất vùng bôi đen

- **Vị trí:** [`static/app.js`](../static/app.js#L394-L403)
- **Nguyên nhân:**
  1. Nút Nghe trong bong bóng chat được gán `class="chat-audio-btn"` — đây là class của nút **"Nói trực tiếp"** cao `52px` ở thanh nhập liệu ([`refinements.css`](../static/refinements.css#L115)) và bị ép thành ô vuông `44×44px` trên mobile ([`classroom-vfx.css`](../static/classroom-vfx.css#L227)), trong khi stylesheet đã có sẵn `.bubble-tts-btn` ([`notebook.css`](../static/notebook.css#L22)) dành riêng cho nút nghe nhỏ trong `.bubble-speech-card`.
  2. Tooltip hướng dẫn *"Có thể bôi đen một đoạn để chỉ nghe đoạn đó"*, nhưng trên Safari/Firefox, nhấn vào `<button>` kích hoạt `mousedown` làm đổi focus và xóa vùng chọn `window.getSelection()` trước khi `onclick` kịp đọc.
- **Đề xuất sửa:**
  - Đổi sang class riêng (`.bubble-tts-btn` + style nhẹ phù hợp Sakuga/workbench) và thêm `listen.onmousedown = event => event.preventDefault();` để giữ nguyên vùng bôi đen khi click.

---

### F-07 (Trung bình): Trim silence không chừa đệm đầu/đuôi → fade 12ms đè thẳng lên phụ âm

- **Vị trí:** [`static/voice/audio-stitcher.js`](../static/voice/audio-stitcher.js#L52-L70)
- **Nguyên nhân:**
  - Vòng lặp cắt sát ngay sample đầu/cuối đạt ngưỡng `-42 dBFS` (`first`..`last`) mà không chừa đệm (`15ms` đầu / `25ms` đuôi như thiết kế trong [`docs/VOICE_FRAMEWORK.md`](VOICE_FRAMEWORK.md)), sau đó áp `linearRampToValueAtTime` 12ms ngay trên phụ âm bật hơi (`k`, `t`, `p`, `s`, `-t`, `-c`).
- **Đề xuất sửa:**
  ```js
  const lead = Math.round(buffer.sampleRate * 0.015);
  const tail = Math.round(buffer.sampleRate * 0.025);
  first = Math.max(0, first - lead);
  last = Math.min(buffer.length - 1, last + tail);
  ```

---

### F-08 (Trung bình): `SUFFIX['elevenlabs']` là `undefined` và chưa chuẩn hóa `/v1` cho ElevenLabs

- **Vị trí:** [`static/api-profiles.js`](../static/api-profiles.js#L8-L38), [`src/voice/tts-route.js`](../src/voice/tts-route.js#L33)
- **Nguyên nhân:**
  - `SUFFIX` trong `api-profiles.js` không có key `elevenlabs`, nên `url.pathname.replace(/\/+$/, '').replace(SUFFIX[protocol], '')` thực thi `.replace(undefined, '')` (JS ép `undefined` thành chuỗi `'undefined'`).
  - Nếu người dùng dán `https://api.elevenlabs.io/v1` (rất phổ biến vì các provider khác đều có `/v1`), URL không được rút gọn về `https://api.elevenlabs.io` → backend ghép thành `/v1/v1/text-to-speech/...` và `voiceBase()` từ chối `403` do không khớp `VOICE_BASES.elevenlabs`.
- **Đề xuất sửa:**
  - Thêm `elevenlabs: /\/v1$/` vào `SUFFIX` ở `api-profiles.js` (và kiểm tra `SUFFIX[protocol]` trước khi `.replace(...)`).
  - Ở [`src/voice/tts-route.js`](../src/voice/tts-route.js#L33), cắt thêm `/\/v1$/` khi `kind === 'elevenlabs'`.

---

### F-09 (Trung bình): Chế độ mặc định `kanji_native` bỏ qua `reading` cho từ vựng đa âm

- **Vị trí:** [`src/voice/normalizer.js`](../src/voice/normalizer.js#L4-L7)
- **Nguyên nhân:**
  - `const source = kanjiMode === 'kana_first' && kana.test(annotation) ? annotation : text.normalize('NFC');`
  - Với chế độ mặc định `kanji_native`, trường `reading` mà Flashcard / Từ vựng gửi lên (để phân biệt từ đa âm như `一日` `ついたち` vs `いちにち`, `明日` `あした` vs `あす`) bị bỏ qua hoàn toàn — khác với hành vi legacy [`speechReading()`](../static/speech.js#L4-L7), trong khi [`voice-player.js`](../static/voice/voice-player.js#L71) vẫn đưa `reading` vào cache key.
- **Đề xuất sửa:**
  - Khi `mode === 'ja'` và `reading` là chuỗi kana thuần hợp lệ cho một mục từ vựng đơn (không phải câu dài), cân nhắc ưu tiên `reading` ở cả `kanji_native` lẫn `kana_first` (hoặc giữ nguyên hành vi nhưng bỏ `reading` khỏi cache key khi `kanji_native` để không tạo cache trùng).

---

### OPS-01 (Lưu ý vận hành): Cấu hình `VOICE_ALLOWED_ORIGINS` cho Custom TTS URL

- **Vị trí:** [`src/voice/tts-route.js`](../src/voice/tts-route.js#L39-L40), [`docs/API_REFERENCE.md`](API_REFERENCE.md#L94)
- **Hiện trạng:**
  - Mọi URL tùy chỉnh (`openai_compatible` hoặc proxy cho ElevenLabs / Mistral) bắt buộc phải có origin nằm trong biến môi trường `VOICE_ALLOWED_ORIGINS` của Cloudflare Worker (ngăn cách dấu phẩy, ví dụ `https://tts.example.com`). Nếu biến này trống, mọi custom URL đều trả `403 tts_profile_unavailable`.
- **Hành động cần chốt:**
  - **Nếu giữ allowlist (an toàn cao):** Bổ sung hướng dẫn khai báo `VOICE_ALLOWED_ORIGINS` vào [`docs/DEPLOYMENT_CICD.md`](DEPLOYMENT_CICD.md) và thiết lập trên Cloudflare Dashboard trước khi nhóm test custom TTS.
  - **Nếu muốn mọi người dùng tự gắn bất kỳ public HTTPS TTS URL nào (như Chat API):** Chốt lại chính sách với nhóm rồi mở qua `cleanBaseUrl` (vẫn chặn IP/local/private/redirect).

---

## 3. Các điểm tốt cần giữ nguyên từ PR #2 & PR #3

- **Bảo mật & Cách ly tài khoản:** Chặn SSRF (`cleanBaseUrl`, `redirect: 'manual'`, không chấp nhận port/trailing-dot), chặn rò rỉ API key trong catalog/error (`!value.includes(provider.apiKey)`), tách rạch ròi Admin `admin_override` với Learner, ngăn profile voice-only kích hoạt vào Chat (`activateProfile`).
- **Concurrency & Rate-limit:** Giới hạn tối đa 2 request song song cho cùng 1 tài khoản ElevenLabs (phù hợp hạn mức gói Free/Starter), gom nhiều segment vào 1 lượt `/api/tts` NDJSON.
- **Độ toàn vẹn dữ liệu & Test:** Stream NDJSON yêu cầu `{type: 'done', count}` khớp số segment trước khi lưu cache; LRU IndexedDB cập nhật atomic trong 1 transaction; test Chromium thật xác minh sóng âm và audio clock qua reload.

---

## 4. Thứ tự sửa đề xuất (1 PR fix gọn trước Phase 2)

1. **Nhóm Audio & Provider (F-01, F-03, F-04, F-07):** Bỏ chặn cứng `readDuration` trên MP3/iOS, truyền native `speed` cho ElevenLabs/OpenAI/Custom + mặc định `1.0` cho Mistral/Gemini, siết điều kiện `language_code` & `previous_text`/`next_text` của ElevenLabs, thêm padding 15ms/25ms cho silence trim.
2. **Nhóm Segmentation & Cache (F-02, F-05, F-09):** Coalesce/chunk vượt 8 đoạn thay vì fail `413`, dời `prepared()` xuống nhánh cache miss, thống nhất cách dùng `reading`.
3. **Nhóm UI & URL (F-06, F-08, OPS-01):** Sửa class + giữ vùng bôi đen cho nút Nghe tin nhắn chat, thêm `SUFFIX.elevenlabs` (`/v1`), cập nhật `VOICE_ALLOWED_ORIGINS` vào `docs/DEPLOYMENT_CICD.md` + bổ sung test MP3 & >8 segments.
