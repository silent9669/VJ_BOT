/**
 * VJBot (Nihongo Sensei) — CLOUDFLARE WORKER BACKEND
 * D1-backed JLPT curriculum, progress, chat with Gemini 2.5 & Gemini 3.8 TTS.
 */

const DEFAULT_GEMINI_KEY = "";

function calculateSM2(quality, repetitions, previousInterval, easeFactor) {
  let q = Math.max(0, Math.min(5, quality));
  let ef = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  ef = Math.max(1.3, ef);

  let reps = repetitions;
  let interval = previousInterval;

  if (q < 3) {
    reps = 0;
    interval = 1.0;
  } else {
    reps += 1;
    if (reps === 1) {
      interval = 1.0;
    } else if (reps === 2) {
      interval = 6.0;
    } else {
      interval = Math.round(interval * ef);
    }
  }

  const nextReview = new Date(Date.now() + interval * 24 * 60 * 60 * 1000).toISOString();
  return { repetitions: reps, interval, easeFactor: Math.round(ef * 100) / 100, nextReview };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

// 8-bit Pixel VJ Logo SVG Favicon
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges" width="64" height="64">
  <!-- 8-Bit Pixel Art "VJ" Arcade Logo -->
  <!-- Dark Bezel / Base Shadow -->
  <rect x="1" y="2" width="30" height="29" fill="#09090b" rx="2"/>
  <rect x="1" y="1" width="30" height="28" fill="#18181b" rx="2"/>
  <rect x="2" y="2" width="28" height="26" fill="#27272a"/>

  <!-- Golden 8-Bit Corner Accents (Arcade aesthetic) -->
  <rect x="3" y="3" width="2" height="2" fill="#f59e0b"/>
  <rect x="27" y="3" width="2" height="2" fill="#f59e0b"/>
  <rect x="3" y="23" width="2" height="2" fill="#d97706"/>
  <rect x="27" y="23" width="2" height="2" fill="#d97706"/>

  <!-- LETTER 'V' (Red Arcade Pixel Grid) -->
  <!-- Left arm -->
  <rect x="5" y="7" width="3" height="4" fill="#ef4444"/>
  <rect x="5" y="7" width="1" height="4" fill="#fca5a5"/>
  <rect x="6" y="11" width="3" height="4" fill="#ef4444"/>
  <rect x="6" y="11" width="1" height="4" fill="#fca5a5"/>
  <rect x="7" y="15" width="3" height="3" fill="#dc2626"/>
  <rect x="8" y="18" width="3" height="3" fill="#b91c1c"/>
  
  <!-- Center bottom tip -->
  <rect x="9" y="20" width="3" height="2" fill="#991b1b"/>
  
  <!-- Right arm -->
  <rect x="10" y="18" width="3" height="3" fill="#b91c1c"/>
  <rect x="11" y="15" width="3" height="3" fill="#dc2626"/>
  <rect x="12" y="11" width="3" height="4" fill="#ef4444"/>
  <rect x="13" y="7" width="3" height="4" fill="#ef4444"/>
  <rect x="15" y="7" width="1" height="4" fill="#f87171"/>

  <!-- LETTER 'J' (Cyan/Aqua Arcade Pixel Grid) -->
  <!-- Top bar -->
  <rect x="18" y="7" width="9" height="3" fill="#06b6d4"/>
  <rect x="18" y="7" width="9" height="1" fill="#a5f3fc"/>
  <rect x="18" y="9" width="9" height="1" fill="#0891b2"/>
  
  <!-- Vertical stem -->
  <rect x="22" y="10" width="3" height="8" fill="#06b6d4"/>
  <rect x="24" y="10" width="1" height="8" fill="#22d3ee"/>
  <rect x="22" y="10" width="1" height="8" fill="#0891b2"/>
  
  <!-- Curve hook -->
  <rect x="21" y="17" width="3" height="3" fill="#0891b2"/>
  <rect x="18" y="19" width="4" height="3" fill="#0891b2"/>
  <rect x="16" y="18" width="3" height="3" fill="#06b6d4"/>
  <rect x="16" y="15" width="3" height="4" fill="#06b6d4"/>
  <rect x="16" y="15" width="1" height="4" fill="#67e8f9"/>

  <!-- Sub-pixel CRT scanlines -->
  <rect x="3" y="5" width="26" height="1" fill="#ffffff" opacity="0.08"/>
  <rect x="3" y="9" width="26" height="1" fill="#000000" opacity="0.15"/>
  <rect x="3" y="13" width="26" height="1" fill="#ffffff" opacity="0.08"/>
  <rect x="3" y="17" width="26" height="1" fill="#000000" opacity="0.15"/>
  <rect x="3" y="21" width="26" height="1" fill="#ffffff" opacity="0.08"/>
</svg>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    try {
      // Favicon handler (prevent 500/404)
      if (url.pathname === "/favicon.ico") {
        return new Response(FAVICON_SVG, {
          headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=86400"
          }
        });
      }

      // 1. Health check
      if (url.pathname === "/api/health") {
        const { results } = await env.DB.prepare("SELECT count(*) as count FROM curriculum_items").all();
        return jsonResponse({
          status: "ok",
          app: "vjbot",
          edge: true,
          d1_items: results[0]?.count || 0
        });
      }

      // 2. Profile API
      if (url.pathname === "/api/profile") {
        if (request.method === "GET") {
          const userId = url.searchParams.get("user_id");
          if (!userId) return jsonResponse({ detail: "user_id required" }, 400);

          let row = await env.DB.prepare("SELECT user_id, level, track, updated_at FROM profiles WHERE user_id = ?").bind(userId).first();
          if (!row) {
            // Auto-provision initial profile for new learner (no 404)
            const now = new Date().toISOString();
            await env.DB.prepare(`
              INSERT INTO profiles (user_id, level, track, updated_at)
              VALUES (?, 'N5', 'minna', ?)
            `).bind(userId, now).run();
            row = { user_id: userId, level: "N5", track: "minna", updated_at: now };
          }
          return jsonResponse(row);
        }

        if (request.method === "POST") {
          const body = await request.json();
          const userId = body.user_id;
          const level = body.level || "N5";
          const track = body.track || (level === "beginner" ? "kana" : "minna");
          if (!userId) return jsonResponse({ detail: "user_id required" }, 400);

          const now = new Date().toISOString();
          await env.DB.prepare(`
            INSERT INTO profiles (user_id, level, track, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET level = excluded.level, track = excluded.track, updated_at = excluded.updated_at
          `).bind(userId, level, track, now).run();

          return jsonResponse({ user_id: userId, level, track, updated_at: now });
        }
      }

      // 3. Curriculum API
      if (url.pathname === "/api/curriculum") {
        const level = url.searchParams.get("level");
        let query = "SELECT item_id as id, lesson_id, book, level, lesson, section, item_type, order_num, display, reading, meaning_vi, meaning_en, source_url FROM curriculum_items";
        const params = [];
        if (level) {
          query += " WHERE level = ?";
          params.push(level);
        }
        query += " ORDER BY level, order_num ASC";
        const { results } = await env.DB.prepare(query).bind(...params).all();
        return jsonResponse(results);
      }

      // 4. Next Topic API
      if (url.pathname === "/api/next-topic") {
        const userId = url.searchParams.get("user_id");
        if (!userId) return jsonResponse({ detail: "user_id required" }, 400);

        const profile = await env.DB.prepare("SELECT level, track FROM profiles WHERE user_id = ?").bind(userId).first();
        const level = profile ? profile.level : "N5";

        // Prioritize due SRS items
        const dueItem = await env.DB.prepare(`
          SELECT c.item_id as id, c.lesson_id, c.book, c.level, c.lesson, c.section, c.item_type, c.display, c.reading, c.meaning_vi, c.meaning_en, c.source_url
          FROM progress p
          JOIN curriculum_items c ON p.item_id = c.item_id
          WHERE p.user_id = ? AND c.level = ? AND p.next_review <= ?
          ORDER BY p.next_review ASC
          LIMIT 1
        `).bind(userId, level, new Date().toISOString()).first();

        if (dueItem) {
          return jsonResponse({
            ...dueItem,
            topic: dueItem.display,
            reason: `Đã đến hạn ôn tập ngắt quãng (SRS) để ghi nhớ sâu chủ đề [${dueItem.display}].`
          });
        }

        // Otherwise pick next unstudied item in curriculum
        const nextItem = await env.DB.prepare(`
          SELECT c.item_id as id, c.lesson_id, c.book, c.level, c.lesson, c.section, c.item_type, c.display, c.reading, c.meaning_vi, c.meaning_en, c.source_url
          FROM curriculum_items c
          LEFT JOIN progress p ON c.item_id = p.item_id AND p.user_id = ?
          WHERE c.level = ?
          ORDER BY p.correct ASC, c.order_num ASC
          LIMIT 1
        `).bind(userId, level).first();

        if (nextItem) {
          return jsonResponse({
            ...nextItem,
            topic: nextItem.display,
            reason: `Chủ đề trọng tâm cấp độ ${level} để nâng cao phản xạ tiếng Nhật của bạn.`
          });
        }

        return jsonResponse({
          id: "N5-001",
          level: "N5",
          display: "〜は〜です",
          meaning_vi: "Khẳng định: A là B",
          meaning_en: "A is B (topic and state of being)",
          reason: "Chủ đề khởi đầu cơ bản nhất cho người học tiếng Nhật."
        });
      }

      // 5. Progress API
      if (url.pathname === "/api/progress") {
        const userId = url.searchParams.get("user_id");
        if (!userId) return jsonResponse({ detail: "user_id required" }, 400);

        const rows = await env.DB.prepare(`
          SELECT p.item_id, p.item_type, p.jlpt_level, p.correct, p.incorrect, p.last_reviewed, p.next_review, p.interval_days, p.ease_factor, c.display, c.meaning_vi, c.meaning_en
          FROM progress p
          LEFT JOIN curriculum_items c ON p.item_id = c.item_id
          WHERE p.user_id = ?
          ORDER BY p.last_reviewed DESC
        `).bind(userId).all();

        const items = rows.results || [];
        let totalCorrect = 0;
        let totalIncorrect = 0;
        const weakItems = [];

        items.forEach(it => {
          totalCorrect += it.correct || 0;
          totalIncorrect += it.incorrect || 0;
          if ((it.incorrect || 0) > (it.correct || 0)) {
            weakItems.push(it.display || it.item_id);
          }
        });

        const total = totalCorrect + totalIncorrect;
        const accuracy = total > 0 ? Math.round((totalCorrect / total) * 100) : 100;

        return jsonResponse({
          total_learned: items.length,
          total_correct: totalCorrect,
          total_incorrect: totalIncorrect,
          accuracy_rate: accuracy,
          weak_items: weakItems,
          streak_days: 3,
          items: items.map(r => ({
            item_id: r.item_id,
            display: r.display || r.item_id,
            meaning: r.meaning_vi || r.meaning_en || "",
            jlpt_level: r.jlpt_level,
            correct: r.correct,
            incorrect: r.incorrect,
            interval_days: r.interval_days,
            ease_factor: r.ease_factor,
            last_reviewed: r.last_reviewed,
            next_review: r.next_review
          }))
        });
      }

      // 6. Record Answer Progress API
      if (url.pathname === "/api/progress/record" && request.method === "POST") {
        const body = await request.json();
        const { user_id, item_id, correct, quality = 4 } = body;
        if (!user_id || !item_id) return jsonResponse({ detail: "user_id and item_id required" }, 400);

        const item = await env.DB.prepare("SELECT item_type, level FROM curriculum_items WHERE item_id = ?").bind(item_id).first();
        const itemType = item ? item.item_type : "grammar";
        const level = item ? item.level : "N5";

        const existing = await env.DB.prepare("SELECT correct, incorrect, interval_days, ease_factor FROM progress WHERE user_id = ? AND item_id = ?").bind(user_id, item_id).first();

        const curCorrect = existing ? existing.correct : 0;
        const curIncorrect = existing ? existing.incorrect : 0;
        const curInterval = existing ? existing.interval_days : 1.0;
        const curEf = existing ? existing.ease_factor : 2.5;

        const q = correct ? Math.max(3, quality) : Math.min(2, quality);
        const sm2 = calculateSM2(q, curCorrect, curInterval, curEf);
        const now = new Date().toISOString();

        await env.DB.prepare(`
          INSERT INTO progress (user_id, item_id, item_type, jlpt_level, correct, incorrect, last_reviewed, next_review, interval_days, ease_factor)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, item_id) DO UPDATE SET
            correct = progress.correct + excluded.correct,
            incorrect = progress.incorrect + excluded.incorrect,
            last_reviewed = excluded.last_reviewed,
            next_review = excluded.next_review,
            interval_days = excluded.interval_days,
            ease_factor = excluded.ease_factor
        `).bind(user_id, item_id, itemType, level, correct ? 1 : 0, correct ? 0 : 1, now, sm2.nextReview, sm2.interval, sm2.easeFactor).run();

        return jsonResponse({ status: "recorded", next_review: sm2.nextReview, interval_days: sm2.interval });
      }

      // 7. Chat History API
      if (url.pathname === "/api/history") {
        const userId = url.searchParams.get("user_id");
        if (!userId) return jsonResponse({ detail: "user_id required" }, 400);

        const rows = await env.DB.prepare("SELECT role, content, timestamp FROM conversations WHERE user_id = ? ORDER BY id ASC LIMIT 50").bind(userId).all();
        return jsonResponse(rows.results || []);
      }

      // 8. TTS API (Gemini Flash TTS)
      if (url.pathname === "/api/tts" && request.method === "POST") {
        const body = await request.json();
        const text = (body.text || "").trim();
        const voice = body.voice || "Aoede";
        if (!text) return jsonResponse({ detail: "text required" }, 400);

        const apiKey = env.GEMINI_API_KEY || DEFAULT_GEMINI_KEY;
        const ttsUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        try {
          const ttsResp = await fetch(ttsUrl, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text }] }],
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: voice
                    }
                  }
                }
              }
            })
          });

          if (ttsResp.ok) {
            const ttsData = await ttsResp.json();
            const part = ttsData.candidates?.[0]?.content?.parts?.[0];
            const audioBase64 = part?.inlineData?.data;
            const mimeType = part?.inlineData?.mimeType || "audio/wav";
            if (audioBase64) {
              return jsonResponse({ mimeType, audioBase64, voice });
            }
          }
          return jsonResponse({ fallback: true, voice, text }, 200);
        } catch {
          return jsonResponse({ fallback: true, voice, text }, 200);
        }
      }

      // 9. Kaiwa Speaking Lab Evaluation API
      if (url.pathname === "/api/kaiwa/evaluate" && request.method === "POST") {
        const body = await request.json();
        const { prompt_jp, user_speech, scenario_title, level = "N5" } = body;
        const cleanSpeech = (user_speech || "").trim();

        if (!cleanSpeech) {
          return jsonResponse({
            score: 0,
            rating: "Chưa nói",
            feedback: "Sensei chưa nghe rõ câu trả lời của bạn. Hãy nhấn Micro và nói thử nhé!",
            model_answer: prompt_jp || "はい、わかりました。"
          });
        }

        const apiKey = env.GEMINI_API_KEY || DEFAULT_GEMINI_KEY;
        let aiEval = null;

        try {
          const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;
          const promptPayload = {
            contents: [{
              role: "user",
              parts: [{
                text: "Bạn là Nihongo Sensei (giáo viên tiếng Nhật chuyên nghiệp). Hãy đánh giá câu trả lời Kaiwa sau của học viên JLPT " + level + ":\nTình huống: " + (scenario_title || "Giao tiếp") + "\nCâu hỏi của Sensei: " + prompt_jp + "\nCâu học viên nói: " + cleanSpeech + "\n\nTrả về ĐÚNG JSON thuần (không markdown codeblock) format: {\"score\": <30-100>, \"rating\": \"<Xuất sắc|Rất tốt|Tốt|Cần luyện thêm>\", \"feedback\": \"<1-2 câu nhận xét tiếng Việt thân thiện>\", \"model_answer\": \"<câu trả lời tự nhiên nhất kèm romaji/furigana>\"}"
              }]
            }]
          };

          const gResp = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(promptPayload)
          });

          if (gResp.ok) {
            const gData = await gResp.json();
            const textPart = gData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textPart) {
              const cleaned = textPart.trim().replace(/^\`\`\`json/i, "").replace(/\`\`\`$/i, "").trim();
              aiEval = JSON.parse(cleaned);
            }
          }
        } catch (e) {
          console.warn("Gemini Kaiwa evaluate failed:", e);
        }

        if (aiEval && typeof aiEval.score === "number") {
          return jsonResponse({
            score: aiEval.score,
            rating: aiEval.rating || (aiEval.score >= 85 ? "Xuất sắc" : "Tốt"),
            feedback: aiEval.feedback,
            model_answer: aiEval.model_answer,
            user_text: cleanSpeech,
            scenario: scenario_title
          });
        }

        // Rule-based fallback
        let score = 80;
        let rating = "Tốt";
        let feedback = "Phản xạ giao tiếp tự nhiên! Cấu trúc câu diễn đạt rõ ý.";
        if (cleanSpeech.includes("です") || cleanSpeech.includes("ます") || cleanSpeech.includes("ください")) {
          score += 15;
          rating = "Xuất sắc";
        }
        if (cleanSpeech.length < 3) {
          score = Math.max(50, score - 20);
          rating = "Cần luyện thêm";
          feedback = "Câu hơi ngắn! Hãy thử mở rộng câu đầy đủ vị ngữ và trợ từ nhé.";
        }

        return jsonResponse({
          score: Math.min(100, score),
          rating,
          feedback,
          model_answer: "「" + cleanSpeech + "」hoặc tự nhiên hơn:「はい、かしこまりました。」",
          user_text: cleanSpeech,
          scenario: scenario_title
        });
      }

      // 10. Chat Greeting API
      if (url.pathname === "/api/chat/greeting") {
        const userId = url.searchParams.get("user_id");
        if (!userId) return jsonResponse({ detail: "user_id required" }, 400);

        const profile = await env.DB.prepare("SELECT level FROM profiles WHERE user_id = ?").bind(userId).first();
        const level = profile ? profile.level : "N5";

        const greetingText = `こんにちは！Sensei chào bạn!\n\nHôm nay chúng ta cùng luyện tập phản xạ tiếng Nhật trình độ [${level}] nhé! Bạn đã sẵn sàng luyện tập cùng Sensei chưa nào? Hãy thử trả lời:「あなたのお名前は何ですか。」(Tên của bạn là gì?)`;

        await env.DB.prepare("INSERT INTO conversations (user_id, role, content, timestamp) VALUES (?, 'bot', ?, ?)")
          .bind(userId, greetingText, new Date().toISOString()).run();

        return jsonResponse({
          reply: greetingText,
          response: greetingText,
          updated_topic: {
            id: "N5-001",
            level,
            display: "〜は〜です",
            meaning_en: "A là B (khẳng định cơ bản)"
          }
        });
      }

      // 11. Chat API (Gemini 2.5 Flash + Intelligent Pedagogical Fallback)
      if (url.pathname === "/api/chat" && request.method === "POST") {
        const body = await request.json();
        const userId = body.user_id;
        const message = (body.message || "").trim();

        if (!userId) return jsonResponse({ detail: "user_id required" }, 400);

        const profile = await env.DB.prepare("SELECT level FROM profiles WHERE user_id = ?").bind(userId).first();
        const level = profile ? profile.level : "N5";

        // Greeting request
        if (body.type === "greeting" || message === "") {
          const greetingText = `こんにちは！Sensei rất vui được đồng hành cùng bạn trên hành trình chinh phục tiếng Nhật trình độ [${level}]. Hôm nay chúng mình cùng bắt đầu luyện phản xạ với cấu trúc câu đơn giản nhé! Bạn hãy thử giới thiệu tên của mình bằng mẫu câu「〜は〜です」nhé! (Ví dụ: 私はフックです)`;
          
          await env.DB.prepare("INSERT INTO conversations (user_id, role, content, timestamp) VALUES (?, 'bot', ?, ?)")
            .bind(userId, greetingText, new Date().toISOString()).run();

          return jsonResponse({
            reply: greetingText,
            response: greetingText,
            updated_topic: {
              id: "N5-001",
              level,
              display: "〜は〜です",
              meaning_en: "A là B (khẳng định cơ bản)"
            }
          });
        }

        // Save user message
        const now = new Date().toISOString();
        await env.DB.prepare("INSERT INTO conversations (user_id, role, content, timestamp) VALUES (?, 'user', ?, ?)")
          .bind(userId, message, now).run();

        // 11a. Call Gemini 2.5 Flash
        let botResponse = "";
        const apiKey = env.GEMINI_API_KEY || DEFAULT_GEMINI_KEY;

        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
          const promptPayload = {
            contents: [
              {
                role: "user",
                parts: [{
                  text: `Bạn là VJBot - Nihongo Sensei (giáo viên tiếng Nhật nhiệt tình, chuẩn mực).
Trình độ học viên hiện tại: JLPT ${level}.
Tin nhắn của học viên: "${message}"

Hướng dẫn trả lời:
1. Nhận xét trực tiếp câu trả lời / câu hỏi của học viên bằng tiếng Việt thân thiện, rõ ràng.
2. Nếu học viên trả lời tiếng Nhật, chỉ rõ chỗ đúng hoặc sửa lỗi trợ từ / đuôi câu nếu có.
3. Cung cấp câu mẫu tiếng Nhật tự nhiên kèm cách đọc Romaji hoặc Furigana.
4. Đặt tiếp 1 câu hỏi tương tác ngắn để học viên tiếp tục luyện phản xạ.
5. Giữ độ dài vừa phải (khoảng 3-5 câu), không dùng tiêu đề markdown rườm rà.`
                }]
              }
            ]
          };

          const geminiResp = await fetch(geminiUrl, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify(promptPayload)
          });

          if (geminiResp.ok) {
            const geminiData = await geminiResp.json();
            const textPart = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textPart && textPart.trim()) {
              botResponse = textPart.trim();
            }
          }
        } catch (e) {
          console.warn("Gemini chat error:", e);
        }

        // 11b. Intelligent Pedagogical Fallback
        if (!botResponse) {
          const lower = message.toLowerCase();
          if (lower.includes("xin gợi ý") || lower.includes("gợi ý") || lower.includes("hint")) {
            botResponse = "💡 Gợi ý của Sensei nè: Hãy dùng cấu trúc【Chủ ngữ + は + Thông tin + です】nhé! Ví dụ nếu muốn nói 'Tôi là sinh viên':「私は学生です (Watashi wa gakusei desu)」. Thử gõ câu hoàn chỉnh xem nào!";
          } else if (lower.includes("giải thích") || lower.includes("ngữ pháp") || lower.includes("explain")) {
            botResponse = "📖 Giải thích ngữ pháp:\nTrợ từ「は」(đọc là wa khi làm trợ từ) đứng sau danh từ để đánh dấu chủ đề của câu.「です」đặt ở cuối câu để biểu thị sự lịch sự và khẳng định (tương đương 'thì/là' trong tiếng Việt). Hãy nhớ đọc to câu khi luyện tập nhé!";
          } else if (lower.includes("dịch") || lower.includes("translate")) {
            botResponse = "🌐 Dịch câu:\n「私は学生です」nghĩa là: 'Tôi là học sinh / sinh viên'. Bạn hãy thử tự nói một câu tương tự về nghề nghiệp hoặc quốc tịch của mình xem sao nhé!";
          } else if (lower.includes("tiếp theo") || lower.includes("câu tiếp") || lower.includes("next")) {
            botResponse = "Tuyệt vời! Tiếp theo, chúng mình chuyển sang câu hỏi nghi vấn nhé! Trong tiếng Nhật, để hỏi chỉ cần thêm「か」ở cuối câu. Bạn hãy thử hỏi Sensei: 'Sensei là người Nhật phải không?' xem nào!";
          } else if (message.includes("です") || message.includes("ですか") || message.includes("は")) {
            botResponse = "すばらしい！(Tuyệt vời lắm!) 🎉 Bạn đã sử dụng trợ từ và kết thúc câu rất chính xác. Cấu trúc câu tự nhiên và đúng ngữ pháp. Bây giờ, bạn hãy thử trả lời câu hỏi sau của Sensei nhé:「あなたは何才ですか。」(Bạn bao nhiêu tuổi?)";
          } else {
            botResponse = "Sensei đã nhận được câu trả lời của bạn:「" + message + "」. Để câu văn tự nhiên và đúng chuẩn tiếng Nhật hơn, hãy nhớ kết thúc câu bằng「です」hoặc trợ từ phù hợp nhé! Bạn có muốn thử lại hay cần Sensei gợi ý không?";
          }
        }

        // Record progress if positive practice
        if (message.includes("です") || message.includes("ます") || message.length > 3) {
          try {
            await env.DB.prepare(`
              INSERT INTO progress (user_id, item_id, item_type, jlpt_level, correct, incorrect, last_reviewed, next_review, interval_days, ease_factor)
              VALUES (?, 'N5-001', 'grammar', ?, 1, 0, ?, ?, 1.0, 2.5)
              ON CONFLICT(user_id, item_id) DO UPDATE SET
                correct = progress.correct + 1,
                last_reviewed = excluded.last_reviewed
            `).bind(userId, level, now, new Date(Date.now() + 86400000).toISOString()).run();
          } catch {
            // ignore progress update failure
          }
        }

        // Save bot reply
        await env.DB.prepare("INSERT INTO conversations (user_id, role, content, timestamp) VALUES (?, 'bot', ?, ?)")
          .bind(userId, botResponse, new Date().toISOString()).run();

        return jsonResponse({
          reply: botResponse,
          response: botResponse,
          updated_topic: {
            id: "N5-001",
            level,
            display: "〜は〜です",
            meaning_en: "A là B (khẳng định cơ bản)"
          }
        });
      }

    } catch (err) {
      return jsonResponse({ error: err.message, stack: err.stack }, 500);
    }

    // Default: static asset fallback
    return env.ASSETS.fetch(request);
  }
};
