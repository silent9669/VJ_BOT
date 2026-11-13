import { examRoute } from './exams.js';
import { authRoute, sessionUser } from './auth.js';
import { deleteUserData } from './admin.js';
import { aiRoute, askAI, resolveSpeechProvider, resolveProvider } from './providers.js';
import {rateLimited} from './ai-usage.js';
import { conversationScope, teacherCatalog, validLessonReference } from './tutor-context.js';
import { KAIWA_SCHEMA, KAIWA_SYSTEM, parseKaiwaEvaluation } from './kaiwa.js';
import {speechResponse, openAISpeechResponse} from './speech.js';
import {antigravityOAuthRoute} from './antigravity-oauth.js';
import { tutorChat } from './tutor-chat.js';
import { clearTutorConversation } from './tutor-session.js';
import {liveRoute} from './live.js';
import {practiceCoach} from './practice-coach.js';
/**
 * VJBot (Nihongo Sensei) — CLOUDFLARE WORKER BACKEND
 * D1-backed JLPT curriculum, progress, chat with Gemini (AI Studio free tier) & Gemini Flash TTS.
 */


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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD" && request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) {
      return jsonResponse({detail: "Origin not allowed"}, 403);
    }
    if (request.method === "OPTIONS") return new Response(null, {status:204});
    try {
      if (url.pathname.startsWith('/api/auth/')) return await authRoute(request,env);
      if (url.pathname === '/api/live') return await liveRoute(request,env);
      if (url.pathname.startsWith('/api/ai/oauth/antigravity')) return await antigravityOAuthRoute(request, env);
      if (url.pathname.startsWith('/api/ai/') || url.pathname.startsWith('/api/admin/')) return await aiRoute(request,env,url);
      const privateRoutes = ['/api/exam-attempts','/api/completions','/api/profile','/api/progress','/api/progress/record','/api/next-topic','/api/history','/api/chat','/api/tts','/api/kaiwa/evaluate','/api/practice/coach','/api/account/delete'];
      if(privateRoutes.includes(url.pathname)) {
        const user = await sessionUser(request,env);
        if(!user) return jsonResponse({detail:'Đăng nhập để dùng Sensei và đồng bộ tiến độ.'},401);
        const expectedAccount=request.headers.get('X-VJBot-Account');
        if(expectedAccount!==null&&expectedAccount!==user.user_id)return jsonResponse({detail:'The signed-in account changed. Reload before using API profiles.',code:'account_changed'},409);
        url.searchParams.set('user_id',user.user_id);
        if(['POST','PUT','PATCH'].includes(request.method)) {
          const raw=await request.text();
          if(raw.length>20000) return jsonResponse({detail:'Nội dung quá dài.'},413);
          let body;
          try { body=JSON.parse(raw || '{}'); } catch { return jsonResponse({detail:'Invalid JSON'},400); }
          if(!body || Array.isArray(body) || typeof body!=='object') return jsonResponse({detail:'Invalid body'},400);
          body.user_id=user.user_id;
          delete body.api_key;
          if (['/api/chat','/api/kaiwa/evaluate','/api/practice/coach'].includes(url.pathname)
            && Object.hasOwn(body, 'api_connection') && (await resolveProvider(env,user.user_id,body.api_connection))?.error) {
            return jsonResponse({detail:'Kết nối API không hợp lệ.',code:'invalid_connection'},400);
          }
          if(body.level && !['N5','N4','N3','N2','N1'].includes(body.level)) return jsonResponse({detail:'Invalid level'},400);
          for(const field of ['message','text','user_speech','prompt_jp','context','scenario_title']) {
            if(body[field] !== undefined && (typeof body[field]!=='string' || body[field].length>6000)) return jsonResponse({detail:'Invalid '+field},400);
          }
          request=new Request(request.url,{method:request.method,headers:request.headers,body:JSON.stringify(body)});
        }
        if(['/api/chat','/api/tts','/api/kaiwa/evaluate','/api/practice/coach'].includes(url.pathname) && request.method==='POST') {
          if(await rateLimited(env,user.user_id)) return jsonResponse({detail:'Bạn hãy đợi một phút rồi thử lại.'},429);
        }
      }
      if(url.pathname==='/api/exam-attempts')return await examRoute(request,url,env,url.searchParams.get('user_id'));

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
        await deleteUserData(env,userId);
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
        const reference = url.searchParams.has('lesson_id') ? {id: url.searchParams.get('lesson_id'), level: url.searchParams.get('level')} : null;
        if (reference && !validLessonReference(reference)) return jsonResponse({detail: 'Invalid lesson reference'}, 400);
        const archived = url.searchParams.get('archive') === 'legacy';
        const scope = archived ? 'legacy' : conversationScope('chat', reference);

        if (request.method === "DELETE") {
          if (archived) return jsonResponse({detail: 'Legacy history is read-only'}, 405);
          await clearTutorConversation(env, userId, scope);
          return jsonResponse({ success: true, message: "Chat history cleared" });
        }

        const rows = await env.DB.prepare("SELECT role, content, timestamp FROM (SELECT id, role, content, timestamp FROM conversations WHERE user_id = ? AND context_key = ? ORDER BY id DESC LIMIT 50) ORDER BY id ASC").bind(userId, scope).all();
        return jsonResponse(rows.results || []);
      }

      // 8. TTS API (explicit Gemini or official OpenAI voice connection)
      if (url.pathname === "/api/tts" && request.method === "POST") {
        const body = await request.json();
        const speech = await resolveSpeechProvider(env, url.searchParams.get("user_id"), body.api_connection, request.headers.get('X-VJBot-Profile') ?? undefined);
        if (speech.response) return speech.response;
        return speech.provider.protocol === 'openai'
          ? await openAISpeechResponse(body, speech.provider)
          : await speechResponse(body, speech.provider.apiKey);
      }

      // 9. Kaiwa Speaking Lab Evaluation API
      if (url.pathname === "/api/kaiwa/evaluate" && request.method === "POST") {
        const body = await request.json();
        const {user_speech, level = 'N5', scenario_id, prompt_index = 0} = body;
        if (['scenario_title', 'context', 'prompt_jp'].some(key => Object.hasOwn(body, key))
          || typeof scenario_id !== 'string' || scenario_id.length > 300 || !Number.isInteger(prompt_index) || prompt_index < 0) {
          return jsonResponse({detail: 'Invalid scenario reference'}, 400);
        }
        const catalog = await teacherCatalog(env, level);
        if (!catalog) return jsonResponse({detail: 'The lesson catalog is unavailable. Please try again later.'}, 503);
        const scenario = Object.hasOwn(catalog.scenarios, scenario_id) ? catalog.scenarios[scenario_id] : null;
        const question = scenario?.prompts[prompt_index];
        if (!question) return jsonResponse({detail: 'Unknown scenario or question'}, 400);
        const cleanSpeech = (user_speech || "").trim();

        if (!cleanSpeech) {
          return jsonResponse({
            score: 0,
            rating: "Chưa nói",
            feedback: "Sensei chưa nghe rõ câu trả lời của bạn. Hãy nhấn Micro và nói thử nhé!",
            model_answer: question
          });
        }

        const asked = await askAI(env, url.searchParams.get("user_id"), {
          system: KAIWA_SYSTEM, schema: KAIWA_SCHEMA,
          turns: [{role: 'user', content: JSON.stringify({level, scenario: {title: scenario.title, context: scenario.context}, question, submission: cleanSpeech})}]
        }, body.api_connection, request.headers.get('X-VJBot-Profile') ?? undefined);
        if (asked.response) return asked.response;
        const aiEval = parseKaiwaEvaluation(asked.text);
        if (aiEval) {
          return jsonResponse({...aiEval, user_text: cleanSpeech, scenario: scenario.title});
        }

        return jsonResponse({detail:'Sensei chưa chấm được câu trả lời. Vui lòng thử lại sau.'},503);
      }

      if (url.pathname === '/api/practice/coach' && request.method === 'POST') return await practiceCoach(request,env);

      if (url.pathname === "/api/chat" && request.method === "POST") return await tutorChat(request, env);

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
