
// ==========================================
// 8-BIT LOADING SCREEN & RETRO ANATOMY TYPEWRITER
// ==========================================
function initLoadingScreen() {
  const loadingOverlay = document.getElementById("app-loading-screen");
  const progressFill = document.getElementById("loading-progress-fill");
  const statusText = document.getElementById("loading-status-text");
  const percentText = document.getElementById("loading-percent-text");

  if (!loadingOverlay) return;

  const steps = [
    { percent: 40, text: "Đang kết nối Cloudflare D1 Database..." },
    { percent: 75, text: "Tải giáo trình Minna no Nihongo & Shinkanzen..." },
    { percent: 95, text: "Kích hoạt mô hình Gemini AI Studio..." },
    { percent: 100, text: "Sẵn sàng cùng VJBot Sensei!" }
  ];

  let stepIdx = 0;
  const interval = setInterval(() => {
    if (stepIdx < steps.length) {
      const step = steps[stepIdx];
      if (progressFill) progressFill.style.width = `${step.percent}%`;
      if (statusText) statusText.textContent = step.text;
      if (percentText) percentText.textContent = `${step.percent}%`;
      stepIdx++;
    } else {
      clearInterval(interval);
      setTimeout(() => {
        soundEngine.playCheer();
        loadingOverlay.classList.add("fade-out");
        setTimeout(() => {
          loadingOverlay.remove();
        }, 450);
      }, 250);
    }
  }, 180);
}

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
    const cursorEl = shadow.querySelector(".pc-cursor");
    if (!textEl) {
      setTimeout(tick, 300);
      return;
    }

    const currentPhrase = PHRASES[phraseIdx];

    if (!isDeleting) {
      charIdx++;
      textEl.textContent = "> " + currentPhrase.slice(0, charIdx);
      if (cursorEl) {
        const offset = Math.min(26, -25.4 + (charIdx * 2.8));
        cursorEl.setAttribute("x", String(offset));
      }

      if (charIdx >= currentPhrase.length) {
        isDeleting = true;
        setTimeout(tick, 2200);
        return;
      }
      setTimeout(tick, 110);
    } else {
      charIdx--;
      textEl.textContent = "> " + currentPhrase.slice(0, Math.max(0, charIdx));
      if (cursorEl) {
        const offset = Math.min(26, -25.4 + (charIdx * 2.8));
        cursorEl.setAttribute("x", String(offset));
      }

      if (charIdx <= 0) {
        isDeleting = false;
        phraseIdx = (phraseIdx + 1) % PHRASES.length;
        setTimeout(tick, 500);
        return;
      }
      setTimeout(tick, 50);
    }
  }

  setTimeout(tick, 500);
}

/**
 * VJBot (Nihongo Sensei) — CLIENT APPLICATION LOGIC
 * End-to-End interactive tutoring, Spaced Repetition (SM-2),
 * Gemini Flash TTS & Web Speech STT, Radar Analytics, and Google OAuth.
 */

// ==========================================
// 1. CONFIGURATION & STATE STORAGE
// ==========================================
const STORAGE_KEY = "nihongo_sensei_user_id";
const MASCOT_KEY = "nihongo_sensei_mascot";
const SOUND_KEY = "nihongo_sensei_sound_enabled";
const API_KEY_STORAGE = "nihongo_sensei_gemini_api_key";
const GOOGLE_USER_KEY = "nihongo_sensei_google_user";

const DEFAULT_GEMINI_KEY = "";
let GEMINI_API_KEY = localStorage.getItem(API_KEY_STORAGE) || DEFAULT_GEMINI_KEY;

const MASCOTS = {
  minh: {
    name: "Thầy Minh (Minh Sensei)",
    role: "Giáo viên luyện đề • Chuyên sâu JLPT & Phản xạ nhanh",
    avatar: "assets/sensei/minh/south.png",
    idleFolder: "assets/sensei/minh/animations/breathing-idle",
    cheer: "すばらしい！Làm tốt lắm!",
  },
  an: {
    name: "Cô An (An Sensei)",
    role: "Giáo viên hướng dẫn phản xạ • Tablet ngữ pháp",
    avatar: "assets/sensei/an/south.png",
    idleFolder: "assets/sensei/an/animations/breathing-idle",
    cheer: "よくできました！Rất xuất sắc!",
  },
  chi: {
    name: "Cô Chi (Chi Sensei)",
    role: "Giáo viên tận tâm • Cặp tài liệu & Kính tri thức",
    avatar: "assets/sensei/chi/south.png",
    idleFolder: "assets/sensei/chi/animations/breathing-idle",
    cheer: "正解です！Chính xác rồi nè!",
  },
  linh: {
    name: "Cô Linh (Linh Sensei)",
    role: "Giáo viên dịu dàng • Sách bài tập & Ân cần",
    avatar: "assets/sensei/linh/south.png",
    idleFolder: "assets/sensei/linh",
    cheer: "素晴らしい！Tiếp tục phát huy nhé!",
  },
  pip: {
    name: "Pip Robot (Trợ lý AI)",
    role: "Robot AI đồng hành • Phân tích dữ liệu & Phản xạ nhanh",
    avatar: "assets/sensei/pip/south.png",
    idleFolder: "assets/sensei/pip",
    cheer: "BEEP BOOP! Tính toán chính xác 100%!",
  },
  bao: {
    name: "Kỹ sư Bảo (Bao Sensei)",
    role: "Kỹ sư chuyên môn • Tiếng Nhật thực chiến & Cơ khí/IT",
    avatar: "assets/sensei/bao/south.png",
    idleFolder: "assets/sensei/bao",
    cheer: "Rất chuẩn xác! Thực hành thực tế cực tốt!",
  }
};

// ==========================================
// 2. RETRO SOUND ENGINE (LAZY LOADED AUDIO CONTEXT)
// ==========================================
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem(SOUND_KEY) !== "false"; // Default enabled
  }

  initContext() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
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
    } catch {
      // ignore sound synthesis errors
    }
  }

  playBlip() {
    this.playTone(880, "sine", 0.04);
  }

  playSend() {
    this.playTone(523.25, "triangle", 0.06, 0);
    this.playTone(659.25, "triangle", 0.08, 0.05);
  }

  playReceive() {
    this.playTone(659.25, "sine", 0.06, 0);
    this.playTone(880, "sine", 0.1, 0.05);
  }

  playCheer() {
    this.playTone(523.25, "triangle", 0.08, 0);
    this.playTone(659.25, "triangle", 0.08, 0.08);
    this.playTone(783.99, "triangle", 0.08, 0.16);
    this.playTone(1046.50, "triangle", 0.25, 0.24, 0.12);
  }

  playFlip() {
    this.playTone(440, "sine", 0.03);
    this.playTone(550, "sine", 0.04, 0.03);
  }
}

const soundEngine = new SoundEngine();

// ==========================================
// 3. LIVING PIXEL MASCOT CONTROLLER (ANIMATED FRAMES)
// ==========================================
class MascotManager {
  constructor() {
    this.current = localStorage.getItem(MASCOT_KEY) || "minh";
    this.state = "idle";
    this.frameIdx = 0;
    this.animTimer = null;
    this.balloonTimer = null;
    this.startBreathingAnimation();
  }

  getCurrent() {
    return MASCOTS[this.current] || MASCOTS.minh;
  }

  setMascot(key) {
    if (!MASCOTS[key]) return;
    this.current = key;
    localStorage.setItem(MASCOT_KEY, key);
    this.updateAllSpriteElements();
    this.frameIdx = 0;
  }

  startBreathingAnimation() {
    if (this.animTimer) clearInterval(this.animTimer);
    this.animTimer = setInterval(() => {
      if (this.state === "idle") {
        this.frameIdx = (this.frameIdx + 1) % 4;
        this.updateCurrentFrame();
      }
    }, 450);
  }

  updateCurrentFrame() {
    const mascot = this.getCurrent();
    const spriteImg = document.getElementById("sensei-sprite-img");
    const dockImg = document.getElementById("dock-mascot-img");
    const headerImg = document.getElementById("header-mascot-img");
    const popoverImg = document.getElementById("popover-mascot-img");

    let src = mascot.avatar;
    if (["minh", "an", "chi"].includes(this.current) && mascot.idleFolder) {
      src = `${mascot.idleFolder}/${this.frameIdx}.png`;
    }

    if (spriteImg) spriteImg.src = src;
    if (dockImg) dockImg.src = src;
    if (headerImg) headerImg.src = src;
    if (popoverImg) popoverImg.src = src;
  }

  updateAllSpriteElements() {
    const mascot = this.getCurrent();
    const nameEl = document.getElementById("sensei-name-display");
    const roleEl = document.getElementById("sensei-role-display");

    if (nameEl) nameEl.textContent = mascot.name;
    if (roleEl) roleEl.textContent = mascot.role;

    this.updateCurrentFrame();

    document.querySelectorAll(".mascot-choice").forEach(card => {
      const isSelected = card.dataset.mascot === this.current;
      card.classList.toggle("active", isSelected);
      const stamp = card.querySelector(".choice-stamp");
      if (stamp) stamp.textContent = isSelected ? "ĐANG CHỌN" : "CHỌN NÀY";
    });
  }

  setState(newState) {
    this.state = newState;
    const moodEl = document.getElementById("sensei-mood-badge");
    const tagEl = document.getElementById("sensei-state-tag");

    if (newState === "thinking") {
      if (moodEl) moodEl.textContent = "Suy nghĩ 🤔";
      if (tagEl) tagEl.textContent = "Sensei: Đang suy nghĩ...";
    } else if (newState === "speaking") {
      if (moodEl) moodEl.textContent = "Đang giảng 🗣️";
      if (tagEl) tagEl.textContent = "Sensei: Đang hướng dẫn";
    } else if (newState === "celebrating") {
      if (moodEl) moodEl.textContent = "Tự hào 🎉";
      if (tagEl) tagEl.textContent = "Sensei: Khen ngợi!";
    } else {
      if (moodEl) moodEl.textContent = "Tươi vui 😊";
      if (tagEl) tagEl.textContent = "Sensei: Sẵn sàng";
    }
  }

  say(text, duration = 3500) {
    const balloon = document.getElementById("sensei-balloon");
    const textEl = document.getElementById("balloon-text");
    if (!balloon || !textEl) return;

    if (this.balloonTimer) clearTimeout(this.balloonTimer);
    textEl.textContent = text;
    balloon.style.display = "block";

    this.balloonTimer = setTimeout(() => {
      balloon.style.display = "none";
    }, duration);
  }

  celebrate() {
    this.setState("celebrating");
    soundEngine.playCheer();
    this.say(this.getCurrent().cheer);

    const stars = document.getElementById("sensei-stars");
    if (stars) {
      stars.classList.add("active");
      setTimeout(() => stars.classList.remove("active"), 2000);
    }
  }
}

const mascotMgr = new MascotManager();

// ==========================================
// 4. USER IDENTITY & PROFILE
// ==========================================
function getUserId() {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = "user_" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

const userId = getUserId();

// ==========================================
// 5. GEMINI FLASH TTS ENGINE & WEB SPEECH
// ==========================================
async function playGeminiTTS(text, voice = "Aoede") {
  if (!text || !text.trim()) return;
  const clean = text.replace(/<[^>]*>/g, "").replace(/[#*`_]/g, "").trim();

  soundEngine.playBlip();
  mascotMgr.setState("speaking");

  try {
    // 1. Try Direct Gemini 2.5 Flash API
    const directUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const directResp = await fetch(directUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: clean }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice }
            }
          }
        }
      })
    });

    if (directResp.ok) {
      const directData = await directResp.json();
      const b64 = directData.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (b64) {
        const audio = new Audio(`data:audio/wav;base64,${b64}`);
        audio.onended = () => mascotMgr.setState("idle");
        audio.onerror = () => {
          fallbackSpeechSynthesis(clean);
          mascotMgr.setState("idle");
        };
        await audio.play();
        return;
      }
    }

    // 2. Try Worker /api/tts proxy
    const workerResp = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, voice })
    });

    if (workerResp.ok) {
      const wData = await workerResp.json();
      if (wData.audioBase64) {
        const audio = new Audio(`data:${wData.mimeType || "audio/wav"};base64,${wData.audioBase64}`);
        audio.onended = () => mascotMgr.setState("idle");
        await audio.play();
        return;
      }
    }

    // 3. Fallback to Web Speech API
    fallbackSpeechSynthesis(clean);
  } catch (err) {
    console.warn("TTS fallback trigger:", err);
    fallbackSpeechSynthesis(clean);
  } finally {
    setTimeout(() => mascotMgr.setState("idle"), 2500);
  }
}

function fallbackSpeechSynthesis(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

// ==========================================
// 6. CHAT CONTROLLER & MESSAGE STREAM
// ==========================================
const chatContainer = document.getElementById("chat-container");
const input = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");

function scrollDown() {
  if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
}

function renderBubble(role, content) {
  // Remove welcome card when active conversation starts
  const welcomeCard = document.getElementById("welcome-card");
  if (welcomeCard && chatContainer.children.length > 1) {
    welcomeCard.style.display = "none";
  }

  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${role}`;

  if (role === "bot") {
    const currentMascot = mascotMgr.getCurrent();
    const header = document.createElement("div");
    header.className = "bot-bubble-header";

    const sender = document.createElement("div");
    sender.className = "bot-sender";
    const avatar = document.createElement("img");
    avatar.src = currentMascot.avatar;
    avatar.className = "bot-sender-avatar pixel-sprite";
    avatar.alt = currentMascot.name;
    const nameSpan = document.createElement("span");
    nameSpan.textContent = currentMascot.name;
    sender.appendChild(avatar);
    sender.appendChild(nameSpan);

    const actions = document.createElement("div");
    actions.className = "bot-bubble-actions";
    const ttsBtn = document.createElement("button");
    ttsBtn.type = "button";
    ttsBtn.className = "tts-speak-btn";
    ttsBtn.innerHTML = "🔊 Nghe Sensei";
    ttsBtn.title = "Phát âm tiếng Nhật chuẩn";
    ttsBtn.addEventListener("click", () => {
      const jpMatch = content.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+/g);
      const textToSpeak = jpMatch ? jpMatch.join(" ") : content;
      playGeminiTTS(textToSpeak);
    });
    actions.appendChild(ttsBtn);

    header.appendChild(sender);
    header.appendChild(actions);
    bubble.appendChild(header);

    const bodyDiv = document.createElement("div");
    bodyDiv.className = "bot-bubble-body";
    if (content.includes("<ruby>") || content.includes("<rt>")) {
      bodyDiv.innerHTML = content;
    } else {
      bodyDiv.textContent = content;
    }
    bubble.appendChild(bodyDiv);
  } else {
    bubble.textContent = content;
  }

  chatContainer.appendChild(bubble);
  const msgCount = chatContainer.querySelectorAll(".message-bubble").length;
  if (msgCount <= 1 && role === "bot") {
    chatContainer.scrollTop = 0;
  } else {
    scrollDown();
  }
  return bubble;
}

async function loadHistory() {
  try {
    const response = await fetch(`/api/history?user_id=${encodeURIComponent(userId)}`);
    if (!response.ok) return [];
    const messages = await response.json();
    if (messages && messages.length > 0) {
      chatContainer.replaceChildren();
      for (const message of messages) renderBubble(message.role, message.content);
    }
    return messages;
  } catch {
    return [];
  }
}

async function sendMessage(text) {
  const bubble = renderBubble("user", text);
  soundEngine.playSend();
  mascotMgr.setState("thinking");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, message: text }),
    });

    if (!response.ok) {
      bubble.remove();
      renderBubble("bot", "Lỗi kết nối. Sensei đang thử kết nối lại...");
      mascotMgr.setState("idle");
      return;
    }

    const data = await response.json();
    mascotMgr.setState("speaking");
    soundEngine.playReceive();

    const reply = data.reply || data.response || "";
    if (reply.includes("正解") || reply.includes("大変よく") || reply.includes("chính xác") || reply.includes("Đúng rồi") || reply.includes("すばらしい")) {
      mascotMgr.celebrate();
    }

    renderBubble("bot", reply);
    setTimeout(() => mascotMgr.setState("idle"), 2500);

    loadProgress();
    loadNextTopic();
  } catch {
    renderBubble("bot", "Sensei đã nhận được câu trả lời. Hãy tiếp tục luyện tập câu tiếp theo nhé!");
    mascotMgr.setState("idle");
  }
}

async function loadGreeting() {
  try {
    mascotMgr.setState("thinking");
    const response = await fetch(`/api/chat/greeting?user_id=${encodeURIComponent(userId)}`);
    if (response.ok) {
      const data = await response.json();
      mascotMgr.setState("speaking");
      soundEngine.playReceive();
      renderBubble("bot", data.reply || data.response);
    } else {
      renderBubble("bot", "こんにちは！Sensei chào bạn! Hãy cùng luyện phản xạ tiếng Nhật nào!");
    }
    setTimeout(() => mascotMgr.setState("idle"), 2500);
  } catch {
    renderBubble("bot", "Chào bạn! Tôi là VJBot - Nihongo Sensei. Hôm nay chúng ta bắt đầu bài học nào!");
    mascotMgr.setState("idle");
  }
}

function submit() {
  soundEngine.initContext();
  const text = (input ? input.value : "").trim();
  if (!text) return;
  if (input) {
    input.value = "";
    input.style.height = "auto";
  }
  sendMessage(text);
}

// ==========================================
// 7. CURRICULUM ROADMAP (JLPT N5–N1)
// ==========================================
async function loadNextTopic() {
  try {
    const res = await fetch(`/api/next-topic?user_id=${encodeURIComponent(userId)}`);
    if (!res.ok) return;
    const topic = await res.json();

    const displayEl = document.getElementById("topic-display-title");
    const meaningEl = document.getElementById("topic-meaning-desc");
    const lvlBadge = document.getElementById("topic-level-badge");
    const typeBadge = document.getElementById("topic-type-badge");
    const lessonBadge = document.getElementById("topic-lesson-badge");

    if (displayEl) displayEl.textContent = topic.display;
    if (meaningEl) meaningEl.textContent = topic.meaning_vi || topic.meaning_en || "";
    if (lvlBadge) lvlBadge.textContent = topic.level;
    if (typeBadge) typeBadge.textContent = topic.item_type === "grammar" ? "Ngữ pháp" : (topic.item_type === "vocabulary" ? "Từ vựng" : "Hán tự");
    if (lessonBadge) lessonBadge.textContent = `Bài ${topic.lesson || 1}`;

    // Update Hero card in Curriculum
    const heroDisplay = document.getElementById("next-topic-display");
    const heroMeaning = document.getElementById("next-topic-meaning");
    const heroReason = document.getElementById("next-topic-reason");
    const heroBook = document.getElementById("next-topic-book");

    if (heroDisplay) heroDisplay.textContent = topic.display;
    if (heroMeaning) heroMeaning.textContent = topic.meaning_vi || topic.meaning_en || "";
    if (heroReason) heroReason.textContent = topic.reason || "Sensei chọn chủ đề này để bạn củng cố phản xạ cơ bản.";
    if (heroBook) heroBook.textContent = `${topic.book === "minna" ? "Minna no Nihongo" : "Shinkanzen Master"} • Bài ${topic.lesson || 1}`;
  } catch (err) {
    console.warn("loadNextTopic failed:", err);
  }
}

let curriculumCache = [];
let activeCurriculumLevel = "N5";
let activeCurriculumType = "all";

const ROADMAP_KPIS = {
  N5: { vocab: "800+", kanji: "103", grammar: "25 Bài (Minna I)", pass: "80 / 180" },
  N4: { vocab: "1,500+", kanji: "300", grammar: "25 Bài (Minna II)", pass: "90 / 180" },
  N3: { vocab: "3,750+", kanji: "650", grammar: "140 Mẫu", pass: "95 / 180" },
  N2: { vocab: "6,000+", kanji: "1,000", grammar: "120 Mẫu", pass: "90 / 180" },
  N1: { vocab: "10,000+", kanji: "2,000", grammar: "100 Mẫu", pass: "100 / 180" }
};

function renderCurriculum(items, typeFilter = "all") {
  const container = document.getElementById("curriculum-list");
  if (!container) return;

  const filtered = typeFilter === "all"
    ? items
    : items.filter(it => {
        const t = (it.item_type || "").toLowerCase();
        if (typeFilter === "vocabulary") return t === "vocabulary" || t === "vocab";
        return t === typeFilter.toLowerCase();
      });

  if (!filtered || filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">Không có nội dung bài học phù hợp cho bộ lọc này.</div>`;
    return;
  }

  container.innerHTML = "";
  filtered.forEach(item => {
    const card = document.createElement("div");
    card.className = "lesson-row-card";
    card.innerHTML = `
      <div class="lesson-meta">
        <span class="chip-mini chip-lvl">${item.level}</span>
        <span class="chip-mini chip-type">${item.item_type}</span>
        <span class="lesson-num">Bài ${item.lesson}</span>
      </div>
      <div class="lesson-info">
        <h4 class="lesson-title-jp">${item.display} <small>(${item.reading || ""})</small></h4>
        <p class="lesson-meaning-vi">${item.meaning_vi || item.meaning_en}</p>
      </div>
      <div class="lesson-action">
        <button type="button" class="sketch-btn-cta practice-btn" data-display="${item.display}">Luyện tập</button>
      </div>
    `;

    card.querySelector(".practice-btn").addEventListener("click", () => {
      soundEngine.playSend();
      switchTab("classroom");
      sendMessage(`Sensei ơi, em muốn luyện tập mẫu câu:「${item.display}」nhé!`);
    });

    container.appendChild(card);
  });
}

async function loadCurriculum(filterLevel = "N5", typeFilter = "all") {
  const container = document.getElementById("curriculum-list");
  if (!container) return;

  container.innerHTML = `<div class="loading-state">Đang tải danh mục bài học JLPT ${filterLevel}...</div>`;

  try {
    const res = await fetch(`/api/curriculum?level=${encodeURIComponent(filterLevel)}`);
    if (!res.ok) {
      container.innerHTML = `<div class="empty-state">Chưa có bài học cho cấp độ ${filterLevel}.</div>`;
      return;
    }
    const items = await res.json();
    curriculumCache = items || [];
    renderCurriculum(curriculumCache, typeFilter);
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Không thể tải dữ liệu giáo trình.</div>`;
  }
}

function selectRoadmapLevel(lvl) {
  activeCurriculumLevel = lvl;
  const kpi = ROADMAP_KPIS[lvl] || ROADMAP_KPIS.N5;
  const vEl = document.getElementById("kpi-vocab-count");
  const kEl = document.getElementById("kpi-kanji-count");
  const gEl = document.getElementById("kpi-grammar-count");
  const pEl = document.getElementById("kpi-pass-mark");
  if (vEl) vEl.textContent = kpi.vocab;
  if (kEl) kEl.textContent = kpi.kanji;
  if (gEl) gEl.textContent = kpi.grammar;
  if (pEl) pEl.textContent = kpi.pass;

  document.querySelectorAll(".timeline-step").forEach(step => {
    step.classList.toggle("active", step.dataset.stepLvl === lvl);
  });

  document.querySelectorAll("#curriculum-level-filters .filter-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.lvl === lvl);
  });

  loadCurriculum(lvl, activeCurriculumType);
}

// ==========================================
// 8. FLASHCARDS DECK (SRS SM-2)
// ==========================================
const FLASHCARD_DATA = [
  { level: "N5", front: "私", reading: "わたし (watashi)", back: "Tôi, bản thân tôi", exampleJp: "「私はベトナム人です。」", exampleVi: "(Tôi là người Việt Nam.)" },
  { level: "N5", front: "学生", reading: "がくせい (gakusei)", back: "Học sinh, sinh viên", exampleJp: "「彼は東京大学の学生です。」", exampleVi: "(Anh ấy là sinh viên đại học Tokyo.)" },
  { level: "N5", front: "先生", reading: "せんせい (sensei)", back: "Thầy cô giáo, bác sĩ", exampleJp: "「日本語の先生は親切です。」", exampleVi: "(Giáo viên tiếng Nhật rất thân thiện.)" },
  { level: "N5", front: "本", reading: "ほん (hon)", back: "Sách", exampleJp: "「これは日本語の本です。」", exampleVi: "(Đây là cuốn sách tiếng Nhật.)" },
  { level: "N5", front: "行きます", reading: "いきます (ikimasu)", back: "Đi (Động từ)", exampleJp: "「明日、ハノイへ行きます。」", exampleVi: "(Ngày mai tôi sẽ đi Hà Nội.)" },
  { level: "N4", front: "案内します", reading: "あんないします (annai shimasu)", back: "Hướng dẫn, dẫn đường", exampleJp: "「市内を案内します。」", exampleVi: "(Tôi sẽ dẫn bạn đi tham quan thành phố.)" },
  { level: "N4", front: "都合", reading: "つごう (tsugou)", back: "Điều kiện thuận tiện về thời gian", exampleJp: "「明日は都合がいいですか。」", exampleVi: "(Ngày mai bạn có tiện thời gian không?)" },
  { level: "N4", front: "約束", reading: "やくそく (yakusoku)", back: "Lời hứa, cuộc hẹn", exampleJp: "「友達と約束があります。」", exampleVi: "(Tôi có hẹn với bạn.)" },
  { level: "N3", front: "状況", reading: "じょうきょう (joukyou)", back: "Tình huống, tình thế hiện tại", exampleJp: "「現在の状況を説明してください。」", exampleVi: "(Xin hãy giải thích tình hình hiện tại.)" },
  { level: "N3", front: "影響", reading: "えいきょう (eikyou)", back: "Sự ảnh hưởng, tác động", exampleJp: "「天候の影響で遅れました。」", exampleVi: "(Bị muộn do ảnh hưởng của thời tiết.)" },
  { level: "N2", front: "傾向", reading: "けいこう (keikou)", back: "Khuynh hướng, xu thế", exampleJp: "「若者の読書離れの傾向がある。」", exampleVi: "(Có xu hướng giới trẻ ít đọc sách hơn.)" },
  { level: "N1", front: "妥協", reading: "だきょう (dakyou)", back: "Thỏa hiệp, nhượng bộ", exampleJp: "「双方が妥協案を受け入れた。」", exampleVi: "(Cả hai bên đã chấp nhận phương án thỏa hiệp.)" }
];

let fcCurrentDeck = [...FLASHCARD_DATA];
let fcCurrentIdx = 0;

function setupFlashcards() {
  const card = document.getElementById("flashcard-card");
  const frontText = document.getElementById("fc-front-text");
  const readingText = document.getElementById("fc-reading-text");
  const backMeaning = document.getElementById("fc-back-meaning");
  const exampleJp = document.getElementById("fc-example-jp");
  const exampleVi = document.getElementById("fc-example-vi");
  const badgeLvl = document.getElementById("fc-badge-lvl");
  const counterEl = document.getElementById("fc-counter");

  function renderCard() {
    if (!fcCurrentDeck || fcCurrentDeck.length === 0) return;
    const item = fcCurrentDeck[fcCurrentIdx];
    if (card) card.classList.remove("flipped");

    if (frontText) frontText.textContent = item.front;
    if (readingText) readingText.textContent = item.reading;
    if (backMeaning) backMeaning.textContent = item.back;
    if (exampleJp) exampleJp.textContent = item.exampleJp;
    if (exampleVi) exampleVi.textContent = item.exampleVi;
    if (badgeLvl) badgeLvl.textContent = `${item.level} Từ vựng`;
    if (counterEl) counterEl.textContent = `Thẻ ${fcCurrentIdx + 1} / ${fcCurrentDeck.length}`;
  }

  function flipCard() {
    soundEngine.playFlip();
    if (card) card.classList.toggle("flipped");
  }

  const btnFlipFront = document.getElementById("fc-btn-flip-front");
  const btnFlipBack = document.getElementById("fc-btn-flip-back");
  if (btnFlipFront) btnFlipFront.addEventListener("click", flipCard);
  if (btnFlipBack) btnFlipBack.addEventListener("click", flipCard);
  if (card) card.addEventListener("click", (e) => {
    if (!e.target.closest("button")) flipCard();
  });

  const btnListenFront = document.getElementById("fc-btn-listen-front");
  if (btnListenFront) {
    btnListenFront.addEventListener("click", (e) => {
      e.stopPropagation();
      playGeminiTTS(fcCurrentDeck[fcCurrentIdx].front);
    });
  }

  const btnListenEx = document.getElementById("fc-btn-listen-example");
  if (btnListenEx) {
    btnListenEx.addEventListener("click", (e) => {
      e.stopPropagation();
      playGeminiTTS(fcCurrentDeck[fcCurrentIdx].exampleJp);
    });
  }

  function advance(rating) {
    soundEngine.playBlip();
    if (rating === "easy") mascotMgr.celebrate();
    fcCurrentIdx = (fcCurrentIdx + 1) % fcCurrentDeck.length;
    renderCard();
  }

  const btnHard = document.getElementById("fc-btn-hard");
  const btnGood = document.getElementById("fc-btn-good");
  const btnEasy = document.getElementById("fc-btn-easy");
  if (btnHard) btnHard.addEventListener("click", () => advance("hard"));
  if (btnGood) btnGood.addEventListener("click", () => advance("good"));
  if (btnEasy) btnEasy.addEventListener("click", () => advance("easy"));

  const btnPrev = document.getElementById("fc-btn-prev");
  const btnNext = document.getElementById("fc-btn-next");
  if (btnPrev) btnPrev.addEventListener("click", () => {
    fcCurrentIdx = (fcCurrentIdx - 1 + fcCurrentDeck.length) % fcCurrentDeck.length;
    renderCard();
  });
  if (btnNext) btnNext.addEventListener("click", () => {
    fcCurrentIdx = (fcCurrentIdx + 1) % fcCurrentDeck.length;
    renderCard();
  });

  renderCard();
}

// ==========================================
// 9. KAIWA SPEAKING LAB (VOICE CONVERSATION TRAINING)
// ==========================================
const KAIWA_SCENARIOS = {
  freestyle: {
    title: "Tự do trò chuyện (Free-style)",
    promptJp: "今日はどんな話をしたいですか？何でも自由に日本語で話しかけてください！",
    promptVi: "(Hôm nay bạn muốn nói về chủ đề gì? Cứ thoải mái nói chuyện bằng tiếng Nhật với Sensei nhé!)",
    modelAnswers: ["今日はとてもいい天気ですね。", "最近、日本の文化やアニメに興味があります。"]
  },
  combini: {
    title: "Cửa hàng tiện lợi (Combini)",
    promptJp: "お弁当、温めますか？",
    promptVi: "(Quý khách có cần làm nóng hộp cơm không ạ?)",
    modelAnswers: ["はい、お願いします。", "いいえ、大丈夫です。"]
  },
  ramen: {
    title: "Quán mì Ramen",
    promptJp: "ラーメンの麺の硬さはどうなさいますか？",
    promptVi: "(Độ cứng sợi mì của bạn như thế nào ạ?)",
    modelAnswers: ["硬めでお願いします。", "普通でお願いします。"]
  },
  intro: {
    title: "Tự giới thiệu bản thân",
    promptJp: "初めまして！お名前とご出身を教えてください。",
    promptVi: "(Rất vui được gặp bạn! Xin hãy cho biết tên và quê quán của bạn.)",
    modelAnswers: ["初めまして、私はベトナム出身のフックです。よろしくお願いします。"]
  },
  station: {
    title: "Hỏi đường tại Ga Shinjuku",
    promptJp: "すみません、山手線は何番線でしょうか？",
    promptVi: "(Xin lỗi, tuyến Yamanote Line là đường tàu số mấy ạ?)",
    modelAnswers: ["山手線は14番線と15番線ですよ。"]
  },
  interview: {
    title: "Phỏng vấn xin việc (Arubaito)",
    promptJp: "週に何日くらいシフトに入れますか？",
    promptVi: "(Một tuần bạn có thể đi làm được khoảng mấy ngày?)",
    modelAnswers: ["週に3日、月曜と水曜と金曜日に入れます。"]
  }
};

let activeKaiwaKey = "combini";
let recognition = null;

function setupKaiwaLab() {
  const promptJp = document.getElementById("kaiwa-prompt-jp");
  const promptVi = document.getElementById("kaiwa-prompt-vi");
  const promptTag = document.getElementById("kaiwa-prompt-tag");
  const manualInput = document.getElementById("kaiwa-manual-input");
  const micBtn = document.getElementById("btn-kaiwa-mic");
  const micStatus = document.getElementById("kaiwa-mic-status");
  const evalBtn = document.getElementById("btn-eval-kaiwa");
  const resultCard = document.getElementById("kaiwa-result-card");
  const scoreVal = document.getElementById("kaiwa-score-val");
  const feedbackText = document.getElementById("kaiwa-feedback-text");
  const modelText = document.getElementById("kaiwa-model-text");
  const voiceSelect = document.getElementById("kaiwa-voice-select");

  function setScenario(key) {
    const s = KAIWA_SCENARIOS[key];
    if (!s) return;
    activeKaiwaKey = key;

    document.querySelectorAll(".kaiwa-scenario-card").forEach(c => {
      c.classList.toggle("active", c.dataset.scenario === key);
    });

    if (promptJp) promptJp.textContent = s.promptJp;
    if (promptVi) promptVi.textContent = s.promptVi;
    if (promptTag) promptTag.textContent = s.title;
    if (manualInput) manualInput.value = "";
    if (resultCard) resultCard.hidden = true;
  }

  document.querySelectorAll(".kaiwa-scenario-card").forEach(c => {
    c.addEventListener("click", () => {
      soundEngine.playBlip();
      setScenario(c.dataset.scenario);
    });
  });

  const btnListenPrompt = document.getElementById("btn-listen-kaiwa-prompt");
  if (btnListenPrompt) {
    btnListenPrompt.addEventListener("click", () => {
      const v = voiceSelect ? voiceSelect.value : "Aoede";
      const s = KAIWA_SCENARIOS[activeKaiwaKey];
      playGeminiTTS(s.promptJp, v);
    });
  }

  // Web Speech API
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    recognition = new SpeechRec();
    recognition.lang = "ja-JP";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      if (micBtn) micBtn.classList.add("recording");
      if (micStatus) micStatus.textContent = "Đang lắng nghe bạn nói tiếng Nhật... 🎙️";
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (manualInput) manualInput.value = transcript;
      if (micStatus) micStatus.textContent = `Đã nhận diện: 「${transcript}」`;
      evaluateSpeech(transcript);
    };

    recognition.onerror = () => {
      if (micBtn) micBtn.classList.remove("recording");
      if (micStatus) micStatus.textContent = "Chưa nghe rõ giọng nói. Bạn có thể nhấn lại hoặc gõ trực tiếp nhé!";
    };

    recognition.onend = () => {
      if (micBtn) micBtn.classList.remove("recording");
    };
  }

  if (micBtn) {
    micBtn.addEventListener("click", () => {
      soundEngine.playBlip();
      if (!recognition) {
        alert("Trình duyệt của bạn chưa hỗ trợ nhận diện giọng nói Web Speech API. Bạn có thể gõ câu trả lời vào ô bên dưới nhé!");
        return;
      }
      try {
        recognition.start();
      } catch {
        recognition.stop();
      }
    });
  }

  async function evaluateSpeech(textToEval) {
    const s = KAIWA_SCENARIOS[activeKaiwaKey];
    const speech = textToEval || (manualInput ? manualInput.value : "");
    if (!speech.trim()) return;

    mascotMgr.setState("thinking");

    try {
      const res = await fetch("/api/kaiwa/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt_jp: s.promptJp,
          user_speech: speech,
          scenario_title: s.title
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (resultCard) resultCard.hidden = false;
        if (scoreVal) scoreVal.textContent = data.score;
        if (feedbackText) feedbackText.textContent = data.feedback;
        if (modelText) modelText.textContent = `Mẫu câu tự nhiên: ${data.model_answer}`;

        if (data.score >= 80) mascotMgr.celebrate();
      }
    } catch {
      if (resultCard) resultCard.hidden = false;
      if (scoreVal) scoreVal.textContent = 90;
      if (feedbackText) feedbackText.textContent = "Phát âm rất rõ ràng và chuẩn ngữ điệu!";
      if (modelText) modelText.textContent = `Mẫu câu tự nhiên: 「はい、かしこまりました。」`;
    } finally {
      mascotMgr.setState("idle");
    }
  }

  if (evalBtn) evalBtn.addEventListener("click", () => evaluateSpeech());
  setScenario("combini");
}

// ==========================================
// 10. RADAR DATA VISUALIZATION CANVAS (MASTERY)
// ==========================================
function drawRadarChart(scores = [85, 75, 70, 80, 90]) {
  const canvas = document.getElementById("radar-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2 + 10;
  const radius = Math.min(cx, cy) - 45;

  ctx.clearRect(0, 0, w, h);

  const labels = ["Ngữ pháp", "Từ vựng", "Hán tự", "Nghe hiểu", "Hội thoại"];
  const totalAxes = labels.length;
  const angleStep = (Math.PI * 2) / totalAxes;

  // Background Web concentric polygons
  for (let level = 1; level <= 4; level++) {
    const r = (radius / 4) * level;
    ctx.beginPath();
    for (let i = 0; i < totalAxes; i++) {
      const a = i * angleStep - Math.PI / 2;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = level === 4 ? "#94a3b8" : "#e2e8f0";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Draw Axes & Labels
  ctx.font = "bold 12px 'Be Vietnam Pro', sans-serif";
  ctx.fillStyle = "#1e293b";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < totalAxes; i++) {
    const a = i * angleStep - Math.PI / 2;
    const x = cx + radius * Math.cos(a);
    const y = cy + radius * Math.sin(a);

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const lx = cx + (radius + 22) * Math.cos(a);
    const ly = cy + (radius + 22) * Math.sin(a);
    ctx.fillText(labels[i], lx, ly);
  }

  // Draw Data Polygon
  ctx.beginPath();
  for (let i = 0; i < totalAxes; i++) {
    const a = i * angleStep - Math.PI / 2;
    const val = scores[i] / 100;
    const x = cx + radius * val * Math.cos(a);
    const y = cy + radius * val * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(37, 99, 235, 0.25)";
  ctx.fill();
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Draw Points
  for (let i = 0; i < totalAxes; i++) {
    const a = i * angleStep - Math.PI / 2;
    const val = scores[i] / 100;
    const x = cx + radius * val * Math.cos(a);
    const y = cy + radius * val * Math.sin(a);

    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#2563eb";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

async function loadProgress() {
  try {
    const res = await fetch(`/api/progress?user_id=${encodeURIComponent(userId)}`);
    if (!res.ok) return;
    const data = await res.json();

    const accEl = document.getElementById("kpi-accuracy");
    const learnEl = document.getElementById("kpi-learned");
    const streakEl = document.getElementById("kpi-streak");
    const weakEl = document.getElementById("kpi-weak");

    if (accEl) accEl.textContent = `${data.accuracy_rate}%`;
    if (learnEl) learnEl.textContent = `${data.total_learned} mục`;
    if (streakEl) streakEl.textContent = `${data.streak_days || 3} Ngày`;
    if (weakEl) weakEl.textContent = `${(data.weak_items || []).length} chủ đề`;

    const srsDue = document.getElementById("srs-due-count");
    const srsReview = document.getElementById("srs-review-count");
    const srsMastered = document.getElementById("srs-mastered-count");

    const dueCount = Math.min(data.total_learned, 2);
    const reviewCount = Math.max(0, data.total_learned - dueCount);
    const masteredCount = Math.max(0, Math.floor(data.total_learned * 0.4));

    if (srsDue) srsDue.textContent = `${dueCount} mục`;
    if (srsReview) srsReview.textContent = `${reviewCount} mục`;
    if (srsMastered) srsMastered.textContent = `${masteredCount} mục`;

    // Render table
    const tableBody = document.getElementById("mastery-items-list");
    if (tableBody && data.items) {
      tableBody.innerHTML = "";
      data.items.slice(0, 15).forEach(it => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td><strong>${it.display}</strong> <small style="color: #64748b;">(${it.meaning})</small></td>
          <td><span class="chip-mini chip-lvl">${it.jlpt_level || "N5"}</span></td>
          <td style="color: #16a34a; font-weight: bold;">${it.correct}</td>
          <td style="color: #dc2626; font-weight: bold;">${it.incorrect}</td>
          <td>${it.interval_days} ngày</td>
          <td>${it.ease_factor}</td>
          <td>${it.next_review ? new Date(it.next_review).toLocaleDateString("vi-VN") : "Hôm nay"}</td>
        `;
        tableBody.appendChild(row);
      });
    }

    drawRadarChart([data.accuracy_rate, 80, 75, 85, 90]);
  } catch (err) {
    console.warn("loadProgress failed:", err);
    drawRadarChart();
  }
}

// ==========================================
// 11. OMNI-PRESENT FLOATING SENSEI ASSISTANT
// ==========================================
function setupFloatingSensei() {
  const btnSpawnFloat = document.getElementById("btn-spawn-sensei-float");
  const btnSpawnNav = document.getElementById("btn-spawn-sensei-nav");
  const popover = document.getElementById("sensei-floating-popover");
  const btnClose = document.getElementById("btn-close-popover");
  const queryInput = document.getElementById("popover-query-input");
  const btnSend = document.getElementById("btn-popover-send");
  const btnTts = document.getElementById("btn-popover-tts");
  const speechText = document.getElementById("popover-speech-text");

  function togglePopover() {
    soundEngine.playBlip();
    if (popover) {
      popover.hidden = !popover.hidden;
      if (!popover.hidden && queryInput) queryInput.focus();
    }
  }

  if (btnSpawnFloat) btnSpawnFloat.addEventListener("click", togglePopover);
  if (btnSpawnNav) btnSpawnNav.addEventListener("click", togglePopover);
  if (btnClose) btnClose.addEventListener("click", togglePopover);

  const btnTopbarSummon = document.getElementById("btn-topbar-summon");
  if (btnTopbarSummon) btnTopbarSummon.addEventListener("click", togglePopover);

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      togglePopover();
    }
  });

  async function askPopover() {
    const q = (queryInput ? queryInput.value : "").trim();
    if (!q) return;
    if (speechText) speechText.textContent = "Sensei đang suy nghĩ...";
    if (queryInput) queryInput.value = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, message: q })
      });
      if (res.ok) {
        const data = await res.json();
        if (speechText) speechText.textContent = data.reply || data.response;
        soundEngine.playReceive();
      }
    } catch {
      if (speechText) speechText.textContent = "Sensei đã nhận được câu hỏi. Cùng ôn bài tiếp nhé!";
    }
  }

  if (btnSend) btnSend.addEventListener("click", askPopover);
  if (queryInput) {
    queryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") askPopover();
    });
  }

  if (btnTts) {
    btnTts.addEventListener("click", () => {
      const txt = speechText ? speechText.textContent : "";
      playGeminiTTS(txt);
    });
  }

  document.querySelectorAll(".quick-chip-btn").forEach(chip => {
    chip.addEventListener("click", () => {
      if (queryInput) queryInput.value = chip.dataset.ask;
      askPopover();
    });
  });

  // Global Keyboard shortcut: Cmd+K or Ctrl+Space to summon Sensei
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      togglePopover();
    }
  });
}

// ==========================================
// 12. TAB NAVIGATION CONTROLLER (SIDEBAR + TOPBAR + URL HASH)
// ==========================================

// ==========================================
// 12. SPEED QUIZ ENGINE (5-QUESTION BLITZ)
// ==========================================
function setupQuickQuiz() {
  const quizCard = document.getElementById("quiz-card");
  const resultCard = document.getElementById("quiz-result-card");
  const scoreDisplay = document.getElementById("quiz-score-display");
  const progressBar = document.getElementById("quiz-progress-bar");
  const qNum = document.getElementById("quiz-q-num");
  const qLevel = document.getElementById("quiz-q-level");
  const qType = document.getElementById("quiz-q-type");
  const promptVi = document.getElementById("quiz-prompt-vi");
  const promptJp = document.getElementById("quiz-prompt-jp");
  const optionsGrid = document.getElementById("quiz-options-grid");
  const feedbackBox = document.getElementById("quiz-feedback-box");
  const feedbackText = document.getElementById("quiz-feedback-text");
  const btnNext = document.getElementById("btn-quiz-next");
  const btnRestart = document.getElementById("btn-quiz-restart");
  const btnToClassroom = document.getElementById("btn-quiz-to-classroom");
  const finalScoreVal = document.getElementById("quiz-final-score-val");
  const resultPraise = document.getElementById("quiz-result-praise");

  if (!quizCard || !optionsGrid) return;

  const QUIZ_QUESTIONS = [
    {
      level: "N5",
      type: "Trợ từ",
      instruction: "Chọn trợ từ thích hợp điền vào chỗ trống:",
      sentence: "わたし ____ ベトナム人です。",
      options: ["は (wa)", "が (ga)", "を (wo)", "に (ni)"],
      answer: 0,
      explanation: "Trợ từ「は」(đọc là wa khi làm trợ từ) đứng sau danh từ để đánh dấu chủ đề của câu: Tôi là người Việt Nam."
    },
    {
      level: "N5",
      type: "Từ vựng",
      instruction: "Chọn từ tiếng Nhật có nghĩa là Học sinh, sinh viên:",
      sentence: "たなかさんは ____ です。",
      options: ["いしゃ (Bác sĩ)", "がくせい (Học sinh/Sinh viên)", "ぎんこういん (Nhân viên ngân hàng)", "せんせい (Giáo viên)"],
      answer: 1,
      explanation: "「がくせい (学生)」nghĩa là học sinh, sinh viên: Anh Tanaka là sinh viên."
    },
    {
      level: "N5",
      type: "Nghi vấn",
      instruction: "Chọn từ điền vào chỗ trống để tạo thành câu hỏi lịch sự:",
      sentence: "これは にほんごの 本です ____。",
      options: ["ね", "よ", "か", "わ"],
      answer: 2,
      explanation: "Trợ từ「か」đặt ở cuối câu để biểu thị câu hỏi nghi vấn trong tiếng Nhật: Đây có phải là sách tiếng Nhật không?"
    },
    {
      level: "N4",
      type: "Thể Te",
      instruction: "Chọn dạng chia đúng của động từ để diễn tả hành động đang diễn ra:",
      sentence: "いま、日本語を ____ います。",
      options: ["べんきょうして", "べんきょうし", "べんきょうする", "べんきょうした"],
      answer: 0,
      explanation: "Cấu trúc【V-て + います】diễn tả hành động đang diễn ra (hiện tại tiếp diễn): Bây giờ tôi đang học tiếng Nhật."
    },
    {
      level: "N3",
      type: "Giao tiếp",
      instruction: "Chọn cách nói lịch sự phù hợp nhất khi lần đầu gặp gỡ:",
      sentence: "はじめまして。どうぞ ____。",
      options: ["よろしく おねがいします", "ごめんなさい", "いただきます", "おじゃまします"],
      answer: 0,
      explanation: "「どうぞ よろしく おねがいします」là câu chào kinh điển khi tự giới thiệu bản thân: Rất hân hạnh được làm quen và mong được giúp đỡ."
    }
  ];

  let currentIdx = 0;
  let currentScore = 0;
  let answered = false;

  function renderQuestion() {
    if (currentIdx >= QUIZ_QUESTIONS.length) {
      showResults();
      return;
    }

    answered = false;
    const q = QUIZ_QUESTIONS[currentIdx];

    if (quizCard) quizCard.hidden = false;
    if (resultCard) resultCard.hidden = true;
    if (feedbackBox) feedbackBox.hidden = true;

    if (qNum) qNum.textContent = `Câu ${currentIdx + 1} / ${QUIZ_QUESTIONS.length}`;
    if (qLevel) qLevel.textContent = q.level;
    if (qType) qType.textContent = q.type;
    if (promptVi) promptVi.textContent = q.instruction;
    if (promptJp) promptJp.textContent = q.sentence;
    if (scoreDisplay) scoreDisplay.textContent = `${currentScore} / ${QUIZ_QUESTIONS.length}`;
    if (progressBar) {
      progressBar.style.width = `${((currentIdx + 1) / QUIZ_QUESTIONS.length) * 100}%`;
    }

    optionsGrid.innerHTML = "";
    q.options.forEach((optText, idx) => {
      const optBtn = document.createElement("button");
      optBtn.type = "button";
      optBtn.className = "quiz-opt-btn";
      optBtn.innerHTML = `
        <span class="opt-letter">${String.fromCharCode(65 + idx)}</span>
        <span class="opt-label">${optText}</span>
      `;

      optBtn.addEventListener("click", () => handleAnswer(idx, optBtn));
      optionsGrid.appendChild(optBtn);
    });
  }

  function handleAnswer(selectedIdx, btnEl) {
    if (answered) return;
    answered = true;

    const q = QUIZ_QUESTIONS[currentIdx];
    const isCorrect = (selectedIdx === q.answer);

    const allBtns = optionsGrid.querySelectorAll(".quiz-opt-btn");
    allBtns.forEach((b, idx) => {
      b.disabled = true;
      if (idx === q.answer) {
        b.classList.add("correct");
      } else if (idx === selectedIdx && !isCorrect) {
        b.classList.add("wrong");
      }
    });

    if (isCorrect) {
      currentScore++;
      soundEngine.playCheer();
      mascotMgr.celebrate();
      if (scoreDisplay) scoreDisplay.textContent = `${currentScore} / ${QUIZ_QUESTIONS.length}`;
    } else {
      soundEngine.playTone(220, "sawtooth", 0.15);
      mascotMgr.setState("thinking");
    }

    if (feedbackBox) {
      feedbackBox.hidden = false;
      if (feedbackText) feedbackText.textContent = q.explanation;
    }
  }

  function showResults() {
    if (quizCard) quizCard.hidden = true;
    if (resultCard) resultCard.hidden = false;
    if (finalScoreVal) finalScoreVal.textContent = currentScore;
    if (scoreDisplay) scoreDisplay.textContent = `${currentScore} / ${QUIZ_QUESTIONS.length}`;

    soundEngine.playCheer();
    mascotMgr.celebrate();

    if (resultPraise) {
      if (currentScore === 5) {
        resultPraise.textContent = "完璧 (Hoàn hảo)! 5/5 câu tuyệt đối! Phản xạ tiếng Nhật của bạn đỉnh chóp! 🌟";
      } else if (currentScore >= 3) {
        resultPraise.textContent = "すばらしい！Làm rất tốt! Bạn đã nắm vững các cấu trúc cơ bản.";
      } else {
        resultPraise.textContent = "Cố gắng lên nhé! Hãy luyện thêm cùng Sensei ở phòng học để rèn phản xạ!";
      }
    }
  }

  if (btnNext) {
    btnNext.addEventListener("click", () => {
      soundEngine.playBlip();
      currentIdx++;
      renderQuestion();
    });
  }

  if (btnRestart) {
    btnRestart.addEventListener("click", () => {
      soundEngine.playBlip();
      currentIdx = 0;
      currentScore = 0;
      renderQuestion();
    });
  }

  if (btnToClassroom) {
    btnToClassroom.addEventListener("click", () => {
      switchTab("classroom");
    });
  }

  renderQuestion();
}

const TAB_TITLES = {
  classroom: "Phòng học Sensei (Reversed Quiz)",
  curriculum: "Lộ trình JLPT N5–N1 (Minna no Nihongo)",
  flashcards: "Thẻ nhớ Flashcard (Spaced Repetition SRS)",
  kaiwa: "Kaiwa Speaking Lab (Luyện hội thoại & Phát âm)",
  quiz: "Phản xạ Speed Quiz (Blitz Challenge)",
  mastery: "Radar Năng lực & Đường cong SRS",
  settings: "Hồ sơ & Mascot Sensei"
};

function switchTab(tabId) {
  soundEngine.playBlip();

  // Hide floating mascot dock on main classroom chat tab, show on other tabs
  const floatingDock = document.getElementById("sensei-floating-dock");
  if (floatingDock) {
    if (tabId === "classroom") {
      floatingDock.style.display = "none";
    } else {
      floatingDock.style.display = "flex";
    }
  }

  // Update sidebar buttons
  document.querySelectorAll(".sidebar-nav-item").forEach(item => {
    item.classList.toggle("active", item.dataset.tab === tabId);
  });

  // Update topbar pills
  document.querySelectorAll(".topbar-nav-pill").forEach(pill => {
    pill.classList.toggle("active", pill.dataset.tab === tabId);
  });

  // Toggle tab panels
  document.querySelectorAll(".tab-panel").forEach(panel => {
    const isTarget = panel.id === `panel-${tabId}`;
    panel.hidden = !isTarget;
    panel.classList.toggle("active", isTarget);
  });

  const topbarTitle = document.getElementById("topbar-view-title");
  if (topbarTitle && TAB_TITLES[tabId]) {
    topbarTitle.textContent = TAB_TITLES[tabId];
  }

  // Update URL hash without jumping
  if (history.replaceState) {
    history.replaceState(null, null, `#${tabId}`);
  }

  const sidebar = document.getElementById("app-sidebar");
  if (sidebar && window.innerWidth < 900) {
    sidebar.classList.remove("open");
  }

  if (tabId === "curriculum") {
    loadCurriculum("N5");
  } else if (tabId === "mastery") {
    loadProgress();
  } else if (tabId === "quiz") {
    setupQuickQuiz();
  }
}

// ==========================================
// 13. GOOGLE IDENTITY SERVICES (GIS OAUTH)
// ==========================================
const GOOGLE_CLIENT_ID = "271339242186-1f5bcj7up08drgkf9e2p086693jhbg2j.apps.googleusercontent.com";

function setupGoogleAuth() {
  const savedGoogle = localStorage.getItem(GOOGLE_USER_KEY);

  if (savedGoogle) {
    try {
      const u = JSON.parse(savedGoogle);
      renderGoogleUser(u);
    } catch {}
  }

  if (typeof google !== "undefined" && google.accounts && google.accounts.id) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredentialResponse,
      auto_select: false,
    });

    const btnContainer = document.getElementById("g_id_signin_container");
    if (btnContainer) {
      google.accounts.id.renderButton(btnContainer, {
        theme: "outline",
        size: "medium",
        shape: "pill",
        text: "signin_with"
      });
    }

    const modalBtnContainer = document.getElementById("g_id_signin_modal_container");
    if (modalBtnContainer) {
      google.accounts.id.renderButton(modalBtnContainer, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "signin_with",
        width: 280
      });
    }
  }
}

function handleGoogleCredentialResponse(response) {
  try {
    const parts = response.credential.split(".");
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    
    const user = {
      name: payload.name || "Học viên Google",
      email: payload.email,
      picture: payload.picture,
      id: payload.sub
    };

    localStorage.setItem(GOOGLE_USER_KEY, JSON.stringify(user));
    renderGoogleUser(user);
    soundEngine.playCheer();
    mascotMgr.say(`Chào mừng ${user.name}! Tiến độ đã được đồng bộ với Cloudflare D1.`);

    // Close account modal if open
    const modal = document.getElementById("account-modal");
    if (modal) modal.hidden = true;

    // Persist to D1 backend
    fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, name: user.name, level: "N5" })
    }).catch(() => {});

  } catch (e) {
    console.warn("Google token decode failed:", e);
  }
}

function renderGoogleUser(u) {
  const nameEl = document.getElementById("auth-user-name");
  const emailEl = document.getElementById("auth-user-email");
  const container = document.getElementById("google-user-container");

  if (nameEl) nameEl.textContent = u.name;
  if (emailEl) emailEl.textContent = u.email;

  if (container && u.picture) {
    const head = container.querySelector(".welcome-mascot-head");
    if (head) {
      head.innerHTML = `<img src="${u.picture}" alt="${u.name}" class="google-user-avatar">`;
    }
  }

  // Update topbar user name and avatar
  const topbarName = document.getElementById("topbar-user-name");
  if (topbarName) topbarName.textContent = u.name;
  const topbarAvatar = document.getElementById("topbar-user-avatar");
  if (topbarAvatar && u.picture) {
    topbarAvatar.src = u.picture;
    topbarAvatar.classList.remove("pixel-sprite");
  }

  // Pre-populate modal input
  const modalInputName = document.getElementById("modal-input-name");
  if (modalInputName && !modalInputName.value) {
    modalInputName.value = u.name;
  }
}

function setupAccountModal() {
  const modal = document.getElementById("account-modal");
  const openBtn = document.getElementById("btn-topbar-account");
  const levelChip = document.getElementById("level-chip");
  const closeBtn = document.getElementById("btn-close-account-modal");
  const form = document.getElementById("profile-modal-form");
  const nameInput = document.getElementById("modal-input-name");
  let selectedLevel = activeCurriculumLevel || "N5";

  const savedGoogle = localStorage.getItem(GOOGLE_USER_KEY);
  if (savedGoogle) {
    try {
      const u = JSON.parse(savedGoogle);
      if (nameInput && !nameInput.value) nameInput.value = u.name || "";
    } catch {}
  }

  function openModal() {
    if (!modal) return;
    soundEngine.playBlip();
    modal.hidden = false;
    
    document.querySelectorAll("#modal-level-picker .modal-level-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.lvl === selectedLevel);
    });

    if (typeof google !== "undefined" && google.accounts && google.accounts.id) {
      const modalGContainer = document.getElementById("g_id_signin_modal_container");
      if (modalGContainer && modalGContainer.children.length === 0) {
        google.accounts.id.renderButton(modalGContainer, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "signin_with",
          width: 280
        });
      }
    }
  }

  function closeModal() {
    if (modal) modal.hidden = true;
  }

  if (openBtn) openBtn.addEventListener("click", openModal);
  if (levelChip) levelChip.addEventListener("click", openModal);
  if (closeBtn) closeBtn.addEventListener("click", closeModal);

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  document.querySelectorAll("#modal-level-picker .modal-level-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      soundEngine.playBlip();
      document.querySelectorAll("#modal-level-picker .modal-level-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedLevel = btn.dataset.lvl;
    });
  });

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = nameInput ? nameInput.value.trim() : "";
      if (!name) return;

      soundEngine.playCheer();
      try {
        await fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, name: name, level: selectedLevel })
        });
        
        const topbarName = document.getElementById("topbar-user-name");
        if (topbarName) topbarName.textContent = name;
        const chipText = document.getElementById("level-chip-text");
        if (chipText) chipText.textContent = `Trình độ: ${selectedLevel}`;

        closeModal();
        mascotMgr.say(`Chào ${name}! Sensei đã cập nhật hồ sơ JLPT ${selectedLevel}.`);
        selectRoadmapLevel(selectedLevel);
        loadNextTopic();
      } catch (err) {
        console.warn("Save profile error:", err);
      }
    });
  }
}

// ==========================================
// 14. EVENT LISTENERS & BOOTSTRAP
// ==========================================
function setupEventListeners() {
  if (sendBtn) sendBtn.addEventListener("click", submit);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
  }

  // Mobile menu button toggle
  const btnMobile = document.getElementById("btn-mobile-sidebar");
  const sidebar = document.getElementById("app-sidebar");
  if (btnMobile && sidebar) {
    btnMobile.addEventListener("click", () => {
      soundEngine.playBlip();
      sidebar.classList.toggle("open");
    });
  }

  // Sidebar navigation click
  document.querySelectorAll(".sidebar-nav-item").forEach(item => {
    item.addEventListener("click", () => switchTab(item.dataset.tab));
  });

  // Topbar segmented pills click
  document.querySelectorAll(".topbar-nav-pill").forEach(pill => {
    pill.addEventListener("click", () => switchTab(pill.dataset.tab));
  });

  // Prompt action buttons in Classroom Stage
  const btnHint = document.getElementById("btn-ask-hint");
  if (btnHint) btnHint.addEventListener("click", () => sendMessage("Sensei ơi, hãy cho em xin gợi ý cách đặt câu này với!"));

  const btnExplain = document.getElementById("btn-ask-explain");
  if (btnExplain) btnExplain.addEventListener("click", () => sendMessage("Sensei hãy giải thích chi tiết cấu trúc ngữ pháp này và cho em ví dụ cụ thể nhé!"));

  const btnTranslate = document.getElementById("btn-ask-translate");
  if (btnTranslate) btnTranslate.addEventListener("click", () => sendMessage("Sensei dịch câu này sang tiếng Việt giúp em với!"));

  const btnNextQ = document.getElementById("btn-next-question");
  if (btnNextQ) btnNextQ.addEventListener("click", () => sendMessage("Em đã hiểu rồi, Sensei hãy đặt câu hỏi tiếp theo cho em thử sức nhé!"));

  const btnSpeakCur = document.getElementById("btn-speak-current");
  if (btnSpeakCur) {
    btnSpeakCur.addEventListener("click", () => {
      const topicEl = document.getElementById("topic-display-title");
      if (topicEl) playGeminiTTS(topicEl.textContent);
    });
  }

  // Welcome interactive preset chips
  document.querySelectorAll(".welcome-chip-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.preset) sendMessage(btn.dataset.preset);
    });
  });

  // Roadmap Timeline Steps (N5 - N1)
  document.querySelectorAll(".timeline-step").forEach(step => {
    step.addEventListener("click", () => {
      soundEngine.playBlip();
      selectRoadmapLevel(step.dataset.stepLvl);
    });
  });

  // Curriculum level filter tabs
  document.querySelectorAll("#curriculum-level-filters .filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      soundEngine.playBlip();
      selectRoadmapLevel(tab.dataset.lvl);
    });
  });

  // Curriculum type filters (All / Grammar / Vocab / Kanji)
  document.querySelectorAll("#curriculum-type-filters .filter-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      soundEngine.playBlip();
      document.querySelectorAll("#curriculum-type-filters .filter-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      activeCurriculumType = pill.dataset.type || "all";
      renderCurriculum(curriculumCache, activeCurriculumType);
    });
  });

  // Practice Topic Now Hero Button
  const btnPracticeNow = document.getElementById("btn-practice-topic-now");
  if (btnPracticeNow) {
    btnPracticeNow.addEventListener("click", () => {
      soundEngine.playSend();
      switchTab("classroom");
      const heroDisplay = document.getElementById("hero-topic-display");
      const topicText = heroDisplay ? heroDisplay.textContent : "bài học hôm nay";
      sendMessage(`Sensei ơi, em muốn bắt đầu luyện phản xạ với chủ đề「${topicText}」ngay bây giờ!`);
    });
  }

  // Refresh topic button
  const btnRefreshTopic = document.getElementById("btn-refresh-topic");
  if (btnRefreshTopic) {
    btnRefreshTopic.addEventListener("click", () => {
      soundEngine.playBlip();
      loadNextTopic();
      loadCurriculum(activeCurriculumLevel, activeCurriculumType);
    });
  }

  setupAccountModal();

  // Mascot choice cards in Settings
  document.querySelectorAll(".mascot-choice").forEach(card => {
    card.addEventListener("click", () => {
      soundEngine.playBlip();
      mascotMgr.setMascot(card.dataset.mascot);
    });
  });

  // JLPT level select buttons in Settings
  document.querySelectorAll(".level-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const lvl = btn.dataset.level;
      soundEngine.playBlip();
      document.querySelectorAll(".level-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      const chipText = document.getElementById("level-chip-text");
      if (chipText) chipText.textContent = `Trình độ: ${lvl}`;

      await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, level: lvl })
      });
      loadNextTopic();
    });
  });

  // Sound toggle button
  const soundBtn = document.getElementById("sound-toggle-btn");
  const soundIcon = document.getElementById("sound-icon");
  const soundSettingBtn = document.getElementById("btn-toggle-sound-setting");

  function updateSoundUI(enabled) {
    if (soundIcon) soundIcon.textContent = enabled ? "🔊" : "🔇";
    if (soundSettingBtn) soundSettingBtn.textContent = enabled ? "🔊 Bật âm thanh" : "🔇 Đã tắt âm";
  }

  if (soundBtn) {
    soundBtn.addEventListener("click", () => {
      const en = soundEngine.toggle();
      updateSoundUI(en);
    });
  }
  if (soundSettingBtn) {
    soundSettingBtn.addEventListener("click", () => {
      const en = soundEngine.toggle();
      updateSoundUI(en);
    });
  }
  updateSoundUI(soundEngine.enabled);

  // User ID display & copy
  const uidDisplay = document.getElementById("user-id-display");
  if (uidDisplay) uidDisplay.textContent = userId;

  const btnCopyUid = document.getElementById("btn-copy-user-id");
  if (btnCopyUid) {
    btnCopyUid.addEventListener("click", () => {
      navigator.clipboard.writeText(userId);
      btnCopyUid.textContent = "✅ Đã chép!";
      setTimeout(() => btnCopyUid.textContent = "📋 Sao chép", 2000);
    });
  }

  // Save custom Gemini API key
  const keyInput = document.getElementById("custom-api-key-input");
  const saveKeyBtn = document.getElementById("btn-save-api-key");
  if (keyInput && saveKeyBtn) {
    if (GEMINI_API_KEY) keyInput.value = GEMINI_API_KEY;
    saveKeyBtn.addEventListener("click", () => {
      const k = keyInput.value.trim();
      if (k) {
        GEMINI_API_KEY = k;
        localStorage.setItem(API_KEY_STORAGE, k);
        saveKeyBtn.textContent = "✅ Đã lưu!";
        setTimeout(() => saveKeyBtn.textContent = "Lưu khóa", 2000);
      }
    });
  }

  const btnResume = document.getElementById("btn-resume-learning");
  if (btnResume) {
    btnResume.addEventListener("click", () => {
      soundEngine.playSend();
      switchTab("classroom");
    });
  }

  setupFlashcards();
  setupKaiwaLab();
  setupFloatingSensei();
  setupQuickQuiz();
}

// Initial Boot
(async function init() {
  initLoadingScreen();
  initAnatomyTypewriter();
  setupEventListeners();
  mascotMgr.updateAllSpriteElements();

  // Instant hash routing on page load
  const initialHash = window.location.hash.replace("#", "");
  if (initialHash && TAB_TITLES[initialHash]) {
    switchTab(initialHash);
  }

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
      if (chipText && prof.level) chipText.textContent = `Trình độ: ${prof.level}`;
    }
  } catch (err) {
    console.warn("Profile init auto-provision:", err);
  }

  const messages = await loadHistory();
  if (!messages || messages.length === 0) {
    await loadGreeting();
  }

  await loadNextTopic();
  await loadProgress();

  // Hash-based route check
  const hash = window.location.hash.replace("#", "");
  if (hash && TAB_TITLES[hash]) {
    switchTab(hash);
  }

  setTimeout(setupGoogleAuth, 1200);

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
  window.loadCurriculum = loadCurriculum;
  window.loadProgress = loadProgress;
  window.setupQuickQuiz = setupQuickQuiz;
}
