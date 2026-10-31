// ==========================================
// VJBOT — NIHONGO SENSEI (REVERSED AI TUTOR)
// Client Architecture & Controller
// ==========================================

const USER_ID_KEY = "vjbot_user_id";
const SOUND_KEY = "vjbot_sound_enabled";
const MASCOT_KEY = "vjbot_sensei_mascot";
function getUserId() {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = "user_" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

const userId = getUserId();
let activeCurriculumLevel = "N5";
let activeCurriculumSkill = "grammar";
let activeKaiwaKey = "freestyle";
let activeKaiwaPromptIdx = 0;
let activeKaiwaLevel = "N5";
let chatLessonContext = null;
let activeQuizLevel = "N5";
let activeFcLevel = "N5";
let examTimerInterval = null;
let examSecondsRemaining = 1500; // 25 mins

const TAB_TITLES = {
  landing: "VJBot",
  dashboard: "Góc học tập",
  kanji: "Kanji",
  classroom: "Thầy Lâm",
  curriculum: "Khóa học",
  lesson: "Bài học",
  flashcards: "Thẻ nhớ",
  kaiwa: "Luyện nói",
  quiz: "Bài luyện JLPT",
  mastery: "Tiến độ",
  settings: "Cài đặt"
};

// ==========================================
// FEATURE: DAILY KANJI OF THE DAY (N5-N1)
// ==========================================
const DAILY_KANJI_DATA = {
  N5: { char: "学", hanviet: "HỌC (まな・ぶ)", meaning: "Học tập, tiếp thu tri thức", on: "ガク", kun: "まな.ぶ", sample: "学生 (gakusei - học sinh)" },
  N4: { char: "旅", hanviet: "LỮ (たび)", meaning: "Du lịch, chuyến đi xa", on: "リョ", kun: "たび", sample: "旅行 (ryokou - du lịch)" },
  N3: { char: "夢", hanviet: "MỘNG (ゆめ)", meaning: "Ước mơ, chiêm bao", on: "ム", kun: "ゆめ", sample: "夢を持つ (yume wo motsu - ấp ủ ước mơ)" },
  N2: { char: "競", hanviet: "CẠNH (きそ・う)", meaning: "Cạnh tranh, thi đua", on: "キョウ, ケイ", kun: "きそ.う", sample: "競争 (kyousou - cạnh tranh)" },
  N1: { char: "鑑", hanviet: "GIÁM (かんが・みる)", meaning: "Gương soi, giám định, xem xét", on: "カン", kun: "かんが.みる", sample: "鑑みる (kangamiru - soi xét cẩn trọng)" }
};

function renderDailyKanji(level = "N5") {
  const data = DAILY_KANJI_DATA[level] || DAILY_KANJI_DATA.N5;
  const charEl = document.getElementById("daily-kanji-char");
  const lvlEl = document.getElementById("daily-kanji-level");
  const hvEl = document.getElementById("daily-kanji-hanviet");
  const meanEl = document.getElementById("daily-kanji-meaning");
  const onEl = document.getElementById("daily-kanji-on");
  const kunEl = document.getElementById("daily-kanji-kun");

  if (charEl) charEl.textContent = data.char;
  if (lvlEl) lvlEl.textContent = level;
  if (hvEl) hvEl.textContent = data.hanviet;
  if (meanEl) meanEl.textContent = data.meaning;
  if (onEl) onEl.textContent = data.on;
  if (kunEl) kunEl.textContent = data.kun;
}

// ==========================================
// FEATURE: WEAK SPOTS BOOKMARK NOTEBOOK
// ==========================================
const BOOKMARKS_STORAGE_KEY = "vjbot_bookmarks_data";

function getBookmarks() {
  try {
    return JSON.parse(localStorage.getItem(BOOKMARKS_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveBookmark(item) {
  const list = getBookmarks();
  if (!list.some(b => b.topic === item.topic)) {
    list.unshift(item);
    if (list.length > 50) list.pop();
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(list));
  }
}

function renderBookmarks() {
  const container = document.getElementById("bookmarked-items-list");
  if (!container) return;
  const list = getBookmarks();
  if (!list || list.length === 0) {
    container.innerHTML = `<p class="empty-bookmark-msg">Chưa có mục nào được lưu. Hãy bấm nút <strong>Lưu chủ đề</strong> trong phòng học Sensei!</p>`;
    return;
  }
  container.innerHTML = list.map((item) => `
    <div class="bookmarked-item">
      <div class="bookmarked-info">
        <strong>${escapeHtml(item.topic)}</strong>
        <span>${escapeHtml(item.desc || "")} • Trình độ ${item.level || "N5"}</span>
      </div>
      <button type="button" class="bookmark-review-btn" data-topic="${encodeURIComponent(item.topic)}">
        🎯 Ôn tập ngay
      </button>
    </div>
  `).join("");

  container.querySelectorAll(".bookmark-review-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const topic = decodeURIComponent(btn.dataset.topic);
      switchTab("classroom");
      sendMessage(`Sensei ơi, em muốn luyện sâu lại phần điểm yếu:「${topic}」nhé!`);
    });
  });
}


// ==========================================
// 1. SOUND ENGINE (8-BIT RETRO SYNTHESIZER)
// ==========================================
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem(SOUND_KEY) !== "false";
  }

  initContext() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem(SOUND_KEY, this.enabled ? "true" : "false");
    return this.enabled;
  }

  playTone(freq, type, duration, delay = 0, gainVal = 0.08) {
    if (!this.enabled || !navigator.userActivation?.hasBeenActive) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + delay);
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + delay + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime + delay);
      osc.stop(this.ctx.currentTime + delay + duration);
    } catch {}
  }

  playBlip() { this.playTone(520, "sine", 0.06); }
  playSend() { this.playTone(440, "triangle", 0.08); this.playTone(660, "triangle", 0.1, 0.05); }
  playReceive() { this.playTone(660, "sine", 0.1); this.playTone(880, "sine", 0.14, 0.08); }
  playFlip() { this.playTone(320, "triangle", 0.08); this.playTone(480, "sine", 0.08, 0.04); }
  playCheer() { [523, 659, 784, 1046].forEach((f, i) => this.playTone(f, "triangle", 0.15, i * 0.08, 0.12)); }
  playError() { this.playTone(280, "sawtooth", 0.15); this.playTone(220, "sawtooth", 0.2, 0.1); }
}

const soundEngine = new SoundEngine();

// ==========================================
// 2. MASCOT MANAGER (6 PIXELLAB MASCOTS)
// ==========================================
const MASCOTS = { lam: { name: "Thầy Lâm", role: "Giáo viên tiếng Nhật", avatar: "assets/lam/teacher.svg", cheer: "Đúng rồi, em làm tốt lắm!" } };

class MascotManager {
  constructor() {
    this.current = "lam";
    if (!MASCOTS[this.current]) this.current = "lam";
    this.state = "idle";
  }

  setMascot(key) {
    if (!MASCOTS[key]) return;
    this.current = key;
    localStorage.setItem(MASCOT_KEY, key);
    this.updateAllSpriteElements();
  }

  updateAllSpriteElements() {
    const data = MASCOTS[this.current];
    const elements = [
      "stage-sensei-img",
      "dock-mascot-img",
      "popover-mascot-img",
      "welcome-mascot-img",
      "topbar-user-avatar",
      "loading-mascot-img"
    ];

    elements.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.src = data.avatar;
    });

    const nameEl = document.getElementById("stage-sensei-name");
    const roleEl = document.getElementById("stage-sensei-role");
    if (nameEl) nameEl.textContent = data.name;
    if (roleEl) roleEl.textContent = data.role;

    document.querySelectorAll(".mascot-choice").forEach(card => {
      const isCurrent = card.dataset.mascot === this.current;
      card.classList.toggle("active", isCurrent);
      const stamp = card.querySelector(".choice-stamp");
      if (stamp) stamp.textContent = isCurrent ? "ĐANG CHỌN" : "CHỌN NÀY";
    });
  }

  setState(st) {
    this.state = st;
    document.body.dataset.teacherState=st;
    const moodBadge = document.getElementById("sensei-mood-badge");
    const stateTag = document.getElementById("sensei-state-tag");
    const label = st === "thinking" ? "Đang suy nghĩ 🤔" : (st === "speaking" ? "Đang giảng bài 🗣️" : "Tươi vui 😊");
    if (moodBadge) moodBadge.textContent = label;
    if (stateTag) stateTag.textContent = `Sensei: ${label}`;
  }

  celebrate() {
    soundEngine.playCheer();
    this.setState("speaking");
    setTimeout(() => this.setState("idle"), 2500);
  }
}

const mascotMgr = new MascotManager();

// ==========================================
// 3. FAST & SAFE LOADING SCREEN
// ==========================================
function initLoadingScreen() {
  const loadingOverlay = document.getElementById("app-loading-screen");
  if (!loadingOverlay) return;

  const progressFill = document.getElementById("loading-progress-fill");
  const percentText = document.getElementById("loading-percent-text");
  const statusText = document.getElementById("loading-status-text");

  setTimeout(() => {
    if (progressFill) progressFill.style.width = "100%";
    if (percentText) percentText.textContent = "100%";
    if (statusText) statusText.textContent = "Sẵn sàng cùng VJBot Sensei!";
    setTimeout(() => {
      loadingOverlay.classList.add("fade-out");
      setTimeout(() => loadingOverlay.remove(), 350);
    }, 180);
  }, 220);

  // Hard safety timeout: guaranteed removal in 600ms
  setTimeout(() => {
    const el = document.getElementById("app-loading-screen");
    if (el) el.remove();
  }, 600);
}

// ==========================================
// 4. LIVE JLPT EXAM COUNTDOWN TIMER
// ==========================================
function initJlptCountdown() {
  function updateCountdown() {
    const now = new Date();
    const currentYear = now.getFullYear();

    // JLPT is held on 1st Sunday of July and 1st Sunday of December
    function getFirstSunday(year, month) {
      const d = new Date(year, month, 1, 9, 0, 0);
      const day = d.getDay();
      const diff = (7 - day) % 7;
      d.setDate(1 + diff);
      return d;
    }

    const julyExam = getFirstSunday(currentYear, 6);
    const decExam = getFirstSunday(currentYear, 11);
    let target = julyExam;

    if (now > julyExam) target = decExam;
    if (now > decExam) target = getFirstSunday(currentYear + 1, 6);

    const diffMs = target - now;
    if (diffMs <= 0) return;

    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diffMs / (1000 * 60)) % 60);
    const secs = Math.floor((diffMs / 1000) % 60);

    const dEl = document.getElementById("cd-days");
    const hEl = document.getElementById("cd-hours");
    const mEl = document.getElementById("cd-mins");
    const sEl = document.getElementById("cd-secs");

    if (dEl) dEl.textContent = String(days).padStart(2, "0");
    if (hEl) hEl.textContent = String(hours).padStart(2, "0");
    if (mEl) mEl.textContent = String(mins).padStart(2, "0");
    if (sEl) sEl.textContent = String(secs).padStart(2, "0");
  }

  updateCountdown();
  setInterval(updateCountdown, 1000);
}

// ==========================================
// 5. 1984 MACINTOSH CRT TYPEWRITER (ANATOMY FIGURES)
// ==========================================
function initAnatomyTypewriter() {
  const anatomyEl = document.querySelector("anatomy-computer");
  if (!anatomyEl || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const PHRASES = [
    "こんにちは、世界！",
    "日本語を勉強しましょう！",
    "パソコン — máy tính",
    "キーボード — bàn phím",
    "今日も一日がんばりましょう！"
  ];

  let phraseIdx = 0;
  let charIdx = 0;
  let isDeleting = false;

  function tick() {
    if(document.hidden || !anatomyEl.getClientRects().length){setTimeout(tick,1000);return;}
    const shadow = anatomyEl.shadowRoot;
    if (!shadow) {
      setTimeout(tick, 300);
      return;
    }

    const textEl = shadow.querySelector(".pc-text");
    if (!textEl) {
      setTimeout(tick, 300);
      return;
    }

    const currentPhrase = PHRASES[phraseIdx];
    if (isDeleting) {
      charIdx--;
      textEl.textContent = currentPhrase.substring(0, charIdx);
    } else {
      charIdx++;
      textEl.textContent = currentPhrase.substring(0, charIdx);
    }

    let delay = isDeleting ? 60 : 120;
    if (!isDeleting && charIdx === currentPhrase.length) {
      delay = 2000;
      isDeleting = true;
    } else if (isDeleting && charIdx === 0) {
      isDeleting = false;
      phraseIdx = (phraseIdx + 1) % PHRASES.length;
      delay = 400;
    }

    setTimeout(tick, delay);
  }

  setTimeout(tick, 400);
}

// ==========================================
// 6. GEMINI TTS (VOICE SYNTHESIS)
// ==========================================
async function playGeminiTTS(text, voice = "Charon") {
  if (!text || !text.trim()) return;
  const clean = text.replace(/<[^>]*>/g, "").replace(/[#*`_]/g, "").trim();

  window.speechSynthesis?.cancel();
  soundEngine.playBlip();
  mascotMgr.setState("speaking");

  try {
    const resp = await apiFetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, voice })
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data.audioBase64) {
        const audio = new Audio(audioDataUrl(data));
        audio.onended = () => mascotMgr.setState("idle");
        await audio.play();
        return;
      }
    }
  } catch (err) {
    console.warn("Gemini TTS fallback to Web Speech:", err);
  }

  // Fallback to Browser Native Japanese SpeechSynthesis
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "ja-JP";
    u.rate = 0.95;
    u.onend = () => mascotMgr.setState("idle");
    window.speechSynthesis.speak(u);
  } else {
    mascotMgr.setState("idle");
  }
}

// ==========================================
// 7. TAB SWITCHER & NAVIGATION
// ==========================================
function switchTab(tabId, route={}) {
  if(!authorizePage(tabId,route) || !confirmWorkspaceNavigation(tabId,route))return false;
  featureVersion++;
  quizRequest++;fcRequest++;kaiwaRenderRequest++;
  clearInterval(simulationInterval);
  document.getElementById("simulation-audio")?.pause();
  navigationVersion++;
  curriculumRequest++;
  studyPlanRequest++;
  if (!TAB_TITLES[tabId]) tabId = "landing";
  document.body.dataset.page=tabId;
  document.title=tabId==='landing'?'VJBot · Học tiếng Nhật cùng thầy Lâm':`${TAB_TITLES[tabId]} · VJBot`;
  soundEngine.playBlip();

  // Update sidebar & mobile bottom items
  document.querySelectorAll(".sidebar-nav-item").forEach(item => {
    const active=item.dataset.tab === (tabId==='lesson'?(route.owner || 'curriculum'):tabId);
    item.classList.toggle('active',active);
    if(active)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
  });
  document.querySelectorAll(".mobile-bottom-item").forEach(item => {
    const active=item.dataset.tab === (tabId==='lesson'?(route.owner || 'curriculum'):tabId);
    item.classList.toggle('active',active);
    if(active)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
  });

  // Toggle tab panels
  document.querySelectorAll(".tab-panel").forEach(panel => {
    const isTarget = panel.id === `panel-${tabId}`;
    panel.hidden = !isTarget;
    panel.classList.toggle("active", isTarget);
  });

  // Update topbar title
  const topbarTitle = document.getElementById("topbar-view-title");
  if (topbarTitle && TAB_TITLES[tabId]) {
    topbarTitle.textContent = TAB_TITLES[tabId];
  }

  // Update URL hash
  const targetHash=appRouteHash(tabId,route);
  if(!route.fromHistory && location.hash!==targetHash)history.pushState(null,'',targetHash);

  window.scrollTo({top:0,behavior:'instant'});
  document.querySelector('.app-main').scrollTop=0;

  window.closeAppSidebar?.();

  if(examTimerInterval && tabId!=="quiz"){clearInterval(examTimerInterval);examTimerInterval=null;}
  // Initialize specific tab views
  if (tabId === "curriculum") {
    document.getElementById('level-hub').hidden=Boolean(route.level);
    document.getElementById('level-course').hidden=!route.level;
    if(route.level){
      activeCurriculumLevel=route.level;curriculumView=route.view || 'plan';
      document.getElementById('course-page-title').textContent=`Khóa học ${route.level}`;
      renderCurriculum(route.level,route.skill || activeCurriculumSkill);
      document.getElementById('course-page-title').focus({preventScroll:true});
    }else{renderLevelCards();document.getElementById('level-hub-title').focus({preventScroll:true});}
  } else if (['flashcards','kaiwa','kanji','quiz'].includes(tabId)) {
    renderFeaturePage(tabId,route);
  } else if (tabId === 'dashboard') {
    renderDashboard();
  } else if (tabId === "mastery") {
    loadProgress();
    renderBookmarks();
  } else if (tabId === "classroom") {
    renderDailyKanji(activeCurriculumLevel);
  }
  return true;
}

// ==========================================
// 8. CHAT & REVERSED QUIZ CONTROLLER
// ==========================================
function renderBubble(role, content) {
  const container = document.getElementById("chat-messages");
  if (!container) return;

  const welcome = document.getElementById("chat-welcome");
  if (welcome) welcome.style.display = "none";

  const row = document.createElement("div");
  row.className = `chat-bubble-row ${role === "user" ? "user-row" : "bot-row"}`;

  const currentMascot = MASCOTS[mascotMgr.current];
  const avatarSrc = currentMascot.avatar;

  const formattedContent = escapeHtml(content).replace(/\n/g, "<br>");

  row.innerHTML = `
    <div class="bubble-avatar-box">
      ${role === "user" ? '<span class="learner-avatar">Em</span>' : `<img src="${avatarSrc}" alt="Thầy Lâm" class="bubble-avatar-img pixel-sprite">`}
    </div>
    <div class="bubble-speech-card ${role}">
      <div class="bubble-header-meta">
        <span class="bubble-name">${role === "user" ? "Bạn" : currentMascot.name}</span>
        ${role === "bot" ? `<button type="button" class="bubble-tts-btn" title="Nghe Sensei đọc tiếng Nhật">Nghe</button>` : ""}
      </div>
      <div class="bubble-body-text">${formattedContent}</div>
    </div>
  `;

  if (role === "bot") {
    const ttsBtn = row.querySelector(".bubble-tts-btn");
    if (ttsBtn) {
      ttsBtn.addEventListener("click", () => playGeminiTTS(content));
    }
  }

  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
  return row;
}

let sendingMessage=false;
async function sendMessage(text) {
  if (sendingMessage || !text || !text.trim()) return;
  if(!signedInUser){openAccount();return;}
  document.getElementById('btn-send-message').disabled=true;
  document.getElementById('chat-connection-status').textContent='Thầy đang đọc…';
  sendingMessage=true;
  renderBubble("user", text);
  soundEngine.playSend();
  mascotMgr.setState("thinking");

  const inputEl = document.getElementById("chat-input");
  if (inputEl) inputEl.value = "";

  try {
    const resp = await apiFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        message: text,
        lesson: chatLessonContext
      })
    });

    if (!resp.ok) {
      const error=await resp.json();
      renderBubble("bot", error.detail || "Sensei đang kết nối lại, bạn đợi một lát nhé...");
      mascotMgr.setState("idle");
      return;
    }

    const data = await resp.json();
    mascotMgr.setState("speaking");
    soundEngine.playReceive();

    const reply = data.reply || data.response;
    if(typeof reply!=="string" || !reply.trim())throw new Error("Empty AI reply");
    renderBubble("bot", reply);

    if (reply.includes("正解") || reply.includes("chính xác") || reply.includes("Đúng rồi")) {
      mascotMgr.celebrate();
    } else {
      setTimeout(() => mascotMgr.setState("idle"), 2000);
    }
  } catch (err) {
    renderBubble("bot", "Không kết nối được với thầy Lâm. Em hãy thử gửi lại.");
    mascotMgr.setState("idle");
  } finally {sendingMessage=false;document.getElementById("btn-send-message").disabled=false;document.getElementById("chat-connection-status").textContent="Sẵn sàng";}
}

async function loadGreeting() {
  try {
    const resp = await apiFetch(`/api/next-topic?user_id=${encodeURIComponent(userId)}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.display) updateHeroTopic({display:data.display,meaning:data.meaning_vi || data.meaning_en,jlpt_level:data.level});
      if (data.greeting) {
        renderBubble("bot", data.greeting);
      }
      if (data.topic) {
        updateHeroTopic(data.topic);
      }
    }
  } catch {}
}

function updateHeroTopic(topic) {
  const display = document.getElementById("hero-topic-display");
  const meaning = document.getElementById("hero-topic-meaning");
  const badge = document.getElementById("hero-topic-badge");
  const recText = document.getElementById("rec-text");

  if (display && topic.display) display.textContent = topic.display;
  if (meaning && topic.meaning) meaning.textContent = topic.meaning;
  if (badge && topic.jlpt_level) badge.textContent = `JLPT ${topic.jlpt_level}`;
  if (recText && topic.display) {
    recText.textContent = `Luyện tập mẫu câu「${topic.display}」(${topic.meaning || ""}) để hoàn thiện phản xạ JLPT!`;
  }
}

// ==========================================
// 9. CURRICULUM CONTROLLER (4 SKILLS ROADMAP)
// ==========================================
let curriculumRequest=0,lessonVisibleLimit=24;
function filterCurriculum(reset=true){
  if(reset)lessonVisibleLimit=24;
  const query=document.getElementById('lesson-search').value.trim().toLowerCase();let matched=0;
  document.querySelectorAll('.curriculum-lesson-card').forEach(card=>{const match=card.dataset.search.includes(query);card.hidden=!match||matched>=lessonVisibleLimit;if(match)matched++;});
  document.getElementById('lesson-count').textContent=matched?`${Math.min(matched,lessonVisibleLimit)} / ${matched} bài · ${activeCurriculumLevel}`:'Không tìm thấy bài học.';
  document.getElementById('lesson-load-more').hidden=matched<=lessonVisibleLimit;
}

async function renderCurriculum(level = "N5", skill = "grammar") {
  if((skill==='kana' && level!=='N5') || !window.JLPT_DATA.curriculum[level].skills[skill])skill='grammar';
  const request=++curriculumRequest;
  document.getElementById('study-plan').hidden=curriculumView!=='plan';
  document.getElementById('lesson-library').hidden=curriculumView!=='library';
  document.getElementById('skill-tabs-row').hidden=curriculumView!=='library';
  document.getElementById('cb-skill-trail').hidden=curriculumView!=='library';
  const loadingHost=document.getElementById(curriculumView==='plan'?'study-plan':'curriculum-list');
  if(loadingHost.dataset.level!==level || !loadingHost.textContent)loadingHost.textContent='Đang tải bài học…';
  loadingHost.dataset.level=level;
  try { await Promise.all([ensureLessons(level),loadCompletions()]); }
  catch {
    if(request!==curriculumRequest)return;
    loadingHost.textContent='Chưa tải được bài học. ';
    const retry=document.createElement('button');retry.className='stage-btn';retry.textContent='Thử lại';retry.onclick=()=>renderCurriculum(level,skill);loadingHost.append(retry);return;
  }
  if(request!==curriculumRequest)return;
  activeCurriculumLevel = level;
  activeCurriculumSkill = skill;
  document.querySelector('[data-skill="kana"]').hidden=level!=="N5";

  // Update breadcrumb
  const cbLevel = document.getElementById("cb-level");
  const cbSkill = document.getElementById("cb-skill");
  const skillNames = {
    kana: "Bảng chữ cái",
    kanji: "Hán tự",
    grammar: "Ngữ pháp",
    vocabulary: "Từ vựng",
    reading: "Đọc hiểu",
    listening: "Nghe hiểu"
  };
  if (cbLevel) cbLevel.textContent = level;
  if (cbSkill) cbSkill.textContent = skillNames[skill] || skill;

  // Update skill tab buttons
  document.querySelectorAll("#skill-tabs-row .skill-tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.skill === skill);
  });

  const listEl = document.getElementById("curriculum-list");
  if (!listEl) return;

  const data = window.JLPT_DATA?.curriculum?.[level]?.skills?.[skill] || [];

  if (!data || data.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1; padding: 40px; text-align: center; background: #ffffff; border: 2px dashed #cbd5e1; border-radius: 16px;">
        <span style="font-size: 32px;">📚</span>
        <h3 style="margin-top: 12px; font-weight: 700;">Đang cập nhật bài học cho cấp độ ${level}</h3>
        <p style="color: #64748b; font-size: 14px;">Sensei đang biên soạn thêm nội dung cho phần này. Bạn hãy thử chọn N5 hoặc N4 nhé!</p>
      </div>
    `;
    return;
  }

  document.getElementById("lesson-count").textContent=`${data.length} bài · ${level}`;
  listEl.innerHTML = data.map((item, idx) => `
    <div class="curriculum-lesson-card" tabindex="0" role="button" data-idx="${idx}" style="background: #ffffff; border: 2px solid var(--border-dark); border-radius: 14px; padding: 18px; box-shadow: 2px 3px 0px rgba(0,0,0,0.08); transition: transform 0.15s ease; cursor: pointer;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <span style="background: #eff6ff; color: #2563eb; font-family: var(--font-mono); font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px;">Bài ${item.lesson || (idx + 1)} • ${level}</span>
        <span style="font-size: 12px; color: #16a34a; font-weight: 700;">${item.items?.length || item.examples?.length || 1} mục</span>
      </div>
      <h3 style="font-family: var(--font-sans); font-size: 16px; font-weight: 800; color: var(--ink); margin-bottom: 4px;">${escapeHtml(item.title || item.jp || "Bài học")}</h3>
      <p style="font-family: var(--font-sans); font-size: 13px; color: #475569; margin-bottom: 12px; line-height: 1.4;">${escapeHtml(item.meaning_vi || item.vi || item.translation || item.summary || item.script_vi || "")}</p>
      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #f1f5f9; padding-top: 10px;">
        <span style="font-size: 12px; color: #64748b; font-family: var(--font-mono);">${item.source ? "OpenJLPT · EN" : item.reading || item.ro || (item.items ? `${item.items.length} mục` : "")}</span>
        <span class="open-lesson-btn" style="background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 5px 12px; font-size: 12px; font-weight: 700; cursor: pointer;">${completionRecords.has(activityId(item,level,skill))?'Hoàn thành':'Học bài →'}</span>
      </div>
    </div>
  `).join("");

  listEl.querySelectorAll(".curriculum-lesson-card").forEach(card => {
    card.dataset.search=JSON.stringify({...data[Number(card.dataset.idx)],drills:undefined}).toLowerCase();
    card.hidden=!card.dataset.search.includes(document.getElementById("lesson-search").value.toLowerCase());
    card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();card.click();}});
    card.addEventListener("click", () => {
      const idx = parseInt(card.dataset.idx, 10);
      showLessonDetail(data[idx], level, skill);
    });
  });
  filterCurriculum();
  setCurriculumView(curriculumView,false);
}

function showLessonDetail(item, level, skill, fromHistory=false,owner=null) {
  item={...item,items:item.items || item.roleplay?.words || item.targetWords,examples:item.examples || item.roleplay?.dialogue};
  const returnView=curriculumView;
  if(switchTab('lesson',{level,skill,id:owner?item.id:activityId(item,level,skill),fromHistory,owner})===false)return;
  activeCurriculumLevel=level;
  activeCurriculumSkill=skill;
  currentLesson={item,level,skill,returnView,owner};
  document.getElementById('btn-close-lesson-modal').textContent='Về khóa học';
  const modal = document.getElementById("lesson-page");
  const badge = document.getElementById("modal-lesson-badge");
  const title = document.getElementById("modal-lesson-title");
  const body = document.getElementById("modal-lesson-body");
  if (!modal || !body) return;

  if (badge) badge.textContent = `Bài ${item.lesson || 1} • ${level}`;
  if (title) title.textContent = item.title || item.jp || "Bài học";
  document.title=`${title.textContent} · ${level} · VJBot`;

  let examplesHtml = "";
  if (item.examples && item.examples.length > 0) {
    examplesHtml = `
      <div style="margin-top: 20px;">
        <h4 style="font-size: 14px; font-weight: 800; color: #1e293b; margin-bottom: 10px;">Ví dụ</h4>
        ${item.examples.map(ex => `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <p style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 2px;">${furiganaHtml(ex.furigana || ex.jp)}</p>
              <p style="font-size: 12px; color: #64748b; font-family: var(--font-mono); margin-bottom: 2px;">${escapeHtml(ex.ro)}</p>
              <p style="font-size: 13px; color: #334155;">${escapeHtml(ex.vi)}</p>${ex.source ? `<a href="${escapeHtml(ex.source)}" target="_blank" rel="noopener">Tatoeba ↗</a>` : ""}
            </div>
            <button type="button" class="card-audio-btn modal-tts-btn" data-text="${encodeURIComponent(ex.jp)}" style="flex-shrink: 0; background: #fff; border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 6px 10px; cursor: pointer;">Nghe</button>
          </div>
        `).join("")}
      </div>
    `;
  }

  const vocabularyHtml = item.items?.length ? `
    <div class="lesson-vocabulary-list">${item.items.map(word=>`
      <details class="word-detail"><summary><strong lang="ja">${escapeHtml(word.jp)}</strong><span>${escapeHtml(word.reading || word.ro || "")}</span><span>${escapeHtml(word.vi)}</span></summary>
        <div class="word-detail-body"><button type="button" class="card-audio-btn modal-tts-btn" data-text="${encodeURIComponent(word.jp)}">Nghe cách đọc</button>
        ${word.strokes ? `<dl class="kanji-facts"><div><dt>Số nét</dt><dd>${word.strokes}</dd></div><div><dt>Bộ thủ</dt><dd>${escapeHtml(word.radical)}</dd></div><div><dt>Âm On</dt><dd>${escapeHtml(word.onyomi.join(' · '))}</dd></div><div><dt>Âm Kun</dt><dd>${escapeHtml(word.kunyomi.join(' · '))}</dd></div></dl><p>${escapeHtml((word.words||[]).join(' · '))}</p>` : ''}
        ${(word.examples||[]).map(ex=>`<div class="word-example"><p lang="ja">${furiganaHtml(ex.furigana || ex.jp)}</p><p>${escapeHtml(ex.vi)}</p><button type="button" class="card-audio-btn modal-tts-btn" data-text="${encodeURIComponent(ex.jp)}">Nghe câu</button>${ex.source?`<a href="${escapeHtml(ex.source)}" target="_blank" rel="noopener">Tatoeba ↗</a>`:''}</div>`).join('')}
        </div></details>`).join('')}</div>` : "";
  const readingHtml = item.passage ? `<div class="lesson-reading"><p class="lesson-japanese-passage">${escapeHtml(item.passage)}</p><p>${escapeHtml(item.translation || "")}</p></div>` : "";
  const listeningHtml = item.script_jp ? `<div class="lesson-reading"><p class="lesson-japanese-passage">${item.script_jp}</p><p>${item.script_vi || ""}</p></div>` : "";

  body.innerHTML = `
    <div class="lesson-mode-switch" aria-label="Hoạt động bài học"><button type="button" data-lesson-mode="read" aria-pressed="true">Học bài</button><button type="button" data-lesson-mode="practice" aria-pressed="false">5 câu kiểm tra</button></div>
    <div id="lesson-reference">
    <div style="margin-bottom: 16px;">
      <span style="font-size: 11px; font-weight: 800; color: #2563eb; text-transform: uppercase;">${escapeHtml(item.sourceLabel || (item.source ? "OpenJLPT · EN" : "Bài học"))}</span>
      <p style="font-size: 15px; font-weight: 700; color: #1e293b; margin: 4px 0 10px;">${escapeHtml(item.meaning_vi || item.vi || "")}</p>
      ${item.formula ? `
        <div style="background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 10px; padding: 10px 14px; font-family: var(--font-mono); font-size: 13px; color: #1e40af; margin-bottom: 12px;">
          <strong>Cấu trúc:</strong> ${escapeHtml(item.formula)}
        </div>
      ` : ""}
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">${escapeHtml(item.explanation || item.summary || "")}</p>
    </div>
    ${item.resources?.length ? `<aside class="lesson-resources"><h4>Học tiếp từ nguồn gốc</h4>${item.resources.map(r=>`<p>${escapeHtml(r.publisher)} · ${escapeHtml(r.title)}</p><a href="${escapeHtml(r.pdf_url)}" target="_blank" rel="noopener">Mở bài PDF</a> ${r.audio_page_url?`<a href="${escapeHtml(r.audio_page_url)}" target="_blank" rel="noopener">Nghe bản gốc</a>`:''}`).join('')}<p>Bài trong app được biên soạn riêng; nguồn gốc dùng hệ A1/A2/A2–B1.</p></aside>` : ''}
    ${examplesHtml}
    ${vocabularyHtml}
    ${readingHtml}
    ${listeningHtml}
    ${item.externalResources?.length?`<div class="external-resources">${item.externalResources.map(r=>`<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)} ↗</a>`).join('')}</div>`:''}
    </div><div id="lesson-exercises" hidden></div><div id="lesson-completion"></div>
    <div class="lesson-footer" style="margin-top: 24px; display: flex; gap: 10px;">
      <button type="button" class="sketch-btn-cta modal-practice-btn" style="flex: 1; padding: 10px;">Luyện với thầy Lâm</button>
      <button type="button" class="stage-btn modal-close-action" style="padding: 10px 18px;">Đóng</button>
    </div>
  `;

  renderLessonExercises(item,level,skill);
  const hasPractice=Boolean(item.production || item.dictation || lessonQuestions(item,level,skill).length);
  const modes=body.querySelector('.lesson-mode-switch');
  modes.hidden=!hasPractice;
  const selectMode=mode=>{
    body.dataset.mode=mode;
    body.querySelector('#lesson-reference').hidden=mode!=='read';
    body.querySelector('#lesson-exercises').hidden=mode!=='practice';
    body.querySelector('#lesson-completion').hidden=mode==='practice' && !body.querySelector('.practice-result') && !item.production && !item.dictation;
    modes.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.lessonMode===mode)));
    body.scrollTop=0;
  };
  modes.querySelectorAll('button').forEach(b=>b.onclick=()=>selectMode(b.dataset.lessonMode));
  if(hasPractice){
    const start=document.createElement('button');start.className='practice-primary lesson-start';start.textContent='Làm 5 câu kiểm tra';
    start.onclick=()=>{selectMode('practice');body.querySelector('#lesson-exercises legend, #lesson-exercises textarea, #lesson-exercises button')?.focus();};
    body.querySelector('#lesson-reference').append(start);
  }
  selectMode('read');
  mountCompletion(document.getElementById('lesson-completion'),{activity_id:activityId(item,level,skill),kind:owner==='quiz'?'test':owner==='kaiwa'?'kaiwa':'lesson',level,title:item.title || item.jp || 'Bài học'});
  body.querySelectorAll(".modal-tts-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const text = decodeURIComponent(btn.dataset.text);
      playGeminiTTS(text);
    });
  });

  const btnPractice = body.querySelector(".modal-practice-btn");
  if (btnPractice) {
    btnPractice.addEventListener("click", () => {
      switchTab("classroom");
      startReversedLesson(item,level,skill,owner);
    });
  }

  const steps=(studyPlans.get(level)||[]).flatMap(u=>u.steps);
  const current=steps.findIndex(s=>activityId(s.lesson,level,s.skill)===activityId(item,level,skill));
  if(current>=0 && steps[current+1]){
    const next=document.createElement('button');next.type='button';next.className='stage-btn';next.textContent='Bài tiếp →';
    next.onclick=()=>openStudyStep(steps[current+1],level);body.querySelector('.modal-practice-btn').parentElement.append(next);
  }
  const btnClose = body.querySelector(".modal-close-action");
  if (btnClose){btnClose.textContent="Về khóa học";btnClose.addEventListener("click",returnToCourse);}

  addFeatureLessonAction(item,level,owner);
  body.scrollTop=0;
  title.focus({preventScroll:true});
}

// ==========================================
// 10. FLASHCARDS CONTROLLER (SRS 3D FLIP)
// ==========================================
let fcDeck = [];
let fcIdx = 0,fcRequest=0;

async function renderFlashcards(level = "N5",lessonId=null) {
  const request=++fcRequest;
  let deck=[];
  try { await ensureLessons(level); } catch (error) { document.getElementById("fc-counter").textContent=error.message; return; }
  if(request!==fcRequest)return;
  activeFcLevel = level;
  document.querySelectorAll("#fc-level-picker .fc-lvl-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lvl === level);
  });

  const vocabularyLessons = window.JLPT_DATA?.curriculum?.[level]?.skills?.vocabulary || [];
  const vocabList = vocabularyLessons.filter(l=>!lessonId || (l.id || `lesson:${level}:vocabulary:${l.lesson}`)===lessonId).flatMap(lesson => lesson.items || []).filter(item => item.jp);
  if (vocabList.length > 0) {
    deck = vocabList.map(v => ({
      id: v.id || `fc-${level}-${v.jp}`,
      front: v.jp,
      reading: v.reading || v.ro || "",
      back: v.meaning_vi || v.vi || "",
      exampleJp: v.examples?.[0]?.jp || "",
      exampleVi: v.examples?.[0]?.vi || "",
      level: level
    }));
  } else {
    deck = [
      { front: "私", reading: "わたし (watashi)", back: "Tôi", exampleJp: "私はベトナム人です。", exampleVi: "Tôi là người Việt Nam.", level: "N5" },
      { front: "学生", reading: "がくせい (gakusei)", back: "Học sinh, sinh viên", exampleJp: "彼は学生です。", exampleVi: "Anh ấy là học sinh.", level: "N5" }
    ];
  }

  const progress=await apiFetch('/api/progress').then(r=>r.json()).catch(()=>({items:[]}));
  if(request!==fcRequest)return;
  const reviewed=new Map((progress.items||[]).map(i=>[i.item_id,i]));
  fcDeck=deck.filter(i=>!reviewed.get(i.id)?.next_review || new Date(reviewed.get(i.id).next_review)<=new Date()).sort((a,b)=>Number(!reviewed.has(a.id))-Number(!reviewed.has(b.id))).slice(0,20);
  fcIdx = 0;
  if(!fcDeck.length){document.getElementById('fc-counter').textContent='Đã ôn xong. Quay lại khi thẻ đến hạn.';document.getElementById('flashcard-card').hidden=true;document.querySelector('.fc-controls-bar').hidden=true;return;}
  document.getElementById('flashcard-card').hidden=false;document.querySelector('.fc-controls-bar').hidden=false;
  displayFlashcard();
}

function displayFlashcard() {
  if (!fcDeck || fcDeck.length === 0) return;
  const item = fcDeck[fcIdx];
  const card = document.getElementById("flashcard-card");
  if (card) card.classList.remove("flipped");

  const frontText = document.getElementById("fc-front-text");
  const readingText = document.getElementById("fc-reading-text");
  const backMeaning = document.getElementById("fc-back-meaning");
  const exampleJp = document.getElementById("fc-example-jp");
  const exampleVi = document.getElementById("fc-example-vi");
  const badgeLvl = document.getElementById("fc-badge-lvl");
  const counterEl = document.getElementById("fc-counter");

  if (frontText) frontText.textContent = item.front;
  document.getElementById("fc-btn-prev").disabled=fcIdx===0;
  document.getElementById("fc-btn-next").disabled=fcIdx===fcDeck.length-1;
  if (readingText) readingText.textContent = item.reading;
  if (backMeaning) backMeaning.textContent = item.back;
  if (exampleJp) exampleJp.textContent = item.exampleJp;
  if (exampleVi) exampleVi.textContent = item.exampleVi;
  if (badgeLvl) badgeLvl.textContent = `${item.level} Từ vựng`;
  if (counterEl) counterEl.textContent = `Thẻ ${fcIdx + 1} / ${fcDeck.length}`;
}

// ==========================================
// 11. KAIWA SPEAKING LAB CONTROLLER
// ==========================================
let kaiwaRenderRequest=0;
function installCourseKaiwa(){
  for(const unit of practicalCourse.units){window.JLPT_DATA.kaiwaScenarios[unit.id]={title:unit.title,desc:unit.goal,level:unit.level,course:true,context:unit.dialogue.map(d=>d.jp).join('\n'),prompts:[{jp:unit.production.question_jp,vi:unit.production.prompt,hints:unit.production.criteria}]};}
}
function startCourseKaiwa(unit){
  installCourseKaiwa();activeKaiwaLevel=unit.level;activeKaiwaKey=unit.id;activeKaiwaPromptIdx=0;showLessonDetail(findFeatureLesson('kaiwa',unit.level,`kaiwa-lesson:${unit.level}:${unit.id}`),unit.level,'listening',false,'kaiwa');
}
async function renderKaiwaScenarios(){
  const request=++kaiwaRenderRequest,container=document.getElementById('kaiwa-scenarios-grid');
  container.textContent='Đang tải tình huống…';
  try{await loadPracticalCourse();if(request!==kaiwaRenderRequest)return;installCourseKaiwa();}
  catch{container.textContent='Chưa tải được tình huống.';return;}
  const scenarios=Object.entries(window.JLPT_DATA.kaiwaScenarios).filter(([key,s])=>s.level===activeKaiwaLevel || s.level==='ALL');
  if(!scenarios.some(([key])=>key===activeKaiwaKey))activeKaiwaKey=scenarios[0]?.[0];
  document.getElementById('kaiwa-level').value=activeKaiwaLevel;
  container.replaceChildren();
  for(const [key,scenario] of scenarios){
    const button=document.createElement('button');button.type='button';button.className='kaiwa-scenario-card';button.classList.toggle('active',key===activeKaiwaKey);button.textContent=scenario.title;
    button.onclick=()=>{activeKaiwaKey=key;activeKaiwaPromptIdx=0;container.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===button));loadKaiwaPrompt();};container.append(button);
  }
  loadKaiwaPrompt();
}

function loadKaiwaPrompt() {
  const s = window.JLPT_DATA?.kaiwaScenarios?.[activeKaiwaKey];
  if (!s) return;

  const tag = document.getElementById("kaiwa-prompt-tag");
  const jp = document.getElementById("kaiwa-prompt-jp");
  const vi = document.getElementById("kaiwa-prompt-vi");
  const manualInput = document.getElementById("kaiwa-manual-input");
  const resultCard = document.getElementById("kaiwa-result-card");
  const prompts = Array.isArray(s.prompts) ? s.prompts : [];
  const prompt = prompts[activeKaiwaPromptIdx % Math.max(prompts.length, 1)] || {};

  mountCompletion(document.getElementById('kaiwa-completion'),{activity_id:s.course?`kaiwa:${activeKaiwaKey}`:`kaiwa:${activeKaiwaLevel}:${activeKaiwaKey}`,kind:'kaiwa',level:activeKaiwaLevel,title:s.title});
  const context=document.getElementById('kaiwa-context');context.textContent=s.context || '';context.hidden=!s.context;
  if (tag) tag.textContent = s.title;
  if (jp) jp.textContent = prompt.jp || "こんにちは。よろしくお願いします。";
  if (vi) vi.textContent = prompt.vi || "Hãy trả lời bằng một câu tiếng Nhật tự nhiên.";
  if (manualInput) manualInput.value = "";
  document.getElementById("kaiwa-next-prompt").hidden=prompts.length<2;
  if (resultCard) resultCard.hidden = true;
  const hint = document.getElementById("kaiwa-prompt-hint");
  if (hint) hint.textContent = prompt.hints?.[0] || "Gợi ý: dùng câu lịch sự với です / ます.";
}

// ==========================================
// 12. JLPT MOCK EXAM CONTROLLER (MONDAI 1-4)
// ==========================================
let currentExamQuestions = [];
let examQuestionIdx = 0;
let examScore = 0;
let activeQuizTestIdx = 0;

let quizRequest=0;
async function renderQuiz(level = "N5", testIdx = 0) {
  const request=++quizRequest;
  try { await Promise.all([ensureLessons(level),loadPracticalCourse()]);createStudyPlan(level); } catch { document.getElementById("quiz-instruction").textContent="Chưa tải được bộ luyện. Chọn lại cấp độ để thử lại.";return; }
  if(request!==quizRequest)return;
  activeQuizLevel = level;
  activeQuizTestIdx = testIdx;

  document.querySelectorAll("#quiz-level-picker .quiz-lvl-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lvl === level);
  });

  const examList = window.JLPT_DATA?.exams?.[level] || [];
  const testPicker = document.getElementById("quiz-test-picker");
  if (testPicker) {
    testPicker.innerHTML = examList.map((ex,idx)=>`<option value="${idx}">${escapeHtml(ex.id ? ex.title : `Bộ cơ bản ${idx+1}`)} · ${ex.questions?.length || 0} câu</option>`).join('');
    testPicker.value=String(testIdx);
    testPicker.onchange=()=>switchTab('quiz',{level:activeQuizLevel,view:'practice',id:testPicker.value});
  }

  const selectedExam = examList[testIdx] || examList[0];
  let questions = selectedExam?.questions || [];

  if (!questions.length) {
    document.getElementById('quiz-instruction').textContent='Chưa có câu hỏi cho bộ này.';
    document.getElementById('quiz-options-grid').replaceChildren();return;
  }
  document.getElementById('quiz-source-note').textContent=selectedExam.source || 'Bài luyện JLPT';

  const completion=document.getElementById('quiz-completion');completion.replaceChildren();
  currentExamQuestions = questions;
  examQuestionIdx = 0;
  examScore = 0;
  const examDuration = selectedExam?.duration_minutes ? selectedExam.duration_minutes * 60 : 1500;
  startExamTimer(examDuration);
  displayQuizQuestion();
}

function startExamTimer(seconds = 1500) {
  if (examTimerInterval) clearInterval(examTimerInterval);
  examSecondsRemaining = seconds;
  const deadline=Date.now()+seconds*1000;

  const display = document.getElementById("exam-timer-display");
  function tick() {
    examSecondsRemaining=Math.max(0,Math.ceil((deadline-Date.now())/1000));
    if (examSecondsRemaining <= 0) {
      clearInterval(examTimerInterval);
      finishExam();
      return;
    }
    const m = Math.floor(examSecondsRemaining / 60);
    const s = examSecondsRemaining % 60;
    if (display) display.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  tick();
  examTimerInterval = setInterval(tick, 1000);
}

function displayQuizQuestion() {
  const quizCard = document.getElementById("quiz-card");
  const resultCard = document.getElementById("quiz-result-card");
  const feedbackBox = document.getElementById("quiz-feedback-box");
  if (quizCard) quizCard.hidden = false;
  if (resultCard) resultCard.hidden = true;
  if (feedbackBox) feedbackBox.hidden = true;

  document.getElementById("btn-quiz-next").disabled=true;
  const q = currentExamQuestions[examQuestionIdx];
  if (!q) {
    finishExam();
    return;
  }

  const qNum = document.getElementById("quiz-q-num");
  const qType = document.getElementById("quiz-q-type");
  const inst = document.getElementById("quiz-instruction");
  const sentence = document.getElementById("quiz-question-sentence");
  const grid = document.getElementById("quiz-options-grid");

  if (qNum) qNum.textContent = `Câu ${examQuestionIdx + 1} / ${currentExamQuestions.length}`;
  if (qType) qType.textContent = q.mondai || q.type || "JLPT Mondai";
  if (inst) inst.textContent = q.instruction || "Chọn đáp án chính xác nhất:";
  let rawSentence = q.sentence || q.sentence_jp || "";
  if(q.plain)rawSentence=escapeHtml(rawSentence);
  if (q.target && rawSentence.includes(q.target) && !rawSentence.includes("<u>")) {
    rawSentence = rawSentence.replace(q.target, `<u>${q.target}</u>`);
  }
  if (sentence) sentence.innerHTML = (q.passage ? `<p class="lesson-japanese-passage">${escapeHtml(q.passage)}</p>` : "") + rawSentence;

  if (grid) {
    grid.innerHTML = q.options.map((opt, i) => `
      <button type="button" class="quiz-option-btn" data-idx="${i}" style="background: #ffffff; border: 2px solid var(--border-dark); border-radius: 12px; padding: 14px 18px; text-align: left; font-family: var(--font-sans); font-size: 14.5px; font-weight: 600; cursor: pointer; transition: all 0.15s ease;">
        <span style="display: inline-block; width: 24px; height: 24px; border-radius: 50%; background: #f1f5f9; text-align: center; line-height: 24px; font-size: 12px; font-weight: 700; margin-right: 8px;">${i + 1}</span>
        ${escapeHtml(opt)}
      </button>
    `).join("");

    grid.querySelectorAll(".quiz-option-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        handleQuizAnswer(parseInt(btn.dataset.idx, 10));
      });
    });
  }
}

function handleQuizAnswer(selectedIdx) {
  document.getElementById("btn-quiz-next").disabled=true;
  const q = currentExamQuestions[examQuestionIdx];
  const grid = document.getElementById("quiz-options-grid");
  const feedbackBox = document.getElementById("quiz-feedback-box");
  const feedbackStatus = document.getElementById("quiz-feedback-status");
  const feedbackText = document.getElementById("quiz-feedback-text");

  if (grid) {
    grid.querySelectorAll(".quiz-option-btn").forEach((btn, idx) => {
      btn.disabled = true;
      if (idx === q.answer) {
        btn.style.background = "#dcfce7";
        btn.style.borderColor = "#16a34a";
        btn.style.color = "#15803d";
      } else if (idx === selectedIdx) {
        btn.style.background = "#fee2e2";
        btn.style.borderColor = "#dc2626";
        btn.style.color = "#b91c1c";
      }
    });
  }

  const isCorrect = selectedIdx === q.answer;
  if (isCorrect) {
    examScore++;
    soundEngine.playCheer();
    if (feedbackStatus) feedbackStatus.textContent = "Chính xác";
  } else {
    soundEngine.playError();
    if (feedbackStatus) feedbackStatus.textContent = "Chưa chính xác";
  }

  const feedback=q.explain || q.explanation || "";
  if (feedbackText) feedbackText.textContent=feedback;
  if (feedbackBox) feedbackBox.hidden=false;
  const request=quizRequest,attemptId=crypto.randomUUID();
  const body={item_id:quizProgressId(activeQuizLevel,activeQuizTestIdx,q,examQuestionIdx),correct:isCorrect,level:activeQuizLevel,item_type:"exam",display:q.sentence_jp || q.sentence,quality:isCorrect?4:1,attempt_id:attemptId};
  document.getElementById('quiz-save-retry')?.remove();
  const retry=document.createElement('button');retry.id='quiz-save-retry';retry.type='button';retry.className='stage-btn';retry.textContent='Lưu lại';retry.hidden=true;feedbackBox.append(retry);
  async function save(){
    retry.disabled=true;
    try{
      const response=await apiFetch('/api/progress/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok)throw new Error('save');
      if(request!==quizRequest)return;
      feedbackText.textContent=feedback;retry.remove();document.getElementById('btn-quiz-next').disabled=false;
    }catch{if(request!==quizRequest)return;feedbackText.textContent=feedback+' Chưa lưu được tiến độ.';retry.hidden=false;retry.disabled=false;}
  }
  retry.onclick=save;save();
}

function finishExam() {
  if (examTimerInterval) clearInterval(examTimerInterval);
  const quizCard = document.getElementById("quiz-card");
  const resultCard = document.getElementById("quiz-result-card");
  const scoreVal = document.getElementById("quiz-final-score-val");
  const praise = document.getElementById("quiz-result-praise");

  if (quizCard) quizCard.hidden = true;
  if (resultCard) resultCard.hidden = false;

  const total = currentExamQuestions.length || 1;
  const pct = Math.round((examScore / total) * 100);
  if (scoreVal) scoreVal.textContent = `${pct}% (${examScore}/${total} câu)`;

  if (praise) {
    praise.textContent = pct >= 80 
      ? "Xuất sắc! Em đã làm tốt bộ câu hỏi này."
      : "Cố gắng lên nhé! Hãy ôn lại các câu chưa chính xác cùng Sensei.";
  }

  const exam=window.JLPT_DATA.exams[activeQuizLevel][activeQuizTestIdx];
  mountCompletion(document.getElementById('quiz-completion'),{activity_id:`test:${examIdentity(activeQuizLevel,activeQuizTestIdx)}`,kind:'test',level:activeQuizLevel,title:exam.title});
  loadProgress();
}

// ==========================================
// 13. MASTERY & PROGRESS CONTROLLER
// ==========================================
async function loadProgress() {
  showCompletedActivities(document.getElementById("completed-activities"));
  try {
    const resp = await apiFetch(`/api/progress?user_id=${encodeURIComponent(userId)}`);
    if (resp.ok) {
      const data = await resp.json();
      document.getElementById("mastery-lessons-count").textContent=data.total_learned ?? 0;
      document.getElementById("mastery-accuracy-rate").textContent=`${data.accuracy_rate ?? 0}%`;
      document.getElementById("mastery-streak-val").textContent=`${data.streak_days ?? 0} ngày`;
      document.getElementById("streak-counter").textContent=`${data.streak_days ?? 0} ngày`;
      document.getElementById("mastery-exams-count").textContent=(data.items || []).filter(x=>x.item_id?.startsWith("exam-")).length;
      const list = document.getElementById("weak-spots-list");
      const weakItems = data.weak_spots || data.weak_items || [];
      if (list && !weakItems.length) list.textContent="Chưa có mục cần ôn.";
      if (list && weakItems.length) {
        list.innerHTML = weakItems.map(it => {
          const item = typeof it === "string" ? { display: it } : it;
          return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #fff; border: 1.5px solid #fed7aa; border-radius: 10px; margin-bottom: 8px;">
            <div><strong style="color: #9a3412;">${escapeHtml(item.display || item.topic_id || "Mục cần ôn")}</strong>
              <p style="font-size: 12px; color: #7c2d12; margin: 0;">Sai: ${item.incorrect || 1} lần • Đúng: ${item.correct || 0} lần</p>
            </div>
            <button type="button" class="revise-btn" data-topic="${escapeHtml(item.display || item.topic_id || "mục này")}" style="background: #ea580c; color: #fff; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 700; cursor: pointer;">Ôn tập ngay</button>
          </div>
        `;
        }).join("");

        list.querySelectorAll(".revise-btn").forEach(b => {
          b.addEventListener("click", () => {
            switchTab("classroom");
            sendMessage(`Sensei ơi, em muốn ôn tập lại phần:「${b.dataset.topic}」nhé!`);
          });
        });
      }
    }
  } catch {}
}

// ==========================================
// 14. FLOATING SENSEI DOCK (ANYWHERE SPAWNING)
// ==========================================
function setupFloatingSensei() {
  const dock = document.getElementById("sensei-floating-dock");
  const dockBtn = document.getElementById("btn-spawn-sensei-float");
  const popover = document.getElementById("sensei-floating-popover");
  const closeBtn = document.getElementById("btn-close-popover");
  const sendBtn = document.getElementById("btn-popover-send");
  const inputEl = document.getElementById("popover-query-input");
  const speechEl = document.getElementById("popover-speech-text");
  const ttsBtn = document.getElementById("btn-popover-tts");
  const summonBtn = document.getElementById("btn-topbar-summon");

  function togglePopover() {
    soundEngine.playBlip();
    if (!popover) return;
    popover.hidden = !popover.hidden;
    if (!popover.hidden && inputEl) {
      inputEl.focus();
    }
  }

  // Draggable Anywhere Logic
  dockBtn?.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();togglePopover();}});
  if (dock) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;
    let movedDist = 0;

    // Load saved position if any
    const saved = localStorage.getItem("vjbot_sensei_pos");
    if (saved) {
      try {
        const { x, y } = JSON.parse(saved);
        dock.style.left = Math.min(Math.max(10, x), window.innerWidth - 70) + "px";
        dock.style.top = Math.min(Math.max(10, y), window.innerHeight - 70) + "px";
        dock.style.right = "auto";
        dock.style.bottom = "auto";
      } catch {}
    }

    const onStart = (cx, cy) => {
      isDragging = true;
      movedDist = 0;
      startX = cx;
      startY = cy;
      const rect = dock.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      dock.classList.add("dragging");
    };

    const onMove = (cx, cy) => {
      if (!isDragging) return;
      const dx = cx - startX;
      const dy = cy - startY;
      movedDist = Math.max(movedDist, Math.hypot(dx, dy));
      let nLeft = Math.max(8, Math.min(window.innerWidth - dock.offsetWidth - 8, initialLeft + dx));
      let nTop = Math.max(8, Math.min(window.innerHeight - dock.offsetHeight - 8, initialTop + dy));
      dock.style.left = nLeft + "px";
      dock.style.top = nTop + "px";
      dock.style.right = "auto";
      dock.style.bottom = "auto";
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      dock.classList.remove("dragging");
      if (movedDist > 6) {
        const rect = dock.getBoundingClientRect();
        localStorage.setItem("vjbot_sensei_pos", JSON.stringify({ x: rect.left, y: rect.top }));
      }
    };

    dock.addEventListener("mousedown", (e) => {
      onStart(e.clientX, e.clientY);
      const mMove = (ev) => onMove(ev.clientX, ev.clientY);
      const mUp = () => {
        onEnd();
        window.removeEventListener("mousemove", mMove);
        window.removeEventListener("mouseup", mUp);
      };
      window.addEventListener("mousemove", mMove);
      window.addEventListener("mouseup", mUp);
    });

    dock.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      onStart(t.clientX, t.clientY);
    }, { passive: true });

    dock.addEventListener("touchmove", (e) => {
      if (!isDragging) return;
      const t = e.touches[0];
      onMove(t.clientX, t.clientY);
    }, { passive: true });

    dock.addEventListener("touchend", onEnd);

    if (dockBtn) {
      dockBtn.addEventListener("click", () => {
        if (movedDist <= 6) togglePopover();
      });
    }
  }
  if (summonBtn) summonBtn.addEventListener("click", togglePopover);
  if (closeBtn) closeBtn.addEventListener("click", () => { popover.hidden = true; });

  // Keyboard Shortcut: Cmd+K / Ctrl+K
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      togglePopover();
    }
  });

  async function handlePopoverQuery(query) {
    if (!query || !query.trim()) return;
    if (speechEl) speechEl.textContent = "Sensei đang suy nghĩ...";
    mascotMgr.setState("thinking");

    try {
      const resp = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          message: query
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        const reply = data.reply || data.response || "Sensei đã ghi nhận câu hỏi của bạn!";
        if (speechEl) speechEl.textContent = reply;
        mascotMgr.setState("speaking");
        soundEngine.playReceive();
      }
    } catch {
      if (speechEl) speechEl.textContent = "Lỗi kết nối. Bạn thử lại nhé!";
      mascotMgr.setState("idle");
    }
  }

  if (sendBtn && inputEl) {
    sendBtn.addEventListener("click", () => {
      const q = inputEl.value;
      inputEl.value = "";
      handlePopoverQuery(q);
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const q = inputEl.value;
        inputEl.value = "";
        handlePopoverQuery(q);
      }
    });
  }

  if (ttsBtn && speechEl) {
    ttsBtn.addEventListener("click", () => {
      playGeminiTTS(speechEl.textContent);
    });
  }

  document.querySelectorAll(".quick-chip-btn").forEach(chip => {
    chip.addEventListener("click", () => {
      if (chip.dataset.ask) {
        handlePopoverQuery(chip.dataset.ask);
      }
    });
  });
}

// ==========================================
// 15. SETTINGS, GEMINI KEY & ACCOUNT DELETION
// ==========================================
function setupSettings() {
  // Sound Toggle
  const soundBtn = document.getElementById("btn-toggle-sound-setting");
  if (soundBtn) {
    soundBtn.addEventListener("click", () => {
      const enabled = soundEngine.toggle();
      soundBtn.textContent = enabled ? "🔊 Bật âm thanh" : "🔇 Tắt âm thanh";
    });
  }

  // Mascots Selection Grid
  document.querySelectorAll(".mascot-choice").forEach(card => {
    card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();card.click();}});
    card.addEventListener("click", () => {
      soundEngine.playBlip();
      mascotMgr.setMascot(card.dataset.mascot);
    });
  });

  // User ID Display & Copy
  const userIdDisplay = document.getElementById("user-id-display");
  if (userIdDisplay) userIdDisplay.textContent = signedInUser?.user_id || userId;

  const btnCopyUserId = document.getElementById("btn-copy-user-id");
  if (btnCopyUserId) {
    btnCopyUserId.addEventListener("click", () => {
      navigator.clipboard?.writeText(signedInUser?.user_id || userId);
      btnCopyUserId.textContent = "✅ Đã sao chép!";
      setTimeout(() => { btnCopyUserId.textContent = "📋 Sao chép"; }, 2000);
    });
  }

  // Delete Account on Cloudflare D1
  const btnDelete = document.getElementById("btn-delete-account");
  if (btnDelete) {
    btnDelete.addEventListener("click", async () => {
      if (!confirm("⚠️ Bạn có chắc chắn muốn xoá toàn bộ tài khoản và dữ liệu tiến độ học tập trên Cloudflare D1? Thao tác này không thể hoàn tác.")) {
        return;
      }
      try {
        const resp = await apiFetch(`/api/account/delete?user_id=${encodeURIComponent(userId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId })
        });
        if (resp.ok) {
          for (const key of Object.keys(localStorage)) if(key.startsWith("vjbot_")) localStorage.removeItem(key);
          alert("Đã xoá tài khoản và toàn bộ dữ liệu trên Cloudflare D1 thành công!");
          window.location.reload();
        } else {
          alert("Lỗi khi xoá tài khoản trên Cloudflare.");
        }
      } catch (err) {
        alert("Lỗi: " + err.message);
      }
    });
  }
}

// ==========================================
// 16. EVENT LISTENERS SETUP
// ==========================================
function setupEventListeners() {
  document.getElementById('btn-practice-topic-now').addEventListener('click',()=>sendMessage(`Thầy Lâm ơi, giúp em luyện ${document.getElementById('hero-topic-display').textContent}.`));
  document.getElementById('btn-change-curriculum-stage').addEventListener('click',()=>switchTab('curriculum'));
  const voiceButton=document.getElementById('btn-voice-input');
  const SpeechRecognition=window.SpeechRecognition || window.webkitSpeechRecognition;
  if(SpeechRecognition){const recognition=new SpeechRecognition();recognition.lang='ja-JP';recognition.onresult=e=>{document.getElementById('chat-input').value=e.results[0][0].transcript;};recognition.onend=()=>voiceButton.textContent='🎙️';voiceButton.onclick=()=>{try{recognition.start();voiceButton.textContent='■';}catch{recognition.stop();}};}
  else {voiceButton.disabled=true;voiceButton.title='Trình duyệt không hỗ trợ nhập giọng nói';}

  window.addEventListener('completion-changed',()=>{if(location.hash===`#curriculum/${activeCurriculumLevel}` && curriculumView==='plan')renderStudyPlan(activeCurriculumLevel);});
  document.getElementById('kaiwa-level').onchange=e=>switchTab('kaiwa',{level:e.target.value});
  document.querySelectorAll('[data-start-level]').forEach(button=>button.onclick=()=>openLevelCourse(button.dataset.startLevel));
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.go)));
  document.getElementById("settings-account").addEventListener("click",openAccount);
  document.querySelectorAll('[data-curriculum-view]').forEach(b=>b.onclick=()=>setCurriculumView(b.dataset.curriculumView));
  document.getElementById("lesson-search").addEventListener("input",()=>filterCurriculum());
  document.getElementById('lesson-load-more').addEventListener('click',()=>{lessonVisibleLimit+=24;filterCurriculum(false);});
  document.getElementById("kaiwa-next-prompt").addEventListener("click",()=>{activeKaiwaPromptIdx=(activeKaiwaPromptIdx+1)%Math.max(1,window.JLPT_DATA.kaiwaScenarios[activeKaiwaKey]?.prompts?.length || 1);loadKaiwaPrompt();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){document.getElementById("level-picker").hidden=true;}});
  setupSidebar();
  document.getElementById('cb-root').onclick=()=>switchTab('curriculum');
  document.getElementById('course-change-level').onclick=()=>switchTab('curriculum');
  document.getElementById('lesson-all-levels').onclick=()=>switchTab(currentLesson?.owner || currentLesson?.returnTab || 'curriculum');
  document.getElementById('btn-close-lesson-modal').onclick=returnToCourse;

  // Sidebar & Mobile bottom navigation clicks
  document.querySelectorAll(".sidebar-nav-item").forEach(item => {
    item.addEventListener("click", () => switchTab(item.dataset.tab));
  });
  document.querySelectorAll(".mobile-bottom-item").forEach(item => {
    item.addEventListener("click", () => switchTab(item.dataset.tab));
  });

  // Daily Kanji Audio Pronunciation Button
  const btnDailyKanjiTts = document.getElementById("btn-daily-kanji-tts");
  if (btnDailyKanjiTts) {
    btnDailyKanjiTts.addEventListener("click", () => {
      const data = DAILY_KANJI_DATA[activeCurriculumLevel] || DAILY_KANJI_DATA.N5;
      playGeminiTTS(data.char + "。" + data.sample);
    });
  }

  // Furigana / Romaji Toggle Button
  const btnToggleFurigana = document.getElementById("btn-toggle-furigana");
  let isFuriganaOn = true;
  if (btnToggleFurigana) {
    btnToggleFurigana.addEventListener("click", () => {
      isFuriganaOn = !isFuriganaOn;
      btnToggleFurigana.textContent = isFuriganaOn ? "あ Furigana: Bật" : "あ Furigana: Tắt";
      btnToggleFurigana.classList.toggle("chip-accent", isFuriganaOn);
      soundEngine.playBlip();
    });
  }

  // Bookmark Current Topic / Weak Spot Button
  const btnBookmark = document.getElementById("btn-bookmark-topic");
  if (btnBookmark) {
    btnBookmark.addEventListener("click", () => {
      const titleEl = document.getElementById("hero-topic-display");
      const meanEl = document.getElementById("hero-topic-meaning");
      const topicTitle = titleEl ? titleEl.textContent.trim() : "〜は〜です";
      const topicDesc = meanEl ? meanEl.textContent.trim() : "Ngữ pháp Minna no Nihongo";
      saveBookmark({ topic: topicTitle, desc: topicDesc, level: activeCurriculumLevel, time: new Date().toLocaleDateString("vi-VN") });
      soundEngine.playCheer();
      btnBookmark.textContent = "Đã lưu";
      setTimeout(() => { btnBookmark.textContent = "Lưu chủ đề"; }, 1500);
    });
  }

  // Landing Page CTA buttons
  const btnLandingStart = document.getElementById("landing-btn-start");
  if (btnLandingStart) {
    btnLandingStart.addEventListener("click", () => switchTab("classroom"));
  }

  const btnLandingCurriculum = document.getElementById("landing-btn-curriculum");
  if (btnLandingCurriculum) {
    btnLandingCurriculum.addEventListener("click", () => switchTab("curriculum"));
  }

  const btnLandingMock = document.getElementById("landing-btn-mock-exam");
  if (btnLandingMock) {
    btnLandingMock.addEventListener("click", () => switchTab("quiz"));
  }

  // Recommendation action button in Classroom
  const btnRec = document.getElementById("btn-rec-action");
  if (btnRec) {
    btnRec.addEventListener("click", () => {
      sendMessage("Sensei ơi, em muốn luyện phản xạ chủ đề gợi ý hôm nay ngay bây giờ!");
    });
  }

  // Classroom prompt chips
  const btnAskHint = document.getElementById("btn-ask-hint");
  if (btnAskHint) btnAskHint.addEventListener("click", () => sendMessage("Sensei hãy cho em xin gợi ý cách đặt câu này với!"));

  const btnAskExplain = document.getElementById("btn-ask-explain");
  if (btnAskExplain) btnAskExplain.addEventListener("click", () => sendMessage("Sensei giải thích ngữ pháp này chi tiết giúp em nhé!"));

  const btnAskExample = document.getElementById("btn-ask-example");
  if (btnAskExample) btnAskExample.addEventListener("click", () => sendMessage("Sensei cho em xin thêm một vài câu ví dụ thực tế nữa nhé!"));

  const btnAskCheck = document.getElementById("btn-ask-check");
  if (btnAskCheck) btnAskCheck.addEventListener("click", () => sendMessage("Sensei kiểm tra giúp em xem câu này đã chuẩn ngữ pháp và tự nhiên chưa!"));

  // Classroom form submit
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  if (chatForm && chatInput) {
    chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const txt = chatInput.value;
      sendMessage(txt);
    });
  }

  // Clear chat history
  const btnClearChat = document.getElementById("btn-clear-chat-history");
  if (btnClearChat) {
    btnClearChat.addEventListener("click", async () => {
      if (confirm("Bạn có muốn xóa toàn bộ lịch sử tin nhắn trong phòng học không?")) {
        try {
          const response=await apiFetch(`/api/history?user_id=${encodeURIComponent(userId)}`, { method: "DELETE" });
          if(!response.ok)throw new Error('delete');
          const messages = document.getElementById("chat-messages");
          if (messages) messages.innerHTML = "";
          soundEngine.playBlip();
        } catch {renderBubble('bot','Chưa xóa được lịch sử. Hãy thử lại.');}
      }
    });
  }

  // Level selector click in sidebar header
  const levelChip = document.getElementById("level-chip");
  const levelPicker = document.getElementById("level-picker");
  const closePicker = document.getElementById("btn-close-picker");

  if (levelChip && levelPicker) {
    levelChip.addEventListener("click", () => {
      window.closeAppSidebar?.();
      levelPicker.hidden = false;
      closePicker.focus();
    });
  }
  if (closePicker && levelPicker) {
    closePicker.addEventListener("click", () => {
      levelPicker.hidden = true;
      document.getElementById('btn-mobile-sidebar').focus();
    });
  }
  document.querySelectorAll(".picker-opt-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const lvl = btn.dataset.level;
      const status = document.getElementById("level-save-status");
      const buttons = document.querySelectorAll(".picker-opt-btn");
      buttons.forEach(button=>button.disabled=true);
      status.textContent="Đang lưu…";
      try {
        const response = await apiFetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, level: lvl })
        });
        if(!response.ok)throw new Error("save");
        activeCurriculumLevel = lvl;
        document.getElementById("level-chip-text").textContent = `Trình độ: ${lvl}`;
        status.textContent="";
        if (levelPicker) levelPicker.hidden = true;
        if(location.hash.startsWith('#curriculum/'))openLevelCourse(lvl);else restoreAppRoute();
      } catch { status.textContent="Chưa lưu được trình độ. Chọn lại để thử lại."; }
      finally { buttons.forEach(button=>button.disabled=false); }
    });
  });

  // Library skills are addressable subpages.
  document.querySelectorAll('#skill-tabs-row .skill-tab-btn').forEach(btn=>{
    btn.onclick=()=>openLevelCourse(activeCurriculumLevel,'library',btn.dataset.skill);
  });

  // Flashcards Level Picker
  document.querySelectorAll("#fc-level-picker .fc-lvl-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      renderFlashcards(btn.dataset.lvl);
    });
  });

  // Flashcard Flipper click
  const fcCard = document.getElementById("flashcard-card");
  if (fcCard) {
    fcCard.addEventListener("keydown",e=>{if(e.target===fcCard && (e.key==="Enter" || e.key===" ")){e.preventDefault();fcCard.click();}});
    fcCard.addEventListener("click", () => {
      soundEngine.playFlip();
      fcCard.classList.toggle("flipped");
    });
  }

  // Flashcard audio TTS
  const btnFcAudioFront = document.getElementById("btn-fc-audio-front");
  if (btnFcAudioFront) {
    btnFcAudioFront.addEventListener("click", (e) => {
      e.stopPropagation();
      const txt = document.getElementById("fc-front-text")?.textContent;
      if (txt) playGeminiTTS(txt);
    });
  }

  const btnFcAudioBack = document.getElementById("btn-fc-audio-back");
  if (btnFcAudioBack) {
    btnFcAudioBack.addEventListener("click", (e) => {
      e.stopPropagation();
      const txt = document.getElementById("fc-example-jp")?.textContent;
      if (txt) playGeminiTTS(txt);
    });
  }

  // Flashcard Navigation & SRS grading
  const nextCard = () => {
    if (fcIdx < fcDeck.length - 1) {
      fcIdx++;
      displayFlashcard();
    } else {
      soundEngine.playCheer();
      alert("🎉 Bạn đã hoàn thành toàn bộ thẻ trong bộ này!");
    }
  };

  const btnFcNext = document.getElementById("fc-btn-next");
  if (btnFcNext) btnFcNext.addEventListener("click", nextCard);

  const btnFcPrev = document.getElementById("fc-btn-prev");
  if (btnFcPrev) {
    btnFcPrev.addEventListener("click", () => {
      if (fcIdx > 0) {
        fcIdx--;
        displayFlashcard();
      }
    });
  }

  let savingCard=false;
  const pendingCardAnswers=new Map();
  async function recordCardProgress(quality) {
    if(savingCard)return;
    const card = fcDeck[fcIdx];
    if (!card) return;
    const isCorrect = quality >= 3;
    savingCard=true;
    if(!pendingCardAnswers.has(card.id))pendingCardAnswers.set(card.id,{item_id:card.id,display:card.front,level:card.level,item_type:'vocabulary',correct:isCorrect,quality,attempt_id:crypto.randomUUID()});
    try { const response=await apiFetch("/api/progress/record", {
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pendingCardAnswers.get(card.id))
    });
    if(!response.ok)throw new Error('save');
    pendingCardAnswers.delete(card.id);
    if(fcIdx===fcDeck.length-1)await renderFlashcards(activeFcLevel);else nextCard();
    } catch {document.getElementById('fc-counter').textContent='Chưa lưu được. Hãy bấm đánh giá để thử lại.';} finally {savingCard=false;}

  }

  const btnFcAgain = document.getElementById("fc-btn-again");
  if (btnFcAgain) btnFcAgain.addEventListener("click", () => { soundEngine.playError(); recordCardProgress(1); });

  const btnFcGood = document.getElementById("fc-btn-good");
  if (btnFcGood) btnFcGood.addEventListener("click", () => { soundEngine.playSend(); recordCardProgress(4); });

  const btnFcEasy = document.getElementById("fc-btn-easy");
  if (btnFcEasy) btnFcEasy.addEventListener("click", () => { soundEngine.playCheer(); recordCardProgress(5); });

  // Kaiwa Audio Prompt Play
  const btnKaiwaPlay = document.getElementById("btn-kaiwa-play-prompt");
  if (btnKaiwaPlay) {
    btnKaiwaPlay.addEventListener("click", () => {
      const jp = document.getElementById("kaiwa-prompt-jp")?.textContent;
      if (jp) playGeminiTTS(jp);
    });
  }

  // Kaiwa User Audio Recording & Web Speech Recognition
  let mediaRecorder = null;
  let audioChunks = [];
  let userAudioBlobUrl = null;

  const btnKaiwaPlayUser = document.getElementById("btn-kaiwa-play-user");
  if (btnKaiwaPlayUser) {
    btnKaiwaPlayUser.addEventListener("click", () => {
      if (userAudioBlobUrl) {
        const audio = new Audio(userAudioBlobUrl);
        audio.play().catch(() => {});
      }
    });
  }

  async function startAudioRecording() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        if (userAudioBlobUrl) URL.revokeObjectURL(userAudioBlobUrl);
        userAudioBlobUrl = URL.createObjectURL(blob);
        if (btnKaiwaPlayUser) btnKaiwaPlayUser.style.display = "inline-flex";
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start();
    } catch {
      // Audio capture fallback silently
    }
  }

  function stopAudioRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      try { mediaRecorder.stop(); } catch {}
    }
  }

  const btnKaiwaMic = document.getElementById("btn-kaiwa-mic");
  const kaiwaInput = document.getElementById("kaiwa-manual-input");
  const micStatus = document.getElementById("kaiwa-mic-status");

  if (btnKaiwaMic && kaiwaInput) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRec) {
      const rec = new SpeechRec();
      rec.lang = "ja-JP";
      rec.interimResults = false;

      rec.onstart = () => {
        if (micStatus) micStatus.textContent = "Đang ghi âm…";
        btnKaiwaMic.style.background = "#fee2e2";
        startAudioRecording();
      };

      rec.onresult = (evt) => {
        const transcript = evt.results[0][0].transcript;
        kaiwaInput.value = transcript;
        soundEngine.playSend();
      };

      rec.onerror = () => {
        if (micStatus) micStatus.textContent = "Micro: Chưa nhận diện được";
        btnKaiwaMic.style.background = "";
        stopAudioRecording();
      };

      rec.onend = () => {
        if (micStatus) micStatus.textContent = "Micro: Sẵn sàng";
        btnKaiwaMic.style.background = "";
        stopAudioRecording();
      };

      btnKaiwaMic.addEventListener("click", () => {
        try { rec.start(); } catch { rec.stop(); stopAudioRecording(); }
      });
    } else {
      btnKaiwaMic.addEventListener("click", () => {
        alert("Trình duyệt chưa hỗ trợ Web Speech API. Bạn có thể nhập câu trả lời trực tiếp bằng bàn phím!");
      });
    }
  }

  // Kaiwa Evaluation submit
  const btnEvalKaiwa = document.getElementById("btn-eval-kaiwa");
  if (btnEvalKaiwa && kaiwaInput) {
    btnEvalKaiwa.addEventListener("click", async () => {
      const speech = kaiwaInput.value.trim();
      if (!speech) {
        alert("Vui lòng nói hoặc nhập câu trả lời tiếng Nhật trước khi chấm điểm!");
        return;
      }

      if(btnEvalKaiwa.disabled)return;
      btnEvalKaiwa.disabled=true;
      const evaluationKey=activeKaiwaKey,evaluationIndex=activeKaiwaPromptIdx;
      btnEvalKaiwa.textContent = "Đang nhận xét…";
      const s = window.JLPT_DATA?.kaiwaScenarios?.[activeKaiwaKey];

      try {
        const resp = await apiFetch("/api/kaiwa/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenario_title: s?.title || activeKaiwaKey,
            context: s?.context || "",
            prompt_jp: document.getElementById("kaiwa-prompt-jp")?.textContent || "",
            user_speech: speech,
            level: activeKaiwaLevel
          })
        });

        if(evaluationKey!==activeKaiwaKey || evaluationIndex!==activeKaiwaPromptIdx)return;
        const resultCard = document.getElementById("kaiwa-result-card");
        const scoreVal = document.getElementById("kaiwa-score-val");
        const feedbackText = document.getElementById("kaiwa-feedback-text");
        const modelText = document.getElementById("kaiwa-model-text");

        if (resp.ok) {
          const evalData = await resp.json();
          if (scoreVal) scoreVal.textContent = evalData.score ?? "—";
          if (feedbackText) feedbackText.textContent = evalData.feedback || "Phản xạ giao tiếp rất tốt!";
          if (modelText) modelText.textContent = evalData.model_answer || "はい、わかりました。";
          if (resultCard) resultCard.hidden = false;
          soundEngine.playCheer();
        } else {
          const failure=await resp.json();
          if (scoreVal) scoreVal.textContent = "—";
          if (feedbackText) feedbackText.textContent = failure.detail || "Chưa thể chấm điểm. Vui lòng thử lại.";
          if (modelText) modelText.textContent = "";
          if (resultCard) resultCard.hidden = false;
        }
      } catch {
        alert("Lỗi khi kết nối hệ thống chấm điểm.");
      } finally {
        btnEvalKaiwa.disabled=false;
        btnEvalKaiwa.textContent = "Nhờ thầy nhận xét";
      }
    });
  }

  const btnModelTTS = document.getElementById("btn-kaiwa-model-tts");
  if (btnModelTTS) {
    btnModelTTS.addEventListener("click", () => {
      const txt = document.getElementById("kaiwa-model-text")?.textContent;
      if (txt) playGeminiTTS(txt);
    });
  }

  // Quiz Next & Restart buttons
  const btnQuizNext = document.getElementById("btn-quiz-next");
  if (btnQuizNext) {
    btnQuizNext.addEventListener("click", () => {
      examQuestionIdx++;
      displayQuizQuestion();
    });
  }

  // Quiz Level Picker buttons
  document.querySelectorAll("#quiz-level-picker .quiz-lvl-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      renderQuiz(btn.dataset.lvl, 0);
    });
  });

  const btnQuizRestart = document.getElementById("btn-quiz-restart");
  if (btnQuizRestart) {
    btnQuizRestart.addEventListener("click", () => {
      renderQuiz(activeQuizLevel, activeQuizTestIdx);
    });
  }

  const btnQuizToClassroom = document.getElementById("btn-quiz-to-classroom");
  if (btnQuizToClassroom) {
    btnQuizToClassroom.addEventListener("click", () => {
      switchTab("classroom");
    });
  }
}

// ==========================================
// 17. BOOTSTRAP INITIALIZATION
// ==========================================
(async function init() {
  initLoadingScreen();
  initJlptCountdown();
  initAnatomyTypewriter();
  mascotMgr.updateAllSpriteElements();

  setupWorkspace();
  await setupAccount();

  // Pre-fetch greeting & user profile
  if(signedInUser)try {
    let res = await apiFetch(`/api/profile?user_id=${encodeURIComponent(userId)}`);
    if (res.status === 404) {
      res = await apiFetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, level: "N5" }),
      });
    }
    if (res.ok) {
      const prof = await res.json();
      const chipText = document.getElementById("level-chip-text");
      if (chipText && prof.level) {
        chipText.textContent = `Trình độ: ${prof.level}`;
        activeCurriculumLevel = prof.level;
      }
    }
  } catch {}

  setupEventListeners();
  setupFloatingSensei();
  setupSettings();

  // Resolve account and saved level before rendering data-dependent routes.
  window.addEventListener('hashchange',restoreAppRoute);
  if(signedInUser && sessionStorage.getItem('vjbot_return_route')){history.replaceState(null,'',sessionStorage.getItem('vjbot_return_route'));sessionStorage.removeItem('vjbot_return_route');}
  if(!location.hash)history.replaceState(null,'',signedInUser?'#dashboard':'#landing');
  restoreAppRoute();
  if(!signedInUser)return;
  loadGreeting();
  loadProgress();
  try {
    const historyResponse=await apiFetch(`/api/history?user_id=${encodeURIComponent(userId)}`);
    if(historyResponse.ok) for(const message of await historyResponse.json()) renderBubble(message.role,message.content);
  } catch { renderBubble("bot", "Chưa tải được lịch sử trò chuyện. Tải lại trang để thử lại."); }

})();

if (typeof window !== "undefined") {
  window.switchTab = switchTab;
  window.soundEngine = soundEngine;
  window.mascotMgr = mascotMgr;
  window.playGeminiTTS = playGeminiTTS;
  window.renderCurriculum = renderCurriculum;
  window.renderFlashcards = renderFlashcards;
  window.renderQuiz = renderQuiz;
}

function startReversedLesson(item,level,skill,owner=null){
  chatLessonContext=buildLessonContext(item,level,skill);
  const host=document.getElementById('chat-lesson-context');host.hidden=false;host.replaceChildren();
  const title=document.createElement('strong');title.textContent=`${level} · ${chatLessonContext.title}`;
  const back=document.createElement('button');back.className='stage-btn';back.textContent='Về bài học';back.onclick=()=>showLessonDetail(item,level,skill,false,owner);
  const control=document.createElement('div');host.append(title,back,control);mountCompletion(control,{activity_id:`chat:${chatLessonContext.id}`,kind:'chat',level,title:`Giải thích lại: ${chatLessonContext.title}`});
  sendMessage('Bắt đầu học đảo ngược bài này. Thầy hỏi một câu để em tự giải thích hoặc vận dụng; chờ câu trả lời của em trước khi đưa đáp án.');
}
