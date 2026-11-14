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
  dashboard: "Học tập",
  kanji: "Kanji",
  classroom: "Thầy Lâm",
  curriculum: "Khóa học",
  lesson: "Bài học",
  flashcards: "Thẻ nhớ",
  kaiwa: "Luyện nói",
  quiz: "Bài luyện JLPT",
  mastery: "Tiến độ",
  settings: "Cài đặt",
  admin: "Quản trị"
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
// 7. TAB SWITCHER & NAVIGATION
// ==========================================
function switchTab(tabId, route={}) {
  const managedSettings=tabId==='settings' && route.view==='api' && signedInUser?.is_admin===true;
  if(managedSettings)route={...route,view:'admin'};
  if(!authorizePage(tabId,route) || !confirmWorkspaceNavigation(tabId,route))return false;
  stopSpeech();
  globalThis.stopJapaneseInputs?.();
  globalThis.clearKaiwaFeedback?.();
  if(tabId!=='classroom')globalThis.stopLiveConversation?.();
  globalThis.cancelPracticeCoach?.();
  globalThis.rememberTeacherScreen?.();
  globalThis.invalidateTeacherQuery?.();
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

  // Keep the active view first in the document's reading order.
  const activePanel = document.getElementById(`panel-${tabId}`);
  activePanel?.parentElement?.prepend?.(activePanel);

  // Update topbar title
  const topbarTitle = document.getElementById("topbar-view-title");
  if (topbarTitle && TAB_TITLES[tabId]) {
    topbarTitle.textContent = TAB_TITLES[tabId];
  }

  // Update URL hash
  const targetHash=appRouteHash(tabId,route);
  if(managedSettings)history.replaceState(null,'',targetHash);
  else if(!route.fromHistory && location.hash!==targetHash)history.pushState(null,'',targetHash);
  globalThis.markTeacherScreen?.();

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
    if (!chatHistoryReady) globalThis.loadChatHistory?.();
    globalThis.checkAiReady?.();
    renderDailyKanji(activeCurriculumLevel);
  } else if (tabId === "settings" || tabId === "admin") {
    if(tabId==='admin')window.renderAiPanels?.('admin');
    else {
      const area=window.showSettingsArea?.(route.view || 'account') || 'account';
      window.renderAccountSettings?.();
      if(area==='api')window.renderAiPanels?.('settings');
      if(area==='sound' && !signedInUser?.is_admin)window.loadVoiceProfiles?.();
      if(area==='admin')window.renderAdminAISettings?.();
    }
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
        <span class="bubble-name">${role === "user" ? "Em" : currentMascot.name}</span>
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

let sendingMessage=false,chatHistoryReady=false,chatHistoryLoading=false,clearingChat=false,failedChatMessage=null,chatHistoryScope=null;
function chatHistoryPath() {
  const lesson=chatLessonContext || globalThis.teacherContext?.()?.lesson;
  return lesson ? `/api/history?lesson_id=${encodeURIComponent(lesson.id)}&level=${encodeURIComponent(lesson.level)}` : '/api/history';
}
function chatError(message,retry) {
  const host=document.getElementById('chat-error');host.hidden=!message;
  document.getElementById('chat-error-text').textContent=message;
  const button=document.getElementById('chat-retry');button.hidden=!retry;button.onclick=retry;
  const open=document.getElementById('chat-open-settings');open.hidden=!/Cài đặt/.test(message||'');open.onclick=()=>switchTab('settings',{view:'api'});
  open.textContent=signedInUser?.is_admin?'Model quản trị':'Cài đặt API';
  const discard=document.getElementById('chat-discard');discard.hidden=!failedChatMessage;discard.onclick=()=>{failedChatMessage=null;loadChatHistory();};
}
async function loadChatHistory() {
  if(chatHistoryLoading || sendingMessage || clearingChat)return;
  chatHistoryLoading=true;chatHistoryReady=false;chatError('',null);
  document.getElementById('chat-connection-status').textContent='Đang tải hội thoại…';
  try {
    const path=chatHistoryPath();
    const response=await apiFetch(path);
    if(!response.ok)throw new Error('history');
    const messages=await response.json();
    for(const row of document.querySelectorAll('#chat-messages .chat-bubble-row'))row.remove();
    document.getElementById('chat-welcome').style.display=messages.length?'none':'';
    for(const message of messages)renderBubble(message.role,message.content);
    chatHistoryReady=true;chatError('',null);
    chatHistoryScope=path;
    globalThis.checkAiReady?.();
    document.getElementById('chat-connection-status').textContent='';
    return messages.length;
  }catch{
    document.getElementById('chat-connection-status').textContent='';
    chatError('Chưa tải được hội thoại.',loadChatHistory);
  }finally{chatHistoryLoading=false;}
}
async function sendMessage(text,retry=false,options={}) {
  text=typeof text==='string'?text.trim():'';
  if(sendingMessage || clearingChat || globalThis.popoverBusy || !text)return;
  if(failedChatMessage && !retry){chatError('Tin trước chưa gửi xong. Thử lại hoặc bỏ qua.',()=>sendMessage(failedChatMessage.text,true));return;}
  if(!signedInUser){openAccount();return;}
  if(!chatHistoryReady){chatError('Đợi hội thoại tải xong trước khi gửi.',chatHistoryLoading?null:loadChatHistory);return;}
  if(text.length>6000){chatError('Tin nhắn tối đa 6.000 ký tự.',null);return;}
  if(retry && !failedChatMessage)return;
  if(retry)text=failedChatMessage.text;
  if(!retry && chatHistoryScope!==chatHistoryPath()){
    await loadChatHistory();
    if(!chatHistoryReady || chatHistoryScope!==chatHistoryPath())return;
  }
  const context=globalThis.teacherContext?.();
  const requestId=retry?failedChatMessage.id:crypto.randomUUID();
  const lesson=retry?failedChatMessage.lesson:chatLessonContext || context?.lesson || null;
  const sameLesson=!lesson || (context?.lesson?.id===lesson.id && context?.lesson?.level===lesson.level);
  const screen=retry?failedChatMessage.screen:context?.screen || null;
  const focus=retry?failedChatMessage.focus:lesson && sameLesson?(Object.hasOwn(options,'focus')?options.focus:context?.focus || null):null;
  const intent=retry?failedChatMessage.intent:options.intent || 'message';
  const question=retry?failedChatMessage.question:focus?.kind==='question' && sameLesson?context?.task:null;
  const view=retry?failedChatMessage.view:context?.view || 'checks';
  let body=retry?failedChatMessage.body:null;
  const send=document.getElementById('btn-send-message'),clear=document.getElementById('btn-clear-chat-history'),input=document.getElementById('chat-input');
  send.disabled=true;clear.disabled=true;sendingMessage=true;chatError('',null);
  document.getElementById('chat-connection-status').textContent='Thầy đang trả lời…';
  document.querySelector('.classroom-chat-window')?.setAttribute('aria-busy','true');
  if(!retry)renderBubble('user',text);
  if(!retry || input.value.trim()===text){input.value='';input.style.height='44px';}
  soundEngine.playSend();mascotMgr.setState('thinking');
  try {
    if(!body){
      const payload={message:text,lesson,screen,focus,view,intent,request_id:requestId};
      if(focus?.kind==='question'){
        const attempt=focusedTaskAttempt(lesson,focus,view,question);
        if(!attempt)throw new Error('Chưa xác định đúng câu hỏi. Mở lại bài trước khi hỏi thầy.');
        await recordTaskEvent(attempt,'assist',{help:'chat'});
        payload.task=await taskReference(attempt.task);
      }
      body=JSON.stringify(payload);
    }
    const response=await apiFetch('/api/chat',{method:'POST',signal:AbortSignal.timeout(35000),headers:{'Content-Type':'application/json'},body});
    const data=await response.json();
    if(!response.ok)throw new Error(data.detail || 'Chưa gửi được tin nhắn.');
    const reference=JSON.parse(body).task;
    if(reference && (data.task?.id!==reference.id || data.task?.revision!==reference.revision))throw new Error('Phản hồi thuộc phiên bản câu hỏi khác. Mở lại bài.');
    const reply=data.reply || data.response;
    if(typeof reply!=='string' || !reply.trim())throw new Error('Thầy chưa trả lời. Hãy thử lại.');
    renderBubble('bot',reply);failedChatMessage=null;chatError('',null);
    soundEngine.playReceive();mascotMgr.setState('speaking');
    setTimeout(()=>mascotMgr.setState('idle'),2000);
  }catch(error){
    failedChatMessage={text,id:requestId,lesson,screen,focus,view,question,intent,body};
    chatError(error.name==='TimeoutError'?'Kết nối quá lâu. Hãy thử lại.':error.message==='Failed to fetch'?'Mất kết nối. Hãy thử lại.':error.message,()=>sendMessage(failedChatMessage.text,true));
    mascotMgr.setState('idle');
  }finally{
    sendingMessage=false;send.disabled=false;clear.disabled=false;
    document.querySelector('.classroom-chat-window')?.setAttribute('aria-busy','false');
    document.getElementById('chat-connection-status').textContent='';
  }
}
function restartTutorConversation(){
  return sendMessage('Thầy bắt đầu lại buổi học này nhé.',false,{intent:'restart'});
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
  const query=document.getElementById('lesson-search').value.trim().normalize('NFKC').toLowerCase(),status=document.getElementById('lesson-status')?.value || 'all';let matched=0;
  document.querySelectorAll('.curriculum-lesson-card').forEach(card=>{const match=card.dataset.search.includes(query) && (status==='all' || card.dataset.done===String(status==='done'));card.hidden=!match||matched>=lessonVisibleLimit;if(match)matched++;});
  document.getElementById('lesson-count').textContent=matched?`${Math.min(matched,lessonVisibleLimit)} / ${matched} bài · ${activeCurriculumLevel}`:'Không tìm thấy bài học.';
  document.getElementById('lesson-load-more').hidden=matched<=lessonVisibleLimit;
}

async function renderCurriculum(level = "N5", skill = "grammar") {
  if((skill==='kana' && level!=='N5') || !learningSkills.includes(skill))skill='grammar';
  const request=++curriculumRequest;
  document.getElementById('study-plan').hidden=curriculumView!=='plan';
  document.getElementById('lesson-library').hidden=curriculumView!=='library';
  document.getElementById('skill-tabs-row').hidden=curriculumView!=='library';
  document.getElementById('cb-skill-trail').hidden=curriculumView!=='library';
  const loadingHost=document.getElementById(curriculumView==='plan'?'study-plan':'curriculum-list');
  if(loadingHost.dataset.level!==level || !loadingHost.textContent)loadingHost.textContent='Đang tải bài học…';
  loadingHost.dataset.level=level;
  try { await Promise.all([ensureLessons(level),loadCompletions(),loadPracticalCourse()]);createStudyPlan(level); }
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
    listening: "Nghe hiểu",
    production: "Viết"
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
  listEl.innerHTML = data.map((item, idx) => {
    const done=completionRecords.has(activityId(item,level,skill));
    return `<button type="button" class="curriculum-lesson-card" data-idx="${idx}" data-done="${done}"><span class="lesson-list-number">${String(idx+1).padStart(2,'0')}</span><span class="lesson-row-copy"><strong>${escapeHtml(item.title || item.jp || 'Bài học')}</strong><span>${escapeHtml(item.meaning_vi || item.vi || item.translation || item.summary || item.script_vi || '')}</span></span><span class="lesson-row-size">${item.items?.length || item.examples?.length || 1} mục</span><span class="open-lesson-btn">${done?'Hoàn thành':'Học →'}</span></button>`;
  }).join('');

  listEl.querySelectorAll(".curriculum-lesson-card").forEach(card => {
    card.dataset.search=JSON.stringify({...data[Number(card.dataset.idx)],drills:undefined}).normalize('NFKC').toLowerCase();
    card.hidden=!card.dataset.search.includes(document.getElementById("lesson-search").value.toLowerCase());
    card.addEventListener("click", () => {
      const idx = parseInt(card.dataset.idx, 10);
      showLessonDetail(data[idx], level, skill);
    });
  });
  filterCurriculum();
  setCurriculumView(curriculumView,false);
}

function lessonExampleHtml(ex,index,{listenFirst=false,nested=false}={}) {
  const annotated=ex.furigana || ex.jp || '';
  const japanese=annotated.replace(/\{([^{}|]+)\|([^{}|]+)\}/g,'$1');
  const hasFurigana=/\{[^{}|]+\|[^{}|]+\}/.test(annotated);
  const sentence=`<p class="example-jp" lang="ja">${escapeHtml(japanese)}</p>`;
  const tag=nested?'div':'li';
  return `<${tag} class="example-card"${nested?'':` data-teacher-example="${index}"`}>
    <span class="example-index" aria-hidden="true">${index+1}</span>
    <div class="example-text">
      ${ex.context?`<p class="example-context">${escapeHtml(ex.context)}</p>`:''}
      ${listenFirst?`<details class="lesson-disclosure example-transcript"><summary>Lời thoại</summary>${sentence}</details>`:sentence}
      <div class="lesson-aids">
        ${ex.ro || hasFurigana?`<details class="lesson-disclosure"><summary>Cách đọc</summary><div class="lesson-aid-content">
          ${hasFurigana?`<p lang="ja">${furiganaHtml(annotated)}</p>`:''}
          ${ex.ro?`<p class="example-ro">${escapeHtml(ex.ro)}</p>`:''}
        </div></details>`:''}
        ${ex.vi?`<details class="lesson-disclosure"><summary>Diễn giải từ nguồn</summary><p class="example-vi lesson-aid-content">${escapeHtml(ex.vi)}</p></details>`:''}
      </div>
      ${ex.source?`<a class="example-source" href="${escapeHtml(ex.source)}" target="_blank" rel="noopener">Tatoeba ↗</a>`:''}
    </div>
    <button type="button" class="card-audio-btn modal-tts-btn" aria-label="Nghe câu ${index+1}" data-text="${encodeURIComponent(annotated)}">Nghe</button>
  </${tag}>`;
}

function showLessonDetail(item, level, skill, fromHistory=false,owner=null) {
  item={...item,items:item.items || item.roleplay?.words || item.targetWords,examples:item.examples || item.roleplay?.dialogue};
  const returnView=curriculumView;
  if(switchTab('lesson',{level,skill,id:owner?item.id:activityId(item,level,skill),fromHistory,owner,
    ...(item.delayedReview && Number.isInteger(item.reviewQuestionIndex)?{reviewTaskId:lessonQuestions(item,level,skill)[item.reviewQuestionIndex]?.task_id}:{})})===false)return;
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
      <section class="lesson-section">
        <h3 class="lesson-section-title">Ví dụ</h3>
        <p class="lesson-study-hint">${item.dictation?'Nghe và thử chép lại trước khi mở lời thoại.':'Tự đọc hoặc nghe trước. Chỉ mở cách đọc và nghĩa khi cần.'}</p>
        <ol class="example-list">${item.examples.map((ex,index)=>lessonExampleHtml(ex,index,{listenFirst:Boolean(item.dictation || (skill==='listening' && !owner))})).join("")}</ol>
      </section>
    `;
  }

  const vocabularyHtml = item.items?.length ? `
    <div class="lesson-vocabulary-list">${item.items.map((word,index)=>`
      <details class="word-detail" data-teacher-word="${index}"><summary><strong lang="ja">${escapeHtml(word.jp)}</strong><span class="word-reveal-label">Cách đọc &amp; nghĩa</span></summary>
        <div class="word-detail-body"><div class="word-answer"><p lang="ja">${escapeHtml(word.reading || word.ro || "")}</p><p>${escapeHtml(word.vi)}</p></div><button type="button" class="card-audio-btn modal-tts-btn" data-text="${encodeURIComponent(word.jp)}" data-reading="${encodeURIComponent(word.reading || '')}">Nghe cách đọc</button>
        ${word.strokes ? `<dl class="kanji-facts"><div><dt>Số nét</dt><dd>${word.strokes}</dd></div><div><dt>Bộ thủ</dt><dd>${escapeHtml(word.radical)}</dd></div><div><dt>Âm On</dt><dd>${escapeHtml(word.onyomi.join(' · '))}</dd></div><div><dt>Âm Kun</dt><dd>${escapeHtml(word.kunyomi.join(' · '))}</dd></div></dl><p>${escapeHtml((word.words||[]).join(' · '))}</p>` : ''}
        ${(word.examples||[]).map((ex,index)=>lessonExampleHtml(ex,index,{nested:true})).join('')}
        </div></details>`).join('')}</div>` : "";
  const readingHtml = item.passage ? `<div class="lesson-reading"><p class="lesson-japanese-passage" lang="ja">${escapeHtml(item.passage)}</p>${item.translation?`<details class="lesson-disclosure"><summary>Bản dịch</summary><p class="lesson-aid-content reading-translation">${escapeHtml(item.translation)}</p></details>`:''}</div>` : "";
  const listeningHtml = item.script_jp ? `<div class="lesson-reading"><p class="lesson-study-hint">Nghe và tự nắm ý chính trước khi xem lời thoại.</p><button type="button" class="card-audio-btn modal-tts-btn" data-text="${encodeURIComponent(item.script_jp)}">Nghe bài</button><details class="lesson-disclosure"><summary>Lời thoại</summary><p class="lesson-japanese-passage lesson-aid-content" lang="ja">${escapeHtml(item.script_jp)}</p></details>${item.script_vi?`<details class="lesson-disclosure"><summary>Bản dịch</summary><p class="lesson-aid-content listening-translation">${escapeHtml(item.script_vi)}</p></details>`:''}</div>` : "";
  const tasks=lessonQuestions(item,level,skill);
  const delayedReview=item.delayedReview===true && tasks[item.reviewQuestionIndex]?.exchange?.stage==='delayed';
  const guided=item.guided_steps?.length && !delayedReview;
  const firstStage=guided?item.guided_steps[0]:null;
  const supportHtml=item.support?.length?`<section class="lesson-section"><h3>Hỗ trợ ngay trong bài</h3><p>Đây là từ hoặc cách diễn đạt được giải thích tại chỗ, không phải tất cả đều là kiến thức bắt buộc phải biết trước.</p>${item.support.map(entry=>`<details class="lesson-disclosure"><summary>${escapeHtml(entry.term)}</summary><p>${escapeHtml(entry.explanation)}</p></details>`).join('')}</section>`:'';
  const taskReferenceHtml=Number.isInteger(item.examIndex)?`<section class="lesson-section"><h3>Bộ câu hỏi · ${tasks.length} câu</h3>
    <p>Đọc đầy đủ đề và ngữ cảnh. Đáp án/lời giải chỉ xuất hiện sau khi em thử trả lời.</p>
    <ol class="task-reference-list">${tasks.map(task=>`<li>${taskPromptHtml(task)}${task.unavailable_reason?`<p role="note">Tạm ngừng: ${escapeHtml(taskUnavailableMessage(task))}</p>`:
      `<ol>${task.opts.map(option=>`<li lang="ja">${escapeHtml(option)}</li>`).join('')}</ol>`}</li>`).join('')}</ol></section>`:'';

  body.innerHTML = `
    <div class="lesson-mode-switch" aria-label="Hoạt động bài học"><button type="button" data-lesson-mode="read" aria-pressed="true">Học bài</button><button type="button" data-lesson-mode="practice" aria-pressed="false">Luyện tập</button></div>
    <div id="lesson-reference">
    <section class="lesson-intro">
      <span class="lesson-source">${escapeHtml(item.sourceLabel || (item.source ? "OpenJLPT" : "Bài học"))}</span>
      ${item.editorial?`<p class="lesson-study-hint">AI biên soạn, chỉ dùng tham khảo; chưa được giáo viên duyệt và không xác nhận thành thạo.</p><p>${escapeHtml(item.source_header)}</p>${item.prerequisite_titles.length?`<p>Học trước: ${escapeHtml(item.prerequisite_titles.join(' · '))}</p>`:''}`:''}
      <p class="lesson-meaning">${escapeHtml(item.meaning_vi || item.vi || "")}</p>
      ${guided?`<aside class="task-stage"><h3>${escapeHtml(firstStage.title)}</h3><p>${escapeHtml(firstStage.note)}</p><p lang="ja">${escapeHtml(firstStage.example.jp)}</p><details><summary>Cách đọc và nghĩa</summary><p lang="ja">${escapeHtml(firstStage.example.reading)}</p><p>${escapeHtml(firstStage.example.vi)}</p></details><p>Làm một lượt nhỏ, xem phản hồi rồi mới mở bước tiếp. Bảng đầy đủ ở phần tham khảo bên dưới.</p></aside>`:''}
      ${guided?'<details class="lesson-disclosure lesson-full-reference"><summary>Bảng và ghi chú đầy đủ · tài liệu tham khảo</summary>':''}
      ${item.formula ? `<div class="lesson-formula"><span>Cấu trúc</span><code>${escapeHtml(item.formula)}</code></div>` : ""}
      ${item.explanation || item.summary ? `<p class="lesson-explain">${escapeHtml(item.explanation || item.summary || "")}</p>` : ""}
      ${guided?'</details>':''}
    </section>
    ${supportHtml}
    ${item.resources?.length ? `<aside class="lesson-resources"><h4>Học tiếp từ nguồn gốc</h4>${item.resources.map(r=>`<p>${escapeHtml(r.publisher)} · ${escapeHtml(r.title)}</p><a href="${escapeHtml(r.pdf_url)}" target="_blank" rel="noopener">Mở bài PDF</a> ${r.audio_page_url?`<a href="${escapeHtml(r.audio_page_url)}" target="_blank" rel="noopener">Nghe bản gốc</a>`:''}`).join('')}<p>Bài trong app được biên soạn riêng; nguồn gốc dùng hệ A1/A2/A2–B1.</p></aside>` : ''}
    ${guided?'<details class="lesson-disclosure"><summary>Các ví dụ và đối chiếu lỗi đầy đủ · tham khảo</summary>':''}
    ${examplesHtml}
    ${item.common_errors?.length?`<section class="lesson-section"><h3>Lỗi dễ gặp và cách sửa</h3>${item.common_errors.map(error=>`<details class="lesson-disclosure"><summary>${escapeHtml(error.problem)}</summary><p>${escapeHtml(error.correction)}</p><p>${escapeHtml(error.reason)}</p></details>`).join('')}</section>`:''}
    ${guided?'</details>':''}
    ${vocabularyHtml}
    ${readingHtml}
    ${listeningHtml}
    ${taskReferenceHtml}
    ${item.externalResources?.length?`<div class="external-resources">${item.externalResources.map(r=>`<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)} ↗</a>`).join('')}</div>`:''}
    </div><div id="lesson-exercises" hidden></div><div id="lesson-completion"></div>
    <div class="lesson-footer">
      <button type="button" class="sketch-btn-cta modal-practice-btn">Luyện với thầy Lâm</button>
      <button type="button" class="stage-btn modal-close-action">Đóng</button>
    </div>
  `;
  if(delayedReview){
    body.querySelector('#lesson-reference').replaceChildren();
    const note=document.createElement('p');note.textContent='Gợi nhớ ở tình huống mới: không mở bài mẫu hoặc lời giải trước khi thử. Lượt này chưa chứng minh khả năng nhớ lâu.';
    body.querySelector('#lesson-reference').append(note);
  }

  renderLessonExercises(item,level,skill);
  const hasPractice=Boolean(item.production || item.dictation || lessonQuestions(item,level,skill).length);
  const modes=body.querySelector('.lesson-mode-switch');
  modes.hidden=!hasPractice;
  const practicedCount=typeof practiceTaskIndices==='function'?practiceTaskIndices(item,tasks).length:tasks.length;
  const practiceLabel=item.production?'Thực hành viết':item.dictation?'Nghe và chép':guided?'Luyện từng bước':`${practicedCount} hoạt động luyện tập`;
  modes.querySelector('[data-lesson-mode=practice]').textContent=practiceLabel;
  const selectMode=mode=>{
    body.dataset.mode=mode;
    body.querySelector('#lesson-reference').hidden=mode!=='read';
    body.querySelector('#lesson-exercises').hidden=mode!=='practice';
    body.querySelector('#lesson-completion').hidden=mode==='practice' && !body.querySelector('.practice-result') && !item.production && !item.dictation;
    modes.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.lessonMode===mode)));
    const question=body.querySelector('.practice-session')?.dataset.teacherQuestion;
    globalThis.setTeacherFocus?.(mode==='practice' && question!==undefined?{kind:'question',index:Number(question)}:null);
    body.scrollTop=0;
  };
  modes.querySelectorAll('button').forEach(b=>b.onclick=()=>selectMode(b.dataset.lessonMode));
  if(hasPractice){
    const start=document.createElement('button');start.className='practice-primary lesson-start';start.textContent=guided?'Thử bước đầu':item.production || item.dictation?practiceLabel:`Bắt đầu ${practicedCount} hoạt động`;
    start.onclick=()=>{selectMode('practice');body.querySelector('#lesson-exercises legend, #lesson-exercises textarea, #lesson-exercises button')?.focus();};
    body.querySelector('#lesson-reference').append(start);
  }
  selectMode(delayedReview?'practice':'read');
  if(delayedReview){modes.querySelector('[data-lesson-mode=read]').hidden=true;body.querySelector('#lesson-exercises legend,textarea,button')?.focus();}
  else globalThis.mountLessonTeaching?.(body,item,level,skill);
  body.querySelectorAll('.word-detail').forEach(word=>word.addEventListener('toggle',()=>{
    if(word.open && word.isConnected)globalThis.setTeacherFocus?.({kind:'word',index:Number(word.dataset.teacherWord)});
  }));
  const completionHost=document.getElementById('lesson-completion');
  if(tasks.length && tasks.every(task=>task.unavailable_reason))completionHost.textContent='Bài tập đang tạm ngừng; không tự tính hoàn thành khi chưa có câu khả dụng.';
  else mountCompletion(completionHost,{activity_id:activityId(item,level,skill),kind:owner==='quiz'?'test':owner==='kaiwa'?'kaiwa':'lesson',level,title:item.title || item.jp || 'Bài học'});
  body.querySelectorAll(".modal-tts-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const word=btn.closest('[data-teacher-word]'),example=btn.closest('[data-teacher-example]');
      if(word)globalThis.setTeacherFocus?.({kind:'word',index:Number(word.dataset.teacherWord)});
      else if(example)globalThis.setTeacherFocus?.({kind:'example',index:Number(example.dataset.teacherExample)});
      const text = decodeURIComponent(btn.dataset.text);
      playGeminiTTS(text,{japaneseOnly:true,reading:singleSpeechReading(decodeURIComponent(btn.dataset.reading || ''))});
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
  renderLessonOutline(item,level,skill,owner);
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
  if(!fcDeck.length){document.getElementById('fc-counter').textContent='Đã ôn xong. Quay lại khi thẻ đến hạn.';document.getElementById('flashcard-card').hidden=true;document.querySelector('.fc-controls-bar').hidden=true;globalThis.setTeacherFocus?.(null);globalThis.invalidateTeacherQuery?.();return;}
  document.getElementById('flashcard-card').hidden=false;document.querySelector('.fc-controls-bar').hidden=false;
  displayFlashcard();
}

function displayFlashcard() {
  if (!fcDeck || fcDeck.length === 0) return;
  globalThis.clearStudySurface?.('flashcards');
  const previousContext=globalThis.teacherContext?.();
  const item = fcDeck[fcIdx];
  const card = document.getElementById("flashcard-card");
  if(card){card.classList.remove('flipped');card.dataset.teacherWordId=item.id || '';updateFlashcardFace(card,false);}

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
  if(readingText?.closest('details'))readingText.closest('details').open=false;
  if (backMeaning) backMeaning.textContent = item.back;
  if (exampleJp) exampleJp.textContent = item.exampleJp;
  if (exampleVi) exampleVi.textContent = item.exampleVi;
  if (badgeLvl) badgeLvl.textContent = `${item.level} Từ vựng`;
  if (counterEl) counterEl.textContent = `Thẻ ${fcIdx + 1} / ${fcDeck.length}`;
  const context=globalThis.teacherContext?.();
  if(JSON.stringify({lesson:previousContext?.lesson || null,focus:previousContext?.focus || null})!==JSON.stringify({lesson:context?.lesson || null,focus:context?.focus || null}))globalThis.invalidateTeacherQuery?.();
  globalThis.mountFlashcardTeaching?.(item);
}

function updateFlashcardFace(card,back){
  const front=card.querySelector('.card-front'),reverse=card.querySelector('.card-back');
  for(const [face,inactive] of [[front,back],[reverse,!back]])if(face){face.inert=inactive;face.setAttribute('aria-hidden',String(inactive));}
  card.setAttribute('aria-label',back?'Thẻ nhớ đang mở nghĩa, nhấn Enter để quay lại':'Thẻ nhớ đang che nghĩa, nhấn Enter để đối chiếu');
  document.getElementById('fc-face-status')?.replaceChildren(document.createTextNode(back?'Đang mở nghĩa và ví dụ':'Đang xem mặt chữ, nghĩa được che'));
}

// ==========================================
// 11. KAIWA SPEAKING LAB CONTROLLER
// ==========================================
let kaiwaRenderRequest=0;
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
    button.onclick=()=>switchTab('kaiwa',{level:activeKaiwaLevel,view:'session',id:key});container.append(button);
  }
  loadKaiwaPrompt();
}

function loadKaiwaPrompt() {
  globalThis.stopSpeech?.();
  globalThis.clearKaiwaFeedback?.();
  const s = window.JLPT_DATA?.kaiwaScenarios?.[activeKaiwaKey];
  if (!s) return;
  globalThis.clearStudySurface?.('kaiwa');
  globalThis.stopJapaneseInputs?.();

  const tag = document.getElementById("kaiwa-prompt-tag");
  const jp = document.getElementById("kaiwa-prompt-jp");
  const vi = document.getElementById("kaiwa-prompt-vi");
  const manualInput = document.getElementById("kaiwa-manual-input");
  const prompts = Array.isArray(s.prompts) ? s.prompts : [];
  const prompt = prompts[activeKaiwaPromptIdx % Math.max(prompts.length, 1)] || {};

  mountCompletion(document.getElementById('kaiwa-completion'),{activity_id:s.course?`kaiwa:${activeKaiwaKey}`:`kaiwa:${activeKaiwaLevel}:${activeKaiwaKey}`,kind:'kaiwa',level:activeKaiwaLevel,title:s.title});
  const context=document.getElementById('kaiwa-context');context.textContent=s.context || '';context.hidden=!s.context;
  if (tag) tag.textContent = s.title;
  if (jp) jp.textContent = prompt.jp || "こんにちは。よろしくお願いします。";
  if (vi) vi.textContent = prompt.vi || "Chưa có diễn giải tiếng Việt từ nguồn. Nhờ thầy giảng từ câu tiếng Nhật khi cần.";
  if (manualInput) manualInput.value = "";
  document.getElementById("kaiwa-next-prompt").hidden=prompts.length<2;
  const hint = document.getElementById("kaiwa-prompt-hint");
  if (hint) hint.textContent = prompt.hints?.[0] || "Chưa có gợi ý riêng cho câu này. Hãy dựa vào câu hỏi và ngữ cảnh, hoặc nhờ thầy gợi mở.";
  document.querySelectorAll('.kaiwa-prompt-card .lesson-disclosure').forEach(details=>{details.open=false;});
  globalThis.mountKaiwaTeaching?.(s,prompt);
}

// ==========================================
// 12. JLPT MOCK EXAM CONTROLLER (MONDAI 1-4)
// ==========================================
let currentExamQuestions = [];
let examQuestionIdx = 0;
let examScore = 0;
let activeQuizTestIdx = 0;

let quizRequest=0;
let examAnswers=new Map();
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
  const descriptor=featureLessons('quiz',level).find(item=>item.examIndex===testIdx);
  const questions=descriptor?lessonQuestions(descriptor,level,'reading'):[];

  if (!questions.length) {
    document.getElementById('quiz-instruction').textContent='Chưa có câu hỏi cho bộ này.';
    document.getElementById('quiz-options-grid').replaceChildren();return;
  }
  document.getElementById('quiz-source-note').textContent=selectedExam.source || 'Bài luyện JLPT';

  const completion=document.getElementById('quiz-completion');completion.replaceChildren();
  currentExamQuestions = questions;
  examQuestionIdx = 0;
  examScore = 0;
  examAnswers=new Map();
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

function displayQuizQuestion(){
  globalThis.clearStudySurface?.('quiz');
  const quizCard=document.getElementById('quiz-card'),resultCard=document.getElementById('quiz-result-card'),feedback=document.getElementById('quiz-feedback-box');
  quizCard.hidden=false;resultCard.hidden=true;feedback.hidden=true;
  const next=document.getElementById('btn-quiz-next'),question=currentExamQuestions[examQuestionIdx];
  next.disabled=true;
  if(!question){finishExam();return;}
  const descriptor=featureLessons('quiz',activeQuizLevel).find(item=>item.examIndex===activeQuizTestIdx);
  const lesson=buildLessonContext(descriptor,activeQuizLevel,'reading');
  taskAttempt(lesson,question,examQuestionIdx,'exam',true);
  globalThis.setTeacherFocus?.({kind:'question',index:examQuestionIdx});
  const number=document.getElementById('quiz-q-num'),instruction=document.getElementById('quiz-instruction'),sentence=document.getElementById('quiz-question-sentence'),grid=document.getElementById('quiz-options-grid');
  number.textContent=`Câu ${examQuestionIdx+1} / ${currentExamQuestions.length}`;
  document.getElementById('quiz-q-type').textContent=question.type || question.mode;
  instruction.textContent=question.instruction || 'Chọn một đáp án để đối chiếu với nguồn.';
  sentence.innerHTML=taskPromptHtml({...question,instruction:''});
  grid.replaceChildren();delete grid.dataset.answered;
  instruction.tabIndex=-1;
  if(question.unavailable_reason){
    sentence.append(document.createTextNode(`Tạm ngừng sử dụng: ${taskUnavailableMessage(question)}`));
    document.getElementById('quiz-feedback-status').textContent='Câu chưa khả dụng — không chấm điểm';
    document.getElementById('quiz-feedback-text').textContent=taskUnavailableMessage(question);
    feedback.hidden=false;next.disabled=false;instruction.focus();return;
  }
  if(question.script_jp){
    const listen=document.createElement('button');listen.type='button';listen.textContent='Nghe ngữ cảnh câu hỏi';
    listen.onclick=()=>playGeminiTTS(question.script_jp,{language:'ja-JP',lesson,focus:{kind:'question',index:examQuestionIdx},view:'exam',task:question});
    grid.append(listen);
  }
  for(const [index,option] of question.opts.entries()){
    const button=document.createElement('button');button.type='button';button.className='quiz-option-btn';button.dataset.idx=String(index);
    const label=document.createElement('span');label.className='quiz-option-label';label.lang='ja';label.textContent=option;
    const ordinal=document.createElement('span');ordinal.className='practice-option-number';ordinal.textContent=String(index+1);
    button.append(ordinal,label);button.onclick=()=>handleQuizAnswer(index);grid.append(button);
  }
  globalThis.mountQuizTeaching?.();instruction.focus();
}

function handleQuizAnswer(selectedIndex){
  const question=currentExamQuestions[examQuestionIdx],grid=document.getElementById('quiz-options-grid');
  if(!question || question.unavailable_reason || grid.dataset.answered==='true' || !Number.isInteger(selectedIndex) || selectedIndex<0 || selectedIndex>=question.opts.length)return;
  grid.dataset.answered='true';
  const index=examQuestionIdx,request=quizRequest;
  const descriptor=featureLessons('quiz',activeQuizLevel).find(item=>item.examIndex===activeQuizTestIdx);
  const attempt=taskAttempt(buildLessonContext(descriptor,activeQuizLevel,'reading'),question,index,'exam');
  const feedback=document.getElementById('quiz-feedback-box'),status=document.getElementById('quiz-feedback-status'),text=document.getElementById('quiz-feedback-text'),next=document.getElementById('btn-quiz-next');
  const matched=selectedIndex===question.answer_index;
  status.textContent=matched?'Khớp đáp án nguồn — chưa phải điểm được xác minh':'Chưa khớp đáp án nguồn — chưa phải điểm được xác minh';
  const explanation=`Em chọn (${selectedIndex+1}) ${question.opts[selectedIndex]}. Đáp án nguồn (${question.answer_index+1}): ${question.opts[question.answer_index]}. ${question.explanation || 'Nguồn chưa có lời giải đầy đủ. Nhờ thầy đối chiếu ngữ cảnh thay vì suy ra rằng mọi cách trả lời khác đều sai.'}`;
  text.textContent=explanation;feedback.hidden=false;next.disabled=true;
  grid.querySelectorAll('.quiz-option-btn').forEach((button,position)=>{
    button.disabled=true;button.dataset.state=position===question.answer_index?'correct':position===selectedIndex?'incorrect':'idle';
    button.setAttribute('aria-label',`${position+1}. ${question.opts[position]}${position===selectedIndex?' — em đã chọn':''}${position===question.answer_index?' — đáp án nguồn':''}`);
  });
  document.getElementById('quiz-save-retry')?.remove();
  const retry=document.createElement('button');retry.type='button';retry.id='quiz-save-retry';retry.className='stage-btn';retry.textContent='Lưu lại';retry.hidden=true;feedback.append(retry);
  const current=()=>request===quizRequest && examQuestionIdx===index && !document.getElementById('quiz-card').hidden;
  async function save(){
    retry.disabled=true;
    try{
      await recordTaskEvent(attempt,'answer',{answer_index:selectedIndex});
      if(!current())return;
      examAnswers.set(index,matched);examScore=[...examAnswers.values()].filter(Boolean).length;
      text.textContent=explanation;retry.remove();next.disabled=false;next.focus();
    }catch(error){if(current()){text.textContent=explanation+' '+error.message;retry.hidden=false;retry.disabled=false;}}
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
  globalThis.setTeacherFocus?.(null);
  globalThis.invalidateTeacherQuery?.();

  const total=currentExamQuestions.length,answered=examAnswers.size,unavailable=currentExamQuestions.filter(task=>task.unavailable_reason).length;
  if(scoreVal)scoreVal.textContent=`${examScore} / ${answered} câu đã đối chiếu với nguồn`;
  if(praise)praise.textContent=`Đã lưu ${answered}/${total} câu. ${unavailable?`${unavailable} câu tạm ngừng vẫn thuộc bộ đề. `:''}Đây là luyện tham khảo, không phải điểm đánh giá năng lực được xác minh.`;
  const exam=window.JLPT_DATA.exams[activeQuizLevel][activeQuizTestIdx],completion=document.getElementById('quiz-completion');
  completion.replaceChildren();
  if(answered===total && unavailable===0)mountCompletion(completion,{activity_id:`test:${examIdentity(activeQuizLevel,activeQuizTestIdx)}`,kind:'test',level:activeQuizLevel,title:exam.title});
  else completion.textContent='Chưa xác nhận làm trọn bộ: vẫn còn câu chưa trả lời hoặc chưa khả dụng.';
  loadProgress();
}

// ==========================================
// 13. MASTERY & PROGRESS CONTROLLER
// ==========================================
async function openProgressReview(record){
  const level=record.level || record.jlpt_level;
  if(!/^N[1-5]$/.test(level || '') || !record.item_id)throw new Error('Bản ghi cũ chưa có tham chiếu bài học đủ rõ; không tự mở nhầm bài.');
  await Promise.all([ensureLessons(level),loadPracticalCourse()]);createStudyPlan(level);
  const candidates=Object.entries(window.JLPT_DATA.curriculum[level].skills).flatMap(([skill,lessons])=>lessons.map(item=>({item,skill})));
  for(const owner of ['flashcards','kaiwa','quiz'])candidates.push(...featureLessons(owner,level).map(item=>({item,skill:owner==='flashcards'?'vocabulary':'reading',owner})));
  const matches=new Map();
  for(const candidate of candidates){
    if(record.lesson_id && activityId(candidate.item,level,candidate.skill)!==record.lesson_id)continue;
    const questions=lessonQuestions(candidate.item,level,candidate.skill),index=questions.findIndex(task=>record.task_id?task.task_id===record.task_id:task.item_id===record.item_id);
    if(index>=0)matches.set(activityId(candidate.item,level,candidate.skill),{...candidate,index});
  }
  if(matches.size!==1)throw new Error('Bản ghi này không xác định duy nhất một bài hiện tại. Hãy chọn bài từ thư viện.');
  const match=[...matches.values()][0];
  showLessonDetail({...match.item,reviewQuestionIndex:match.index},level,match.skill,false,match.owner || null);
  document.querySelector('[data-lesson-mode=practice]')?.click();
  const panel=document.getElementById('lesson-exercises');
  panel.querySelector('legend,textarea,button')?.focus();
}

async function loadProgress() {
  showCompletedActivities(document.getElementById("completed-activities"));
  try {
    const resp = await apiFetch(`/api/progress?user_id=${encodeURIComponent(userId)}`);
    if (resp.ok) {
      const data = await resp.json();
      document.getElementById('mastery-lessons-count').textContent=new Set([...(data.items || []).map(row=>row.item_id),...(data.evidence || []).filter(row=>row.answered_at).map(row=>row.item_id)]).size;
      document.getElementById('mastery-accuracy-rate').textContent=`${data.legacy?.accuracy_rate ?? data.accuracy_rate ?? 0}%`;
      const summary=document.getElementById('mastery-evidence-summary');
      if(summary)summary.textContent=`Lịch sử cũ chưa xác minh: ${data.total_learned || 0} mục. Lượt mới chỉ được gọi là xác minh khi máy chủ có căn cứ chấm đã thẩm định; đối chiếu nguồn, tự đánh giá và AI luôn tách riêng.`;
      document.getElementById("mastery-streak-val").textContent=`${data.streak_days ?? 0} ngày`;
      document.getElementById("streak-counter").textContent=`${data.streak_days ?? 0} ngày`;
      document.getElementById("mastery-exams-count").textContent=(data.items || []).filter(x=>x.item_id?.startsWith("exam-")).length;
      const list = document.getElementById("weak-spots-list");
      const weakItems=[...(data.evidence || []).filter(row=>row.source_correct===false || row.source_correct===0),...(data.weak_items || [])];
      if (list && !weakItems.length) list.textContent="Chưa có mục cần ôn.";
      if (list && weakItems.length) {
        list.innerHTML = weakItems.map((it,index) => {
          const item = typeof it === "string" ? { display: it } : it;
          return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #fff; border: 1.5px solid #fed7aa; border-radius: 10px; margin-bottom: 8px;">
            <div><strong style="color: #9a3412;">${escapeHtml(item.display || item.topic_id || "Mục cần ôn")}</strong>
              <p style="font-size:12px;color:#7c2d12;margin:0;">${item.basis?`Căn cứ: ${escapeHtml(item.basis)}; chưa khớp nguồn`:'Lịch sử cũ chưa được xác minh'}</p>
            </div>
            <button type="button" class="revise-btn" data-record="${index}" style="background:#ea580c;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;">Mở đúng bài để ôn</button>
          </div>
        `;
        }).join("");

        list.querySelectorAll(".revise-btn").forEach(b => {
          b.addEventListener('click',async()=>{
            b.disabled=true;
            try{await openProgressReview(weakItems[Number(b.dataset.record)]);}
            catch(error){b.textContent=error.message;b.disabled=false;}
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
  const popover=document.getElementById('sensei-floating-popover'),closeBtn=document.getElementById('btn-close-popover');
  const sendBtn=document.getElementById('btn-popover-send'),inputEl=document.getElementById('popover-query-input');
  const speechEl=document.getElementById('popover-speech-text'),ttsBtn=document.getElementById('btn-popover-tts');
  const chips=Array.from(document.querySelectorAll('.quick-chip-btn'));
  if(!popover || !sendBtn || !inputEl || !speechEl)return;
  const retryBtn=document.createElement('button');retryBtn.type='button';retryBtn.className='stage-btn';retryBtn.textContent='Thử lại';retryBtn.hidden=true;
  retryBtn.id='btn-popover-retry';speechEl.parentElement.append(retryBtn);speechEl.setAttribute('role','status');
  if(ttsBtn)ttsBtn.disabled=true;
  let generation=0,inFlight=null,failed=null;
  const scope=()=>{
    const context=globalThis.teacherContext?.() || null;
    // Selected canonical items have stable identity even while a timer or progress label changes.
    const identity=context?.focus?{lesson:context.lesson,focus:context.focus,task:context.task?taskRevisionSource(context.task):null}:context;
    return JSON.stringify({route:location.hash,context:identity});
  };
  const controls=busy=>{sendBtn.disabled=busy;retryBtn.disabled=busy;chips.forEach(chip=>chip.disabled=busy);};
  function invalidate(){
    generation++;inFlight?.controller.abort();inFlight=null;failed=null;retryBtn.hidden=true;controls(false);
    mascotMgr.setState('idle');
    speechEl.textContent='Nội dung đã đổi. Hãy đặt câu hỏi mới.';
    if(ttsBtn)ttsBtn.disabled=true;
  }
  globalThis.invalidateTeacherQuery=invalidate;
  globalThis.closeTeacherQuery=()=>{invalidate();popover.hidden=true;};
  function togglePopover(){
    soundEngine.playBlip();
    const opening=popover.hidden;invalidate();popover.hidden=!opening;
    if(opening){speechEl.textContent='Thầy đây. Em muốn hỏi gì?';inputEl.focus();}
  }
  document.getElementById('btn-topbar-summon')?.addEventListener('click',togglePopover);
  closeBtn?.addEventListener('click',globalThis.closeTeacherQuery);
  window.addEventListener('hashchange',invalidate);
  window.addEventListener('keydown',event=>{
    if((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='k'){event.preventDefault();togglePopover();}
    else if(event.key==='Escape' && !popover.hidden)globalThis.closeTeacherQuery();
  });
  async function handlePopoverQuery(query,retry=false){
    query=typeof query==='string'?query.trim():'';
    if(inFlight || popover.hidden || (!query && !retry))return;
    if(failed && !retry){speechEl.textContent='Câu trước chưa gửi xong. Bấm Thử lại hoặc đóng để bỏ qua.';return;}
    if(retry && !failed)return;
    if(query.length>6000){speechEl.textContent='Tin nhắn tối đa 6.000 ký tự.';return;}
    if(!signedInUser){openAccount();return;}
    const context=globalThis.teacherContext?.();
    const request=retry?failed:{body:{message:query,channel:'quick',screen:context?.screen || null,lesson:context?.lesson || null,focus:context?.focus || null,view:context?.view || 'checks',intent:'message',request_id:crypto.randomUUID()},question:context?.task || null,scope:scope()};
    if(request.scope!==scope()){invalidate();speechEl.textContent='Nội dung đã đổi. Hãy đặt câu hỏi mới.';return;}
    const owner={generation,controller:new AbortController()};inFlight=owner;controls(true);retryBtn.hidden=true;
    const current=()=>inFlight===owner && owner.generation===generation && !popover.hidden && scope()===request.scope;
    speechEl.textContent='Thầy đang suy nghĩ…';mascotMgr.setState('thinking');
    if(ttsBtn)ttsBtn.disabled=true;
    if(!retry)inputEl.value='';
    const timeout=setTimeout(()=>owner.controller.abort(),35000);
    try{
      if(!request.serializedBody){
        if(request.body.focus?.kind==='question'){
          const attempt=focusedTaskAttempt(request.body.lesson,request.body.focus,request.body.view,request.question);
          if(!attempt)throw new Error('Chưa xác định đúng câu hỏi. Mở lại bài.');
          await recordTaskEvent(attempt,'assist',{help:'chat'});
          request.body.task=await taskReference(attempt.task);
        }
        request.serializedBody=JSON.stringify(request.body);
      }
      if(!current())return;
      const response=await apiFetch('/api/chat',{method:'POST',signal:owner.controller.signal,headers:{'Content-Type':'application/json'},body:request.serializedBody});
      const data=await response.json();
      if(!response.ok)throw new Error(data.detail || 'Chưa gửi được câu hỏi.');
      if(request.body.task && (data.task?.id!==request.body.task.id || data.task?.revision!==request.body.task.revision))throw new Error('Phản hồi thuộc phiên bản câu hỏi khác. Mở lại bài.');
      const reply=data.reply || data.response;
      if(typeof reply!=='string' || !reply.trim())throw new Error('Thầy chưa trả lời. Hãy thử lại.');
      if(!current())return;
      speechEl.textContent=reply;failed=null;mascotMgr.setState('speaking');soundEngine.playReceive();
      if(ttsBtn)ttsBtn.disabled=false;
    }catch(error){
      if(!current())return;
      failed=request;retryBtn.hidden=false;
      speechEl.textContent=error.name==='AbortError' || error.name==='TimeoutError'?'Kết nối quá lâu. Bấm Thử lại.':error.message==='Failed to fetch'?'Mất kết nối. Bấm Thử lại.':error.message;
      mascotMgr.setState('idle');
    }finally{
      clearTimeout(timeout);
      if(inFlight===owner){
        const stale=!current();inFlight=null;controls(false);
        if(stale){failed=null;retryBtn.hidden=true;speechEl.textContent='Nội dung đã đổi. Hãy đặt câu hỏi mới.';mascotMgr.setState('idle');}
      }
    }
  }
  sendBtn.addEventListener('click',()=>handlePopoverQuery(inputEl.value));
  inputEl.addEventListener('keydown',event=>{
    if(event.key==='Enter' && !event.isComposing){event.preventDefault();handlePopoverQuery(inputEl.value);}
  });
  retryBtn.onclick=()=>handlePopoverQuery(failed?.body.message,true);
  ttsBtn?.addEventListener('click',()=>{if(!inFlight && !failed)playGeminiTTS(speechEl.textContent);});
  chips.forEach(chip=>chip.addEventListener('click',()=>handlePopoverQuery(chip.dataset.ask)));
}

// ==========================================
// 15. SETTINGS, GEMINI KEY & ACCOUNT DELETION
// ==========================================
function setupSettings() {
  // Sound Toggle
  const soundBtn = document.getElementById("btn-toggle-sound-setting");
  if (soundBtn) {
    soundBtn.textContent = soundEngine.enabled ? "Đang bật" : "Đang tắt";
    soundBtn.setAttribute("aria-pressed",String(soundEngine.enabled));
    soundBtn.addEventListener("click", () => {
      const enabled = soundEngine.toggle();
      soundBtn.textContent = enabled ? "Đang bật" : "Đang tắt";
      soundBtn.setAttribute("aria-pressed",String(enabled));
    });
  }

  // Mascots Selection Grid
  document.querySelectorAll(".mascot-choice").forEach(card => {
    card.addEventListener("click", () => {
      soundEngine.playBlip();
      mascotMgr.setMascot(card.dataset.mascot);
    });
  });

  // Delete Account on Cloudflare D1
  const btnDelete = document.getElementById("btn-delete-account");
  if (btnDelete) {
    btnDelete.addEventListener("click", async () => {
      if (!confirm("Xóa tài khoản, lịch sử và tiến độ? Thao tác này không thể hoàn tác.")) {
        return;
      }
      try {
        const resp = await apiFetch(`/api/account/delete?user_id=${encodeURIComponent(userId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId })
        });
        if (resp.ok) {
          if (window.VJProfiles) await VJProfiles.clear(signedInUser.user_id);
          for (const key of Object.keys(localStorage)) if(key.startsWith("vjbot_")) localStorage.removeItem(key);
          alert("Đã xóa tài khoản và dữ liệu.");
          window.location.reload();
        } else {
          alert("Chưa xóa được tài khoản. Vui lòng thử lại.");
        }
      } catch (err) {
        alert("Lỗi: " + err.message);
      }
    });
  }
}

// MICROPHONE CAPTURE CONTROLLER
function singleSpeechReading(value){
  return typeof value==='string' && /^[ぁ-ゖァ-ヺー]+$/u.test(value.trim())?value.trim():'';
}
function setupMicrophoneControls(){
  const el=id=>document.getElementById(id);
  createJapaneseInput({button:el('btn-kaiwa-mic'),input:el('kaiwa-manual-input'),
    status:el('kaiwa-mic-status'),playbackButton:el('btn-kaiwa-play-user')});
}

// ==========================================
// 16. EVENT LISTENERS SETUP
// ==========================================
function setupEventListeners() {
  document.getElementById('btn-practice-topic-now').addEventListener('click',()=>sendMessage(`Thầy Lâm ơi, giúp em luyện ${document.getElementById('hero-topic-display').textContent}.`));
  document.getElementById('btn-change-curriculum-stage').addEventListener('click',()=>switchTab('curriculum'));
  setupMicrophoneControls();
  const voiceButton=document.getElementById('btn-voice-input');
  voiceButton.addEventListener('click',()=>window.openLiveConversation?.());

  window.addEventListener('completion-changed',()=>{if(location.hash===`#curriculum/${activeCurriculumLevel}` && curriculumView==='plan')renderStudyPlan(activeCurriculumLevel);});
  document.getElementById('kaiwa-level').onchange=e=>switchTab('kaiwa',{level:e.target.value});
  document.querySelectorAll('[data-start-level]').forEach(button=>button.onclick=()=>openLevelCourse(button.dataset.startLevel));
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.go)));
  document.getElementById("settings-account").addEventListener("click",openAccount);
  document.querySelectorAll('[data-curriculum-view]').forEach(b=>b.onclick=()=>setCurriculumView(b.dataset.curriculumView));
  document.getElementById("lesson-search").addEventListener("input",()=>filterCurriculum());
  document.getElementById("lesson-status").addEventListener("change",()=>filterCurriculum());
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
      playGeminiTTS(data.sample, {japaneseOnly:true});
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
  if (btnAskHint) btnAskHint.addEventListener("click", () => sendMessage("Thầy gợi ý cho em từng bước nhỏ, chưa đưa đáp án vội nhé.",false,{intent:'hint'}));

  const btnAskExplain = document.getElementById("btn-ask-explain");
  if (btnAskExplain) btnAskExplain.addEventListener("click", () => sendMessage("Em muốn tự giải thích mẫu câu này bằng lời của em. Thầy hỏi em rồi nhận xét nhé.",false,{intent:'explain'}));

  const btnAskExample = document.getElementById("btn-ask-example");
  if (btnAskExample) btnAskExample.addEventListener("click", () => sendMessage("Thầy cho em một tình huống mới để em tự vận dụng nhé.",false,{intent:'situation'}));

  const btnAskCheck = document.getElementById("btn-ask-check");
  if (btnAskCheck) btnAskCheck.addEventListener("click", () => sendMessage("Thầy kiểm tra câu em vừa viết: đúng ngữ pháp và tự nhiên chưa, sửa giúp em nhé.",false,{intent:'check'}));
  const restartChat=document.createElement('button');restartChat.type='button';restartChat.className='prompt-chip';restartChat.textContent='Học lại';restartChat.title='Bắt đầu lại buổi học';restartChat.id='btn-restart-chat';
  restartChat.addEventListener('click',restartTutorConversation);document.getElementById('chat-prompt-chips')?.append(restartChat);

  // Classroom form submit
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  if (chatForm && chatInput) {
    chatInput.addEventListener('input',()=>{chatInput.style.height='44px';chatInput.style.height=Math.min(chatInput.scrollHeight+2,120)+'px';});
    chatInput.addEventListener('keydown',event=>{
      if(event.key==='Enter' && !event.shiftKey && !event.isComposing){event.preventDefault();chatForm.requestSubmit();}
    });
    chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if(e.isComposing)return;
      sendMessage(chatInput.value);
    });
  }

  // Clear chat history
  const btnClearChat = document.getElementById("btn-clear-chat-history");
  if (btnClearChat) {
    btnClearChat.addEventListener("click", async () => {
      if(sendingMessage || clearingChat || !chatHistoryReady)return;
      if (confirm("Xóa tin nhắn trong cuộc trò chuyện này? Các bài học khác và lịch sử lưu trữ vẫn được giữ lại.")) {
        clearingChat=true;btnClearChat.disabled=true;document.getElementById("btn-send-message").disabled=true;chatError("",null);
        try {
          const response=await apiFetch(chatHistoryPath(), { method: "DELETE" });
          if(!response.ok)throw new Error('delete');
          const messages = document.getElementById("chat-messages");
          if(messages)for(const row of messages.querySelectorAll('.chat-bubble-row'))row.remove();
          const welcome=document.getElementById('chat-welcome');if(welcome)welcome.style.display='';
          failedChatMessage=null;chatError('',null);
          soundEngine.playBlip();
        } catch {chatError('Chưa xóa được lịch sử.',()=>btnClearChat.click());}
        finally{clearingChat=false;btnClearChat.disabled=false;document.getElementById('btn-send-message').disabled=false;}
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
        document.getElementById("level-chip-text").textContent = `JLPT ${lvl}`;
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
      switchTab('flashcards',{level:btn.dataset.lvl});
    });
  });

  // Flashcard Flipper click
  const fcCard = document.getElementById("flashcard-card");
  if (fcCard) {
    fcCard.addEventListener("keydown",e=>{if(e.target===fcCard && (e.key==="Enter" || e.key===" ")){e.preventDefault();fcCard.click();}});
    fcCard.addEventListener("click",event=>{
      if(event.target.closest('details,button'))return;
      soundEngine.playFlip();const back=!fcCard.classList.contains('flipped');
      fcCard.classList.toggle('flipped',back);updateFlashcardFace(fcCard,back);
    });
  }

  // Flashcard audio TTS
  const btnFcAudioFront = document.getElementById("btn-fc-audio-front");
  if (btnFcAudioFront) {
    btnFcAudioFront.addEventListener("click", (e) => {
      e.stopPropagation();
      const txt = document.getElementById("fc-front-text")?.textContent;
      if (txt) playGeminiTTS(txt,{japaneseOnly:true,reading:singleSpeechReading(fcDeck[fcIdx]?.reading)});
    });
  }

  const btnFcAudioBack = document.getElementById("btn-fc-audio-back");
  if (btnFcAudioBack) {
    btnFcAudioBack.addEventListener("click", (e) => {
      e.stopPropagation();
      const txt = document.getElementById("fc-example-jp")?.textContent;
      if (txt) playGeminiTTS(txt,{japaneseOnly:true});
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
    if(!pendingCardAnswers.has(card.id))pendingCardAnswers.set(card.id,{item_id:card.id,display:card.front,level:card.level,item_type:'vocabulary',correct:isCorrect,quality,basis:'self_report',attempt_id:crypto.randomUUID()});
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
      if (jp) playGeminiTTS(jp,{japaneseOnly:true});
    });
  }

  const kaiwaInput=document.getElementById('kaiwa-manual-input');

  // Kaiwa Evaluation submit
  let kaiwaFeedbackVersion = 0;
  function clearKaiwaFeedback() {
    kaiwaFeedbackVersion++;
    const card = document.getElementById("kaiwa-result-card");
    if (card) card.hidden = true;
    const criteria = document.getElementById("kaiwa-criteria");
    if (criteria) criteria.replaceChildren();
    for (const id of ["kaiwa-feedback-text", "kaiwa-model-text"]) {
      const element = document.getElementById(id);
      if (element) element.textContent = "";
    }
    const score = document.getElementById("kaiwa-score-val");
    if (score) score.textContent = "Not graded";
    const error = document.getElementById("kaiwa-error");
    if (error) {error.textContent = "";error.hidden = true;}
  }
  globalThis.clearKaiwaFeedback = clearKaiwaFeedback;
  kaiwaInput?.addEventListener("input", clearKaiwaFeedback);
  const btnEvalKaiwa = document.getElementById("btn-eval-kaiwa");
  if (btnEvalKaiwa && kaiwaInput) {
    btnEvalKaiwa.addEventListener("click", async () => {
      if (btnEvalKaiwa.disabled) return;
      clearKaiwaFeedback();
      const speech = kaiwaInput.value.trim();
      if (!speech) {
        const error = document.getElementById('kaiwa-error');
        error.textContent = 'Nói hoặc nhập câu trả lời trước khi nhận xét. Nothing has been graded.'; error.hidden = false;
        kaiwaInput.focus();
        return;
      }

      btnEvalKaiwa.disabled=true;
      const evaluationKey=activeKaiwaKey,evaluationIndex=activeKaiwaPromptIdx,evaluationLevel=activeKaiwaLevel,
        evaluationNavigation=navigationVersion,evaluationVersion=kaiwaFeedbackVersion;
      const stillCurrent = () => evaluationKey === activeKaiwaKey && evaluationIndex === activeKaiwaPromptIdx
        && evaluationLevel === activeKaiwaLevel && evaluationNavigation === navigationVersion
        && evaluationVersion === kaiwaFeedbackVersion && kaiwaInput.value.trim() === speech;
      const resultCard = document.getElementById("kaiwa-result-card");
      const scoreVal = document.getElementById("kaiwa-score-val");
      const criteriaList = document.getElementById("kaiwa-criteria");
      const feedbackText = document.getElementById("kaiwa-feedback-text");
      const modelText = document.getElementById("kaiwa-model-text");
      btnEvalKaiwa.textContent = "Đang nhận xét…";
      const s = window.JLPT_DATA?.kaiwaScenarios?.[activeKaiwaKey];

      try {
        const resp = await apiFetch("/api/kaiwa/evaluate", {
          method: "POST", signal: AbortSignal.timeout(35000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenario_id: activeKaiwaKey,
            prompt_index: activeKaiwaPromptIdx % Math.max(s?.prompts?.length || 0, 1),
            user_speech: speech,
            level: activeKaiwaLevel
          })
        });

        const evalData = await resp.json();
        if (!stillCurrent()) return;
        const estimated = evalData?.status === 'estimated' && evalData.reason === 'model_judgment'
          && Number.isInteger(evalData.estimated_score) && evalData.estimated_score >= 0 && evalData.estimated_score <= 100
          && ['meets_requirements', 'incomplete', 'needs_practice', 'off_topic'].includes(evalData.conclusion);
        const uncertain = evalData?.status === 'ungraded' && evalData.reason === 'insufficient_evidence'
          && evalData.estimated_score === null && evalData.conclusion === 'uncertain';
        const assessment = resp.ok && (estimated || uncertain) && evalData.score === null && evalData.rating === null
          && evalData.user_text === speech && typeof evalData.feedback === 'string' && evalData.feedback.trim()
          && typeof evalData.model_answer === 'string' && evalData.model_answer.trim() && evalData.model_answer.length <= 2000
          && Array.isArray(evalData.criteria) && evalData.criteria.length >= 3 && evalData.criteria.length <= 10
          && evalData.criteria.every(item => item && typeof item.label === 'string' && item.label.trim() && item.label.length <= 1000
            && ['met', 'partial', 'not_met', 'uncertain'].includes(item.verdict)
            && Array.isArray(item.evidence) && item.evidence.length <= 8
            && (!['met', 'partial'].includes(item.verdict) || item.evidence.length > 0)
            && item.evidence.every(span => typeof span === 'string' && span.trim() && span.length <= 1200 && speech.includes(span)));
        if (assessment) {
          if (scoreVal) scoreVal.textContent = estimated ? `${evalData.estimated_score}/100 (estimated)` : 'Not graded';
          if (feedbackText) feedbackText.textContent = evalData.feedback;
          if (modelText) modelText.textContent = evalData.model_answer;
          const labels = {met: 'Met', partial: 'Partly met', not_met: 'Not met', uncertain: 'Uncertain'};
          for (const item of evalData.criteria) {
            const row = document.createElement('li');
            row.textContent = `${item.label}: ${labels[item.verdict]}${item.evidence.length ? ' — ' + item.evidence.join(' / ') : ''}`;
            criteriaList?.append(row);
          }
        } else {
          if (feedbackText) feedbackText.textContent = !resp.ok && typeof evalData?.detail === 'string'
            ? evalData.detail : "No verified assessment is available. Nothing has been graded.";
        }
        if (resultCard) resultCard.hidden = false;
      } catch {
        if (!stillCurrent()) return;
        if (feedbackText) feedbackText.textContent = "Unable to retrieve AI advice. Nothing has been graded.";
        if (resultCard) resultCard.hidden = false;
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
      if (txt) playGeminiTTS(txt,{japaneseOnly:true});
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
      switchTab('quiz',{level:btn.dataset.lvl});
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
  mascotMgr.updateAllSpriteElements();

  setupWorkspace();
  await setupAccount();
  if(signedInUser && !signedInUser.is_admin)await window.loadVoiceProfiles?.();

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
        chipText.textContent = `JLPT ${prof.level}`;
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
  await loadChatHistory();

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

async function startReversedLesson(item,level,skill,owner=null){
  if(sendingMessage || clearingChat || chatHistoryLoading || failedChatMessage){
    chatError('Gửi xong hoặc bỏ tin nhắn hiện tại trước khi mở bài học khác.',null);return;
  }
  chatLessonContext=buildLessonContext(item,level,skill);
  updateHeroTopic({display:item.title || item.jp,meaning:item.roleplay?.goal || item.summary || item.meaning_vi || '',jlpt_level:level});
  const host=document.getElementById('chat-lesson-context');host.hidden=false;host.replaceChildren();
  const title=document.createElement('strong');title.textContent=`${level} · ${item.title || item.jp}`;
  const back=document.createElement('button');back.className='stage-btn';back.textContent='Về bài học';back.onclick=()=>showLessonDetail(item,level,skill,false,owner);
  const general=document.createElement('button');general.className='stage-btn';general.textContent='Chat chung';
  general.onclick=async()=>{if(sendingMessage || clearingChat || chatHistoryLoading || failedChatMessage)return;chatLessonContext=null;globalThis.clearTeacherContext?.();host.hidden=true;await loadChatHistory();};
  const restart=document.createElement('button');restart.type='button';restart.className='stage-btn';restart.textContent='Bắt đầu lại buổi học';restart.onclick=restartTutorConversation;
  const control=document.createElement('div');host.append(title,back,general,restart,control);mountCompletion(control,{activity_id:`chat:${chatLessonContext.id}`,kind:'chat',level,title:`Giải thích lại: ${item.title || item.jp}`});
  const count=await loadChatHistory();
  if(chatHistoryReady && count===0)await sendMessage('Thầy hỏi em về bài này nhé.',false,{intent:'start'});
}
