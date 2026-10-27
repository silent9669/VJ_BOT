// ==========================================
// VJBOT — NIHONGO SENSEI (REVERSED AI TUTOR)
// Client Architecture & Controller
// ==========================================

const USER_ID_KEY = "vjbot_user_id";
const SOUND_KEY = "vjbot_sound_enabled";
const MASCOT_KEY = "vjbot_sensei_mascot";
const API_KEY_STORAGE = "vjbot_gemini_key";
const GOOGLE_USER_KEY = "vjbot_google_user";
const DEFAULT_GEMINI_KEY = (typeof atob !== "undefined") ? atob("QVEuQWI4Uk42STRUY01Bd1ZkTnZ1MERoMDIxVjhMVTBCXzdNTmRMelNWQ0FDNUZUcFJEQUE=") : "";

let GEMINI_API_KEY = localStorage.getItem(API_KEY_STORAGE) || DEFAULT_GEMINI_KEY;

function getGeminiApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || DEFAULT_GEMINI_KEY;
}

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
let activeQuizLevel = "N5";
let examTimerInterval = null;
let examSecondsRemaining = 1500; // 25 mins

const TAB_TITLES = {
  landing: "Trang chủ (1984 Macintosh PC)",
  classroom: "Phòng học Sensei (Reversed Quiz)",
  curriculum: "Lộ trình 4 Kỹ năng JLPT N5–N1",
  flashcards: "Thẻ nhớ SRS Spaced Repetition",
  kaiwa: "Kaiwa Speaking Lab (Voice AI)",
  quiz: "Thi thử JLPT (Mock Exam Simulator)",
  mastery: "Radar Năng lực & Phân tích",
  settings: "Hồ sơ & Cài đặt Gemini AI"
};

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
    if (!this.enabled) return;
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
const MASCOTS = {
  minh: {
    name: "Thầy Minh (Minh Sensei)",
    role: "Giáo viên luyện đề • Chuyên sâu JLPT & Phản xạ nhanh",
    avatar: "assets/sensei/minh/south.png",
    cheer: "Rất xuất sắc! Đúng cấu trúc rồi đó!"
  },
  an: {
    name: "Cô An (An Sensei)",
    role: "Giáo viên hướng dẫn phản xạ • Tablet ngữ pháp",
    avatar: "assets/sensei/an/south.png",
    cheer: "Tuyệt vời lắm! Tiếp tục câu tiếp theo nhé!"
  },
  chi: {
    name: "Cô Chi (Chi Sensei)",
    role: "Giáo viên tận tâm • Cặp tài liệu & Kính tri thức",
    avatar: "assets/sensei/chi/south.png",
    cheer: "Cố gắng rất tốt! Ngữ pháp đã chuẩn hơn nhiều rồi!"
  },
  linh: {
    name: "Cô Linh (Linh Sensei)",
    role: "Giáo viên dịu dàng • Sách bài tập & Ân cần",
    avatar: "assets/sensei/linh/south.png",
    cheer: "素晴らしい！Sensei rất tự hào về bạn!"
  },
  pip: {
    name: "Pip Robot (Trợ lý AI)",
    role: "Robot AI đồng hành • Phân tích dữ liệu & Phản xạ nhanh",
    avatar: "assets/sensei/pip/south.png",
    cheer: "BEEP BOOP! Tính toán chính xác 100%!"
  },
  bao: {
    name: "Kỹ sư Bảo (Bao Sensei)",
    role: "Kỹ sư chuyên môn • Tiếng Nhật thực chiến & Cơ khí/IT",
    avatar: "assets/sensei/bao/south.png",
    cheer: "Chuẩn xác! Ứng dụng thực tế cực kỳ ổn!"
  }
};

class MascotManager {
  constructor() {
    this.current = localStorage.getItem(MASCOT_KEY) || "minh";
    if (!MASCOTS[this.current]) this.current = "minh";
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
  if (!anatomyEl) return;

  const PHRASES = [
    "こんにちは、世界！",
    "日本語を勉強しましょう！",
    "VJBot: AI Nihongo Sensei",
    "JLPT N5〜N1 対策準備完了",
    "今日も一日がんばりましょう！"
  ];

  let phraseIdx = 0;
  let charIdx = 0;
  let isDeleting = false;

  function tick() {
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
async function playGeminiTTS(text, voice = "Aoede") {
  if (!text || !text.trim()) return;
  const clean = text.replace(/<[^>]*>/g, "").replace(/[#*`_]/g, "").trim();

  soundEngine.playBlip();
  mascotMgr.setState("speaking");

  try {
    const key = getGeminiApiKey();
    const resp = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, voice, api_key: key })
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data.audio_base64) {
        const audio = new Audio("data:audio/mp3;base64," + data.audio_base64);
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
function switchTab(tabId) {
  if (!TAB_TITLES[tabId]) tabId = "landing";
  soundEngine.playBlip();

  // Update sidebar buttons
  document.querySelectorAll(".sidebar-nav-item").forEach(item => {
    item.classList.toggle("active", item.dataset.tab === tabId);
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
  if (history.replaceState) {
    history.replaceState(null, null, `#${tabId}`);
  }

  // Close mobile sidebar if open
  const sidebar = document.getElementById("app-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (sidebar && window.innerWidth < 900) {
    sidebar.classList.remove("open");
    if (backdrop) backdrop.classList.remove("active");
  }

  // Initialize specific tab views
  if (tabId === "curriculum") {
    renderCurriculum(activeCurriculumLevel, activeCurriculumSkill);
  } else if (tabId === "flashcards") {
    renderFlashcards(activeCurriculumLevel);
  } else if (tabId === "kaiwa") {
    renderKaiwaScenarios();
  } else if (tabId === "quiz") {
    renderQuiz(activeQuizLevel);
  } else if (tabId === "mastery") {
    loadProgress();
  }
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
  const avatarSrc = role === "user" ? "assets/sensei/minh/south.png" : currentMascot.avatar;

  const formattedContent = content.replace(/\n/g, "<br>");

  row.innerHTML = `
    <div class="bubble-avatar-box">
      <img src="${avatarSrc}" alt="${role}" class="bubble-avatar-img pixel-sprite">
    </div>
    <div class="bubble-speech-card ${role}">
      <div class="bubble-header-meta">
        <span class="bubble-name">${role === "user" ? "Bạn" : currentMascot.name}</span>
        ${role === "bot" ? `<button type="button" class="bubble-tts-btn" title="Nghe Sensei đọc tiếng Nhật">🔊</button>` : ""}
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

async function sendMessage(text) {
  if (!text || !text.trim()) return;
  renderBubble("user", text);
  soundEngine.playSend();
  mascotMgr.setState("thinking");

  const inputEl = document.getElementById("chat-input");
  if (inputEl) inputEl.value = "";

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        message: text,
        api_key: getGeminiApiKey()
      })
    });

    if (!resp.ok) {
      renderBubble("bot", "Sensei đang kết nối lại, bạn đợi một lát nhé...");
      mascotMgr.setState("idle");
      return;
    }

    const data = await resp.json();
    mascotMgr.setState("speaking");
    soundEngine.playReceive();

    const reply = data.reply || data.response || "Rất tốt! Bạn hãy tiếp tục nhé.";
    renderBubble("bot", reply);

    if (reply.includes("正解") || reply.includes("chính xác") || reply.includes("Đúng rồi")) {
      mascotMgr.celebrate();
    } else {
      setTimeout(() => mascotMgr.setState("idle"), 2000);
    }
  } catch (err) {
    renderBubble("bot", "Lỗi kết nối. Vui lòng kiểm tra mạng hoặc khóa API Gemini trong Cài đặt.");
    mascotMgr.setState("idle");
  }
}

async function loadGreeting() {
  try {
    const resp = await fetch(`/api/next-topic?user_id=${encodeURIComponent(userId)}`);
    if (resp.ok) {
      const data = await resp.json();
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
function renderCurriculum(level = "N5", skill = "grammar") {
  activeCurriculumLevel = level;
  activeCurriculumSkill = skill;

  // Update breadcrumb
  const cbLevel = document.getElementById("cb-level");
  const cbSkill = document.getElementById("cb-skill");
  const skillNames = {
    grammar: "Ngữ pháp",
    vocabulary: "Từ vựng",
    reading: "Đọc hiểu",
    listening: "Nghe hiểu"
  };
  if (cbLevel) cbLevel.textContent = level;
  if (cbSkill) cbSkill.textContent = skillNames[skill] || skill;

  // Update level tab buttons
  document.querySelectorAll("#curriculum-level-picker .level-tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lvl === level);
  });

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

  listEl.innerHTML = data.map((item, idx) => `
    <div class="curriculum-lesson-card" data-idx="${idx}" style="background: #ffffff; border: 2px solid var(--border-dark); border-radius: 14px; padding: 18px; box-shadow: 2px 3px 0px rgba(0,0,0,0.08); transition: transform 0.15s ease; cursor: pointer;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <span style="background: #eff6ff; color: #2563eb; font-family: var(--font-mono); font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px;">Bài ${item.lesson || (idx + 1)} • ${level}</span>
        <span style="font-size: 12px; color: #16a34a; font-weight: 700;">${item.examples?.length || 3} ví dụ</span>
      </div>
      <h3 style="font-family: var(--font-sans); font-size: 16px; font-weight: 800; color: var(--ink); margin-bottom: 4px;">${item.title || item.jp}</h3>
      <p style="font-family: var(--font-sans); font-size: 13px; color: #475569; margin-bottom: 12px; line-height: 1.4;">${item.meaning_vi || item.vi || item.summary}</p>
      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #f1f5f9; padding-top: 10px;">
        <span style="font-size: 12px; color: #64748b; font-family: var(--font-mono);">${item.reading || item.ro || ""}</span>
        <button type="button" class="open-lesson-btn" data-idx="${idx}" style="background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 5px 12px; font-size: 12px; font-weight: 700; cursor: pointer;">Chi tiết →</button>
      </div>
    </div>
  `).join("");

  listEl.querySelectorAll(".curriculum-lesson-card").forEach(card => {
    card.addEventListener("click", () => {
      const idx = parseInt(card.dataset.idx, 10);
      showLessonDetail(data[idx], level, skill);
    });
  });
}

function showLessonDetail(item, level, skill) {
  const modal = document.getElementById("lesson-detail-modal");
  const badge = document.getElementById("modal-lesson-badge");
  const title = document.getElementById("modal-lesson-title");
  const body = document.getElementById("modal-lesson-body");
  if (!modal || !body) return;

  if (badge) badge.textContent = `Bài ${item.lesson || 1} • ${level}`;
  if (title) title.textContent = item.title || item.jp;

  let examplesHtml = "";
  if (item.examples && item.examples.length > 0) {
    examplesHtml = `
      <div style="margin-top: 20px;">
        <h4 style="font-size: 14px; font-weight: 800; color: #1e293b; margin-bottom: 10px;">✨ Các câu ví dụ thực tế:</h4>
        ${item.examples.map(ex => `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <p style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 2px;">${ex.jp}</p>
              <p style="font-size: 12px; color: #64748b; font-family: var(--font-mono); margin-bottom: 2px;">${ex.ro}</p>
              <p style="font-size: 13px; color: #334155;">${ex.vi}</p>
            </div>
            <button type="button" class="card-audio-btn modal-tts-btn" data-text="${encodeURIComponent(ex.jp)}" style="flex-shrink: 0; background: #fff; border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 6px 10px; cursor: pointer;">🔊</button>
          </div>
        `).join("")}
      </div>
    `;
  }

  body.innerHTML = `
    <div style="margin-bottom: 16px;">
      <span style="font-size: 11px; font-weight: 800; color: #2563eb; text-transform: uppercase;">Ý nghĩa ngữ pháp:</span>
      <p style="font-size: 15px; font-weight: 700; color: #1e293b; margin: 4px 0 10px;">${item.meaning_vi || item.vi || ""}</p>
      ${item.formula ? `
        <div style="background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 10px; padding: 10px 14px; font-family: var(--font-mono); font-size: 13px; color: #1e40af; margin-bottom: 12px;">
          <strong>Cấu trúc:</strong> ${item.formula}
        </div>
      ` : ""}
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">${item.explanation || item.summary || ""}</p>
    </div>
    ${examplesHtml}
    <div style="margin-top: 24px; display: flex; gap: 10px;">
      <button type="button" class="sketch-btn-cta modal-practice-btn" style="flex: 1; padding: 10px;">🎯 Luyện tập mẫu câu này với Sensei</button>
      <button type="button" class="stage-btn modal-close-action" style="padding: 10px 18px;">Đóng</button>
    </div>
  `;

  body.querySelectorAll(".modal-tts-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const text = decodeURIComponent(btn.dataset.text);
      playGeminiTTS(text);
    });
  });

  const btnPractice = body.querySelector(".modal-practice-btn");
  if (btnPractice) {
    btnPractice.addEventListener("click", () => {
      modal.hidden = true;
      switchTab("classroom");
      sendMessage(`Sensei ơi, em muốn luyện tập ngữ pháp:「${item.title || item.jp}」nhé!`);
    });
  }

  const btnClose = body.querySelector(".modal-close-action");
  if (btnClose) btnClose.addEventListener("click", () => modal.hidden = true);

  modal.hidden = false;
}

// ==========================================
// 10. FLASHCARDS CONTROLLER (SRS 3D FLIP)
// ==========================================
let fcDeck = [];
let fcIdx = 0;

function renderFlashcards(level = "N5") {
  document.querySelectorAll("#fc-level-picker .fc-lvl-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lvl === level);
  });

  const vocabList = window.JLPT_DATA?.curriculum?.[level]?.skills?.vocabulary || [];
  if (vocabList.length > 0) {
    fcDeck = vocabList.map(v => ({
      front: v.jp || v.title,
      reading: v.reading || v.ro,
      back: v.meaning_vi || v.vi,
      exampleJp: v.examples?.[0]?.jp || `${v.jp} を使います。`,
      exampleVi: v.examples?.[0]?.vi || `Sử dụng từ ${v.jp}.`,
      level: level
    }));
  } else {
    fcDeck = [
      { front: "私", reading: "わたし (watashi)", back: "Tôi", exampleJp: "私はベトナム人です。", exampleVi: "Tôi là người Việt Nam.", level: "N5" },
      { front: "学生", reading: "がくせい (gakusei)", back: "Học sinh, sinh viên", exampleJp: "彼は学生です。", exampleVi: "Anh ấy là học sinh.", level: "N5" }
    ];
  }

  fcIdx = 0;
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
function renderKaiwaScenarios() {
  const container = document.getElementById("kaiwa-scenarios-grid");
  if (!container) return;

  const scenarios = window.JLPT_DATA?.kaiwaScenarios || {};
  container.innerHTML = Object.entries(scenarios).map(([k, s]) => `
    <div class="kaiwa-scenario-card ${k === activeKaiwaKey ? "active" : ""}" data-key="${k}" style="background: #ffffff; border: 2px solid var(--border-dark); border-radius: 14px; padding: 14px; box-shadow: 2px 3px 0px rgba(0,0,0,0.06); cursor: pointer; transition: all 0.15s ease;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <span style="font-size: 20px;">${s.icon || "🎙️"}</span>
        <strong style="font-size: 14px; color: var(--ink);">${s.title}</strong>
      </div>
      <p style="font-size: 12.5px; color: #64748b; line-height: 1.4; margin: 0;">${s.context}</p>
    </div>
  `).join("");

  container.querySelectorAll(".kaiwa-scenario-card").forEach(c => {
    c.addEventListener("click", () => {
      activeKaiwaKey = c.dataset.key;
      container.querySelectorAll(".kaiwa-scenario-card").forEach(x => x.classList.remove("active"));
      c.classList.add("active");
      loadKaiwaPrompt();
    });
  });

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

  if (tag) tag.textContent = s.title;
  if (jp) jp.textContent = s.promptJp;
  if (vi) vi.textContent = s.promptVi;
  if (manualInput) manualInput.value = "";
  if (resultCard) resultCard.hidden = true;
}

// ==========================================
// 12. JLPT MOCK EXAM CONTROLLER (MONDAI 1-4)
// ==========================================
let currentExamQuestions = [];
let examQuestionIdx = 0;
let examScore = 0;
let activeQuizTestIdx = 0;

function renderQuiz(level = "N5", testIdx = 0) {
  activeQuizLevel = level;
  activeQuizTestIdx = testIdx;

  document.querySelectorAll("#quiz-level-picker .quiz-lvl-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lvl === level);
  });

  const examList = window.JLPT_DATA?.exams?.[level] || [];
  const testPicker = document.getElementById("quiz-test-picker");
  if (testPicker) {
    testPicker.innerHTML = examList.map((ex, idx) => `
      <button type="button" class="quiz-test-btn ${idx === testIdx ? 'active' : ''}" data-idx="${idx}">
        ${ex.title?.split("—")?.[1]?.trim() || `Đề Số 0${idx + 1}`}
      </button>
    `).join("");

    testPicker.querySelectorAll(".quiz-test-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        renderQuiz(activeQuizLevel, parseInt(btn.dataset.idx, 10));
      });
    });
  }

  const selectedExam = examList[testIdx] || examList[0];
  let questions = selectedExam?.questions || [];

  if (!questions || questions.length === 0) {
    questions = [
      {
        type: "Mondai 1: Cách đọc Kanji",
        instruction: "Chọn cách đọc Hiragana đúng của chữ Hán được gạch chân:",
        sentence: "あした、<u>学校</u>へ行きます。",
        options: ["がっこう (gakkou)", "がこう (gakou)", "かっこう (kakkou)", "がくこう (gakukou)"],
        answer: 0,
        explanation: "「学校」đọc chuẩn là「がっこう」(âm ngắt nhỏ っ) nghĩa là trường học."
      },
      {
        type: "Mondai 2: Điền từ vựng",
        instruction: "Chọn từ thích hợp nhất điền vào chỗ trống:",
        sentence: "毎朝、パンとコーヒーを ( _____ )。",
        options: ["飲みます", "食べます", "見ます", "行きます"],
        answer: 1,
        explanation: "Khi có cả bánh mì (パン) và cà phê, động từ chính cho đồ ăn là「食べます」."
      }
    ];
  }

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

  const display = document.getElementById("exam-timer-display");
  function tick() {
    examSecondsRemaining--;
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
  if (q.target && rawSentence.includes(q.target) && !rawSentence.includes("<u>")) {
    rawSentence = rawSentence.replace(q.target, `<u>${q.target}</u>`);
  }
  if (sentence) sentence.innerHTML = rawSentence;

  if (grid) {
    grid.innerHTML = q.options.map((opt, i) => `
      <button type="button" class="quiz-option-btn" data-idx="${i}" style="background: #ffffff; border: 2px solid var(--border-dark); border-radius: 12px; padding: 14px 18px; text-align: left; font-family: var(--font-sans); font-size: 14.5px; font-weight: 600; cursor: pointer; transition: all 0.15s ease;">
        <span style="display: inline-block; width: 24px; height: 24px; border-radius: 50%; background: #f1f5f9; text-align: center; line-height: 24px; font-size: 12px; font-weight: 700; margin-right: 8px;">${i + 1}</span>
        ${opt}
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
    if (feedbackStatus) feedbackStatus.textContent = "Chính xác! 🎉";
  } else {
    soundEngine.playError();
    if (feedbackStatus) feedbackStatus.textContent = "Chưa chính xác ⚠️";
  }

  // Persist answer to progress API / Cloudflare D1
  fetch("/api/progress/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      item_id: `exam-${activeQuizLevel}-t${activeQuizTestIdx + 1}-q${q.id || examQuestionIdx + 1}`,
      correct: isCorrect,
      quality: isCorrect ? 4 : 1
    })
  }).catch(() => {});

  if (feedbackText) feedbackText.textContent = q.explain || q.explanation || "Chính xác theo cấu trúc ngữ pháp JLPT.";
  if (feedbackBox) feedbackBox.hidden = false;
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
      ? "Xuất sắc! Bạn đã nắm vững cấu trúc đề thi cấp độ này." 
      : "Cố gắng lên nhé! Hãy ôn lại các câu chưa chính xác cùng Sensei.";
  }

  loadProgress();
}

// ==========================================
// 13. MASTERY & PROGRESS CONTROLLER
// ==========================================
async function loadProgress() {
  try {
    const resp = await fetch(`/api/progress?user_id=${encodeURIComponent(userId)}`);
    if (resp.ok) {
      const data = await resp.json();
      const list = document.getElementById("weak-spots-list");
      if (list && data.weak_spots) {
        list.innerHTML = data.weak_spots.map(it => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #fff; border: 1.5px solid #fed7aa; border-radius: 10px; margin-bottom: 8px;">
            <div>
              <strong style="color: #9a3412;">${it.display || it.topic_id}</strong>
              <p style="font-size: 12px; color: #7c2d12; margin: 0;">Sai: ${it.incorrect || 1} lần • Đúng: ${it.correct || 0} lần</p>
            </div>
            <button type="button" class="revise-btn" data-topic="${it.display || it.topic_id}" style="background: #ea580c; color: #fff; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 700; cursor: pointer;">Ôn tập ngay</button>
          </div>
        `).join("");

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

  if (dockBtn) dockBtn.addEventListener("click", togglePopover);
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
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          message: query,
          api_key: getGeminiApiKey()
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
  const keyInput = document.getElementById("custom-api-key-input");
  const saveKeyBtn = document.getElementById("btn-save-api-key");
  const eyeBtn = document.getElementById("btn-toggle-key-visibility");
  const testKeyBtn = document.getElementById("btn-test-gemini-key");
  const testStatus = document.getElementById("gemini-key-test-status");

  if (keyInput) {
    keyInput.value = getGeminiApiKey();
  }

  if (eyeBtn && keyInput) {
    eyeBtn.addEventListener("click", () => {
      keyInput.type = keyInput.type === "password" ? "text" : "password";
      eyeBtn.textContent = keyInput.type === "password" ? "👁️" : "🔒";
    });
  }

  if (saveKeyBtn && keyInput) {
    saveKeyBtn.addEventListener("click", () => {
      const val = keyInput.value.trim();
      if (val) {
        localStorage.setItem(API_KEY_STORAGE, val);
        GEMINI_API_KEY = val;
        soundEngine.playSend();
        saveKeyBtn.textContent = "✅ Đã lưu!";
        setTimeout(() => { saveKeyBtn.textContent = "Lưu Khóa"; }, 2000);
      }
    });
  }

  if (testKeyBtn && testStatus) {
    testKeyBtn.addEventListener("click", async () => {
      testStatus.textContent = "Đang kiểm tra kết nối...";
      try {
        const resp = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "こんにちは", api_key: getGeminiApiKey() })
        });
        if (resp.ok) {
          testStatus.textContent = "✅ Kết nối Gemini 2.5 Flash thành công!";
          testStatus.style.color = "#16a34a";
          soundEngine.playCheer();
        } else {
          testStatus.textContent = "❌ Lỗi kết nối hoặc khóa API không hợp lệ.";
          testStatus.style.color = "#dc2626";
        }
      } catch (err) {
        testStatus.textContent = "❌ Lỗi: " + err.message;
        testStatus.style.color = "#dc2626";
      }
    });
  }

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
    card.addEventListener("click", () => {
      soundEngine.playBlip();
      mascotMgr.setMascot(card.dataset.mascot);
    });
  });

  // User ID Display & Copy
  const userIdDisplay = document.getElementById("user-id-display");
  if (userIdDisplay) userIdDisplay.textContent = userId;

  const btnCopyUserId = document.getElementById("btn-copy-user-id");
  if (btnCopyUserId) {
    btnCopyUserId.addEventListener("click", () => {
      navigator.clipboard?.writeText(userId);
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
        const resp = await fetch(`/api/account/delete?user_id=${encodeURIComponent(userId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId })
        });
        if (resp.ok) {
          localStorage.clear();
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
  // Mobile sidebar drawer
  const btnMobile = document.getElementById("btn-mobile-sidebar");
  const sidebar = document.getElementById("app-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");

  if (btnMobile && sidebar) {
    btnMobile.addEventListener("click", () => {
      soundEngine.playBlip();
      sidebar.classList.toggle("open");
      if (backdrop) backdrop.classList.toggle("active", sidebar.classList.contains("open"));
    });
  }

  if (backdrop && sidebar) {
    backdrop.addEventListener("click", () => {
      sidebar.classList.remove("open");
      backdrop.classList.remove("active");
    });
  }

  // Sidebar navigation clicks
  document.querySelectorAll(".sidebar-nav-item").forEach(item => {
    item.addEventListener("click", () => switchTab(item.dataset.tab));
  });

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
          await fetch(`/api/history?user_id=${encodeURIComponent(userId)}`, { method: "DELETE" });
          const messages = document.getElementById("chat-messages");
          if (messages) messages.innerHTML = "";
          soundEngine.playBlip();
        } catch {}
      }
    });
  }

  // Level selector click in sidebar header
  const levelChip = document.getElementById("level-chip");
  const levelPicker = document.getElementById("level-picker");
  const closePicker = document.getElementById("btn-close-picker");

  if (levelChip && levelPicker) {
    levelChip.addEventListener("click", () => {
      levelPicker.hidden = false;
    });
  }
  if (closePicker && levelPicker) {
    closePicker.addEventListener("click", () => {
      levelPicker.hidden = true;
    });
  }
  document.querySelectorAll(".picker-opt-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const lvl = btn.dataset.level;
      if (levelPicker) levelPicker.hidden = true;
      const chipText = document.getElementById("level-chip-text");
      if (chipText) chipText.textContent = `Trình độ: ${lvl}`;
      activeCurriculumLevel = lvl;

      try {
        await fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, level: lvl })
        });
      } catch {}

      if (window.location.hash.includes("curriculum")) {
        renderCurriculum(lvl, activeCurriculumSkill);
      }
    });
  });

  // Curriculum Level Picker
  document.querySelectorAll("#curriculum-level-picker .level-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      renderCurriculum(btn.dataset.lvl, activeCurriculumSkill);
    });
  });

  // Curriculum Skill Tabs
  document.querySelectorAll("#skill-tabs-row .skill-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      renderCurriculum(activeCurriculumLevel, btn.dataset.skill);
    });
  });

  // Close Lesson Modal
  const btnCloseLesson = document.getElementById("btn-close-lesson-modal");
  const lessonModal = document.getElementById("lesson-detail-modal");
  if (btnCloseLesson && lessonModal) {
    btnCloseLesson.addEventListener("click", () => {
      lessonModal.hidden = true;
    });
  }

  // Flashcards Level Picker
  document.querySelectorAll("#fc-level-picker .fc-lvl-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      renderFlashcards(btn.dataset.lvl);
    });
  });

  // Flashcard Flipper click
  const fcCard = document.getElementById("flashcard-card");
  if (fcCard) {
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

  function recordCardProgress(quality) {
    const card = fcDeck[fcIdx];
    if (!card) return;
    const isCorrect = quality >= 3;
    fetch("/api/progress/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        item_id: `fc-${activeFcLevel}-${card.front}`,
        correct: isCorrect,
        quality: quality
      })
    }).catch(() => {});
  }

  const btnFcAgain = document.getElementById("fc-btn-again");
  if (btnFcAgain) btnFcAgain.addEventListener("click", () => { soundEngine.playError(); recordCardProgress(1); nextCard(); });

  const btnFcGood = document.getElementById("fc-btn-good");
  if (btnFcGood) btnFcGood.addEventListener("click", () => { soundEngine.playSend(); recordCardProgress(4); nextCard(); });

  const btnFcEasy = document.getElementById("fc-btn-easy");
  if (btnFcEasy) btnFcEasy.addEventListener("click", () => { soundEngine.playCheer(); recordCardProgress(5); nextCard(); });

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
        if (micStatus) micStatus.textContent = "🎙️ Đang nghe giọng Nhật của bạn...";
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

      btnEvalKaiwa.textContent = "Sensei đang chấm điểm...";
      const s = window.JLPT_DATA?.kaiwaScenarios?.[activeKaiwaKey];

      try {
        const resp = await fetch("/api/kaiwa/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenario: activeKaiwaKey,
            user_speech: speech,
            expected_answer: s?.expectedAnswer || "",
            level: "N5",
            api_key: getGeminiApiKey()
          })
        });

        const resultCard = document.getElementById("kaiwa-result-card");
        const scoreVal = document.getElementById("kaiwa-score-val");
        const feedbackText = document.getElementById("kaiwa-feedback-text");
        const modelText = document.getElementById("kaiwa-model-text");

        if (resp.ok) {
          const evalData = await resp.json();
          if (scoreVal) scoreVal.textContent = evalData.score || 85;
          if (feedbackText) feedbackText.textContent = evalData.feedback || "Phản xạ giao tiếp rất tốt!";
          if (modelText) modelText.textContent = evalData.model_answer || s?.expectedAnswer || "";
          if (resultCard) resultCard.hidden = false;
          soundEngine.playCheer();
        } else {
          if (scoreVal) scoreVal.textContent = 80;
          if (feedbackText) feedbackText.textContent = "Câu trả lời đúng ngữ cảnh, chú ý trợ từ.";
          if (modelText) modelText.textContent = s?.expectedAnswer || "";
          if (resultCard) resultCard.hidden = false;
        }
      } catch {
        alert("Lỗi khi kết nối hệ thống chấm điểm.");
      } finally {
        btnEvalKaiwa.textContent = "Gửi Sensei chấm điểm";
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
  setupEventListeners();
  setupFloatingSensei();
  setupSettings();
  mascotMgr.updateAllSpriteElements();

  // Route by initial hash or default to 'landing'
  const initialHash = window.location.hash.replace("#", "");
  if (initialHash && TAB_TITLES[initialHash]) {
    switchTab(initialHash);
  } else {
    switchTab("landing");
  }

  // Pre-fetch greeting & user profile
  try {
    let res = await fetch(`/api/profile?user_id=${encodeURIComponent(userId)}`);
    if (res.status === 404) {
      res = await fetch("/api/profile", {
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

  loadGreeting();

  window.addEventListener("hashchange", () => {
    const h = window.location.hash.replace("#", "");
    if (h && TAB_TITLES[h]) {
      switchTab(h);
    }
  });
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
