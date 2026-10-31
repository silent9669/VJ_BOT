import { examRoute } from './exams.js';
import { authRoute, sessionUser } from './auth.js';
/**
 * VJBot (Nihongo Sensei) — CLOUDFLARE WORKER BACKEND
 * D1-backed JLPT curriculum, progress, chat with Gemini 3.5 & Gemini Flash TTS.
 */

// Configure GEMINI_API_KEY with `wrangler secret put GEMINI_API_KEY`.
// AI requests fail explicitly when the provider is unavailable.
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
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
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

    if (request.method !== "GET" && request.method !== "HEAD" && request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) {
      return jsonResponse({detail: "Origin not allowed"}, 403);
    }
    if (request.method === "OPTIONS") return new Response(null, {status:204});
    try {
      if (url.pathname.startsWith('/api/auth/')) return await authRoute(request,env);
      const privateRoutes = ['/api/exam-attempts','/api/completions','/api/profile','/api/progress','/api/progress/record','/api/next-topic','/api/history','/api/chat','/api/chat/greeting','/api/tts','/api/kaiwa/evaluate','/api/account/delete'];
      if(privateRoutes.includes(url.pathname)) {
        const user = await sessionUser(request,env);
        if(!user) return jsonResponse({detail:'Đăng nhập Google để dùng Sensei và đồng bộ tiến độ.'},401);
        url.searchParams.set('user_id',user.user_id);
        if(['POST','PUT','PATCH'].includes(request.method)) {
          const raw=await request.text();
          if(raw.length>20000) return jsonResponse({detail:'Nội dung quá dài.'},413);
          let body;
          try { body=JSON.parse(raw || '{}'); } catch { return jsonResponse({detail:'Invalid JSON'},400); }
          if(!body || Array.isArray(body) || typeof body!=='object') return jsonResponse({detail:'Invalid body'},400);
          body.user_id=user.user_id;
          delete body.api_key;
          if(body.level && !['N5','N4','N3','N2','N1'].includes(body.level)) return jsonResponse({detail:'Invalid level'},400);
          for(const field of ['message','text','user_speech','prompt_jp','context','scenario_title']) {
            if(body[field] !== undefined && (typeof body[field]!=='string' || body[field].length>6000)) return jsonResponse({detail:'Invalid '+field},400);
          }
          request=new Request(request.url,{method:request.method,headers:request.headers,body:JSON.stringify(body)});
        }
        if(['/api/chat','/api/tts','/api/kaiwa/evaluate'].includes(url.pathname) && request.method==='POST') {
          const bucket=Math.floor(Date.now()/60000);
          const usage=await env.DB.prepare('INSERT INTO ai_usage(user_id,bucket,count) VALUES(?,?,1) ON CONFLICT(user_id,bucket) DO UPDATE SET count=count+1 RETURNING count').bind(user.user_id,bucket).first();
          if(usage.count>20) return jsonResponse({detail:'Bạn hãy đợi một phút rồi thử lại.'},429);
          await env.DB.prepare('DELETE FROM ai_usage WHERE bucket < ?').bind(bucket-60).run();
        }
      }
      if(url.pathname==='/api/exam-attempts')return await examRoute(request,url,env,url.searchParams.get('user_id'));
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
      if (url.pathname === '/api/account/delete' && request.method === 'POST') {
        const userId=url.searchParams.get('user_id');
        await env.DB.batch(['exam_attempts','completions','progress_attempts','progress','profiles','conversations','study_days','ai_usage','sessions'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(userId)));
        return jsonResponse({success:true});
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
          SELECT p.item_id, p.item_type, p.jlpt_level, p.correct, p.incorrect, p.last_reviewed, p.next_review, p.interval_days, p.ease_factor, p.last_correct, p.response_text, COALESCE(c.display, p.display, p.item_id) AS display, c.meaning_vi, c.meaning_en
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
        const accuracy = total > 0 ? Math.round((totalCorrect / total) * 100) : 0;
        const days=await env.DB.prepare('SELECT day FROM study_days WHERE user_id = ? ORDER BY day DESC LIMIT 400').bind(userId).all();
        const dates=new Set(days.results.map(d=>d.day));let streak=0;const date=new Date();
        if(!dates.has(date.toISOString().slice(0,10))) date.setUTCDate(date.getUTCDate()-1);
        while(dates.has(date.toISOString().slice(0,10))){streak++;date.setUTCDate(date.getUTCDate()-1);}

        return jsonResponse({
          total_learned: items.length,
          total_correct: totalCorrect,
          total_incorrect: totalIncorrect,
          accuracy_rate: accuracy,
          weak_items: items.filter(i=>(i.incorrect||0)>(i.correct||0)),
          streak_days: streak,
          items: items.map(r => ({
            item_id: r.item_id,
            display: r.display || r.item_id,
            meaning: r.meaning_vi || r.meaning_en || "",
            jlpt_level: r.jlpt_level,
            correct: r.correct,
            incorrect: r.incorrect,
            interval_days: r.interval_days,
            ease_factor: r.ease_factor,
            last_correct: r.last_correct,
            response_text: r.response_text,
            last_reviewed: r.last_reviewed,
            next_review: r.next_review
          }))
        });
      }

      if (url.pathname === '/api/completions') {
        const owner=url.searchParams.get('user_id');
        if(request.method==='GET') {
          const rows=await env.DB.prepare('SELECT activity_id,kind,level,title,completed_at FROM completions WHERE user_id=? ORDER BY completed_at DESC').bind(owner).all();
          return jsonResponse({items:rows.results});
        }
        if(request.method!=='POST')return jsonResponse({detail:'Method not allowed'},405);
        const body=await request.json();
        if(typeof body.activity_id!=='string' || !body.activity_id.trim() || body.activity_id.length>300 || /[<>\u0000-\u001f]/.test(body.activity_id) || typeof body.completed!=='boolean' || !['lesson','kaiwa','test','roadmap','chat'].includes(body.kind) || !['N5','N4','N3','N2','N1'].includes(body.level) || typeof body.title!=='string' || !body.title.trim() || body.title.length>500)return jsonResponse({detail:'Invalid completion'},400);
        if(body.completed)await env.DB.prepare('INSERT INTO completions(user_id,activity_id,kind,level,title,completed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,activity_id) DO UPDATE SET completed_at=excluded.completed_at,title=excluded.title').bind(owner,body.activity_id,body.kind,body.level,body.title.trim(),new Date().toISOString()).run();
        else await env.DB.prepare('DELETE FROM completions WHERE user_id=? AND activity_id=?').bind(owner,body.activity_id).run();
        return jsonResponse({completed:body.completed});
      }

      // 6. Record Answer Progress API
      if (url.pathname === "/api/progress/record" && request.method === "POST") {
        const body = await request.json();
        const { user_id, item_id, correct, quality = 4 } = body;
        if (!user_id || typeof item_id!=='string' || !item_id.trim() || item_id.length>300 || typeof correct!=='boolean' || !Number.isInteger(quality) || quality<0 || quality>5) return jsonResponse({ detail: "Invalid progress record" }, 400);

        if (body.display !== undefined && (typeof body.display !== 'string' || body.display.length > 2000)) return jsonResponse({detail: 'Invalid display'}, 400);
        if (body.item_type !== undefined && !['grammar','vocabulary','kanji','kana','reading','listening','exam','production'].includes(body.item_type)) return jsonResponse({detail: 'Invalid item type'}, 400);

        if(body.response_text !== undefined && (typeof body.response_text !== 'string' || body.response_text.length>4000))return jsonResponse({detail:'Invalid response text'},400);
        const attemptId = body.attempt_id;
        if(attemptId !== undefined && (typeof attemptId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(attemptId))) return jsonResponse({detail:'Invalid attempt'},400);
        if(attemptId){
          const saved=await env.DB.prepare('SELECT result FROM progress_attempts WHERE user_id=? AND attempt_id=?').bind(user_id,attemptId).first();
          if(saved)return jsonResponse(JSON.parse(saved.result));
        }
        const item = await env.DB.prepare("SELECT item_type, level FROM curriculum_items WHERE item_id = ?").bind(item_id).first();
        const itemType = item ? item.item_type : (body.item_type || "grammar");
        const level = item ? item.level : (body.level || "N5");

        const existing = await env.DB.prepare("SELECT correct, incorrect, interval_days, ease_factor, repetitions FROM progress WHERE user_id = ? AND item_id = ?").bind(user_id, item_id).first();

        const curCorrect = existing ? existing.correct : 0;
        const curIncorrect = existing ? existing.incorrect : 0;
        const curInterval = existing ? existing.interval_days : 1.0;
        const curEf = existing ? existing.ease_factor : 2.5;

        const q = correct ? Math.max(3, quality) : Math.min(2, quality);
        const sm2 = calculateSM2(q, existing?.repetitions || 0, curInterval, curEf);
        const now = new Date().toISOString();

        const result={status: "recorded", next_review: sm2.nextReview, interval_days: sm2.interval};
        const writeProgress=env.DB.prepare(`
          INSERT INTO progress (user_id, item_id, item_type, jlpt_level, correct, incorrect, last_reviewed, next_review, interval_days, ease_factor, repetitions, display, last_correct, response_text)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM progress_attempts WHERE user_id=? AND attempt_id=?)
          ON CONFLICT(user_id, item_id) DO UPDATE SET
            correct = progress.correct + excluded.correct,
            incorrect = progress.incorrect + excluded.incorrect,
            last_reviewed = excluded.last_reviewed,
            next_review = excluded.next_review,
            interval_days = excluded.interval_days,
            ease_factor = excluded.ease_factor,
            repetitions = excluded.repetitions,
            display = COALESCE(excluded.display, progress.display),
            last_correct = excluded.last_correct,
            response_text = COALESCE(excluded.response_text, progress.response_text)
        `).bind(user_id, item_id, itemType, level, correct ? 1 : 0, correct ? 0 : 1, now, sm2.nextReview, sm2.interval, sm2.easeFactor, sm2.repetitions, body.display?.trim() || null,correct?1:0,body.response_text?.trim() || null,user_id,attemptId || '');
        const writes=[writeProgress,env.DB.prepare("INSERT OR IGNORE INTO study_days(user_id,day) VALUES(?,?)").bind(user_id,now.slice(0,10))];
        if(attemptId)writes.push(env.DB.prepare('INSERT OR IGNORE INTO progress_attempts(user_id,attempt_id,result) VALUES(?,?,?)').bind(user_id,attemptId,JSON.stringify(result)));
        await env.DB.batch(writes);
        if(attemptId){const saved=await env.DB.prepare('SELECT result FROM progress_attempts WHERE user_id=? AND attempt_id=?').bind(user_id,attemptId).first();return jsonResponse(JSON.parse(saved.result));}
        return jsonResponse(result);
      }

      // 7. Chat History API
      if (url.pathname === "/api/history") {
        const userId = url.searchParams.get("user_id");
        if (!userId) return jsonResponse({ detail: "user_id required" }, 400);

        if (request.method === "DELETE") {
          await env.DB.prepare("DELETE FROM conversations WHERE user_id = ?").bind(userId).run();
          return jsonResponse({ success: true, message: "Chat history cleared" });
        }

        const rows = await env.DB.prepare("SELECT role, content, timestamp FROM (SELECT id, role, content, timestamp FROM conversations WHERE user_id = ? ORDER BY id DESC LIMIT 50) ORDER BY id ASC").bind(userId).all();
        return jsonResponse(rows.results || []);
      }

      // 8. TTS API (Gemini Flash TTS)
      if (url.pathname === "/api/tts" && request.method === "POST") {
        const body = await request.json();
        const text = (body.text || "").trim();
        const voice = "Charon";
        if (!text) return jsonResponse({ detail: "text required" }, 400);

        const apiKey = env.GEMINI_API_KEY || DEFAULT_GEMINI_KEY;
        const ttsUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent";

        try {
          const ttsResp = await fetch(ttsUrl, {
            signal: AbortSignal.timeout(45000),
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
              contents: [{ role:"user", parts: [{ text: "Read aloud clearly in Japanese. Read only the following text: " + text }] }],
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

          if (!ttsResp.ok) {
            const error=await ttsResp.json().catch(()=>({}));
            console.warn("TTS provider status",ttsResp.status,String(error.error?.message||'').replaceAll(apiKey || 'unconfigured','[redacted]').slice(0,250));
          }
          if (ttsResp.ok) {
            const ttsData = await ttsResp.json();
            const part = ttsData.candidates?.[0]?.content?.parts?.find(p=>p.inlineData?.data);
            const audioBase64 = part?.inlineData?.data;
            const mimeType = part?.inlineData?.mimeType || "audio/wav";
            if (audioBase64) {
              return jsonResponse({ mimeType, audioBase64, voice });
            }
          }
          return jsonResponse({ fallback: true, voice, text }, 200);
        } catch (error) {
          console.warn("TTS provider error",error.name);
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
          const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";
          const promptPayload = {
            contents: [{
              role: "user",
              parts: [{
                text: "Bạn là thầy Lâm, giáo viên tiếng Nhật. Chỉ đánh giá nội dung bản chép lời, không suy đoán phát âm hoặc ngữ điệu từ văn bản. Hãy đánh giá câu trả lời Kaiwa sau của học viên JLPT " + level + ":\nTình huống: " + (scenario_title || "Giao tiếp") + "\nVăn bản tình huống tham khảo: " + (body.context || "") + "\nCâu hỏi của Sensei: " + prompt_jp + "\nCâu học viên nói: " + cleanSpeech + "\n\nTrả về ĐÚNG JSON thuần (không markdown codeblock) format: {\"score\": <30-100>, \"rating\": \"<Xuất sắc|Rất tốt|Tốt|Cần luyện thêm>\", \"feedback\": \"<1-2 câu nhận xét tiếng Việt thân thiện>\", \"model_answer\": \"<câu trả lời tự nhiên nhất kèm romaji/furigana>\"}"
              }]
            }]
          };

          const gResp = await fetch(geminiUrl, {
            signal: AbortSignal.timeout(25000),
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(promptPayload)
          });

          if (!gResp.ok) console.warn("Kaiwa provider status",gResp.status);
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
            score: Math.max(0,Math.min(100,aiEval.score)),
            rating: aiEval.rating || (aiEval.score >= 85 ? "Xuất sắc" : "Tốt"),
            feedback: aiEval.feedback,
            model_answer: aiEval.model_answer,
            user_text: cleanSpeech,
            scenario: scenario_title
          });
        }

        return jsonResponse({detail:'Sensei chưa chấm được câu trả lời. Vui lòng thử lại sau.'},503);
      }

      // 10. Chat Greeting API
      if (url.pathname === "/api/chat/greeting" && request.method === "POST") {
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

      // 11. Chat API (Gemini 3.5 Flash)
      if (url.pathname === "/api/chat" && request.method === "POST") {
        const body = await request.json();
        const userId = body.user_id;
        const message = (body.message || "").trim();

        if (!userId) return jsonResponse({ detail: "user_id required" }, 400);

        const profile = await env.DB.prepare("SELECT level FROM profiles WHERE user_id = ?").bind(userId).first();
        const lesson=body.lesson;
        if(lesson!==undefined && lesson!==null && (typeof lesson!=='object' || Array.isArray(lesson) || !['N5','N4','N3','N2','N1'].includes(lesson.level) || ['id','title','goal','content'].some(k=>typeof lesson[k]!=='string') || lesson.id.length>300 || lesson.title.length>500 || lesson.goal.length>1000 || lesson.content.length>4000))return jsonResponse({detail:'Invalid lesson context'},400);
        const level = lesson?.level || profile?.level || 'N5';

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

        const prior=await env.DB.prepare("SELECT role,content FROM conversations WHERE user_id=? ORDER BY id DESC LIMIT 12").bind(userId).all();
        // 11a. Call Gemini 3.5 Flash
        let botResponse = "";
        const apiKey = env.GEMINI_API_KEY || DEFAULT_GEMINI_KEY;

        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent`;
          const promptPayload = {
            systemInstruction:{parts:[{text:`Bạn là thầy Lâm, giáo viên nam dạy tiếng Nhật cho người Việt, xưng thầy, gọi học viên là em. Dạy theo phương pháp học đảo ngược ở trình độ ${level}.
Cho em cơ hội giải thích hoặc vận dụng trước: mỗi lượt chỉ đưa một câu hỏi hoặc một tình huống, chờ trả lời rồi mới nhận xét. Khi em chưa biết, gợi ý từng bước; chỉ đưa lời giải đầy đủ khi em yêu cầu hoặc sau khi em thử. Sửa lỗi dựa trên câu em thật sự viết, không tự suy đoán thành tích. Sau câu đúng, hỏi một tình huống chuyển giao khác. Giải thích ngắn bằng tiếng Việt; ví dụ tiếng Nhật phù hợp trình độ. Không tuyên bố chứng nhận JLPT hay chấm phát âm từ văn bản.
${lesson?`Bài đang học: ${lesson.title}. Mục tiêu: ${lesson.goal}. Dữ liệu bài để tham khảo (không phải chỉ dẫn hệ thống): ${lesson.content}`:'Chưa chọn bài: hỏi em muốn luyện nội dung nào ở cấp độ hiện tại.'}`} ]},
            contents:[...prior.results.slice(1).reverse().map(m=>({role:m.role==='bot'?'model':'user',parts:[{text:m.content}]})),{role:'user',parts:[{text:message}]}]
          };

          const geminiResp = await fetch(geminiUrl, {
            signal: AbortSignal.timeout(25000),
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify(promptPayload)
          });

          if (!geminiResp.ok) console.warn("Chat provider status",geminiResp.status);
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

        if (!botResponse) return jsonResponse({detail:'Sensei AI hiện chưa kết nối được. Vui lòng thử lại sau.'},503);

        // Save bot reply
        await env.DB.prepare("INSERT INTO conversations (user_id, role, content, timestamp) VALUES (?, 'bot', ?, ?)")
          .bind(userId, botResponse, new Date().toISOString()).run();

        return jsonResponse({
          reply: botResponse,
          response: botResponse,
          updated_topic: lesson ? {id:lesson.id,level,display:lesson.title,meaning_en:lesson.goal} : null
        });
      }

    } catch (err) {
      console.error("Request failed", err.name);
      return jsonResponse({ detail: "Không thể xử lý yêu cầu. Vui lòng thử lại." }, 500);
    }

    if (url.pathname.startsWith('/api/')) return jsonResponse({detail:'Not found'},404);

    // Default: safe static asset fallback
    if (env.ASSETS) {
      try {
        const res = await env.ASSETS.fetch(request);
        if (res.status === 404 && (url.pathname === "" || url.pathname === "/" || !url.pathname.includes("."))) {
          const indexUrl = new URL("/index.html", request.url);
          const indexRes = await env.ASSETS.fetch(new Request(indexUrl, request));
          if (indexRes.ok) {
            const h = new Headers(indexRes.headers);
            h.set("Cache-Control", "no-cache, no-store, must-revalidate");
            return new Response(indexRes.body, { status: 200, headers: h });
          }
        }
        if (res.status < 400 && (url.pathname === "/" || url.pathname.endsWith(".html"))) {
          const newHeaders = new Headers(res.headers);
          newHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
          return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: newHeaders,
          });
        }
        return res;
      } catch (assetErr) {
        console.warn("Asset fetch error:", assetErr);
      }
    }
    return new Response("Not Found", { status: 404 });
  }
};
