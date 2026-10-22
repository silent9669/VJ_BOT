const STORAGE_KEY = "nihongo_sensei_user_id";

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  // crypto.randomUUID is secure-context only, and the UI must also work over LAN http.
  return Math.random().toString(36).slice(2, 10);
}

function getUserId() {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = `user_${newId()}`;
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

const userId = getUserId();
const chatContainer = document.getElementById("chat-container");
const input = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const progressPanel = document.getElementById("progress-panel");
const progressContent = document.getElementById("progress-content");
const progressToggle = document.getElementById("progress-toggle");
const levelPicker = document.getElementById("level-picker");
const levelChip = document.getElementById("level-chip");
const pickerError = document.getElementById("picker-error");

function scrollDown() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function renderBubble(role, content) {
  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${role}`;
  bubble.textContent = content;
  chatContainer.appendChild(bubble);
  scrollDown();
  return bubble;
}

async function loadHistory() {
  const response = await fetch(`/api/history?user_id=${encodeURIComponent(userId)}`);
  if (!response.ok) return;
  const messages = await response.json();
  chatContainer.replaceChildren();
  for (const message of messages) renderBubble(message.role, message.content);
  return messages;
}

async function sendMessage(text) {
  const bubble = renderBubble("user", text);
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, message: text }),
  });

  if (!response.ok) {
    bubble.remove();
    const detail = await response.json().catch(() => ({}));
    renderBubble("bot", detail.detail || "エラーが発生しました。");
    return;
  }

  const data = await response.json();
  renderBubble("bot", data.reply);
  loadProgress();
}

async function loadProgress() {
  const response = await fetch(`/api/progress?user_id=${encodeURIComponent(userId)}`);
  if (!response.ok) return;
  const summary = await response.json();

  progressContent.replaceChildren();
  const levels = Object.entries(summary.level_breakdown || {});
  if (levels.length === 0) {
    progressContent.textContent = "まだデータがありません。";
    return;
  }

  for (const [level, skills] of levels) {
    const block = document.createElement("div");
    block.className = "progress-level";
    const title = document.createElement("h3");
    title.textContent = level;
    block.appendChild(title);

    for (const [skill, accuracy] of Object.entries(skills)) {
      const bar = document.createElement("div");
      bar.className = "bar";
      const fill = document.createElement("span");
      fill.style.width = `${Math.max(0, Math.min(100, accuracy))}%`;
      bar.appendChild(fill);
      bar.title = `${skill}: ${accuracy}%`;
      block.appendChild(bar);
    }
    progressContent.appendChild(block);
  }
}

async function loadGreeting() {
  const response = await fetch(`/api/chat/greeting?user_id=${encodeURIComponent(userId)}`);
  if (!response.ok) {
    renderBubble("bot", "接続できませんでした。後でもう一度お試しください。");
    return;
  }
  const data = await response.json();
  renderBubble("bot", data.reply);
}

function autoResize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}

function submit() {
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  autoResize();
  sendMessage(text);
}

sendBtn.addEventListener("click", submit);
input.addEventListener("input", autoResize);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
});
progressToggle.addEventListener("click", () => {
  progressPanel.hidden = !progressPanel.hidden;
});

function showPicker() {
  pickerError.hidden = true;
  levelPicker.hidden = false;
}

async function startChat() {
  const messages = await loadHistory();
  if (!messages || messages.length === 0) await loadGreeting();
  await loadProgress();
}

async function saveLevel(level) {
  const response = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, level }),
  });
  if (!response.ok) {
    pickerError.textContent = "Không lưu được trình độ. Thử lại.";
    pickerError.hidden = false;
    return;
  }
  levelPicker.hidden = true;
  levelChip.textContent = level === "beginner" ? "Chưa học" : level;
  chatContainer.replaceChildren();
  await startChat();
}

for (const button of levelPicker.querySelectorAll("[data-level]")) {
  button.addEventListener("click", () => saveLevel(button.dataset.level));
}
levelChip.addEventListener("click", showPicker);

(async function init() {
  const response = await fetch(`/api/profile?user_id=${encodeURIComponent(userId)}`);
  if (response.status === 404) {
    showPicker();
    return;
  }
  if (!response.ok) {
    showPicker();
    pickerError.textContent = "Không tải được hồ sơ. Thử lại.";
    pickerError.hidden = false;
    return;
  }
  const profile = await response.json();
  levelChip.textContent = profile.level === "beginner" ? "Chưa học" : profile.level;
  await startChat();
})();
