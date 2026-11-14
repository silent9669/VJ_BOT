// Past conversations: the general chat and one thread per lesson. Switching reuses the chat loader.
(function () {
  const el = id => document.getElementById(id);
  const dialog = el('chat-history-dialog'), list = el('chat-history-list');
  if (!dialog || !list) return;
  const busy = () => sendingMessage || clearingChat || chatHistoryLoading || failedChatMessage;
  const when = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const today = new Date();
    return date.toDateString() === today.toDateString()
      ? date.toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit'})
      : date.toLocaleDateString('vi-VN', {day: '2-digit', month: '2-digit'});
  };
  const currentScope = () => chatLessonContext ? `lesson:${chatLessonContext.level}:${chatLessonContext.id}` : 'chat';
  function row(thread) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'history-row'; button.setAttribute('role', 'listitem');
    if (thread.scope === currentScope()) button.setAttribute('aria-current', 'true');
    const head = document.createElement('span'), title = document.createElement('strong'), time = document.createElement('time');
    title.textContent = thread.lesson ? `${thread.lesson.level} · ${thread.title}` : thread.title;
    time.textContent = when(thread.timestamp);
    head.append(title, time);
    const snippet = document.createElement('small');
    snippet.textContent = (thread.last_role === 'user' ? 'Em: ' : 'Thầy Lâm: ') + thread.snippet;
    button.append(head, snippet);
    button.onclick = () => open(thread);
    return button;
  }
  async function open(thread) {
    if (busy()) return;
    dialog.close();
    const host = el('chat-lesson-context');
    if (thread.lesson) {
      chatLessonContext = {id: thread.lesson.id, level: thread.lesson.level};
      host.replaceChildren();host.hidden = false;
      const name = document.createElement('strong');name.textContent = `${thread.lesson.level} · ${thread.title}`;
      const general = document.createElement('button');general.type = 'button';general.className = 'stage-btn';general.textContent = 'Trò chuyện chung';
      general.onclick = () => open({scope: 'chat', title: 'Trò chuyện chung'});
      host.append(name, general);
    } else {
      chatLessonContext = null; globalThis.clearTeacherContext?.(); host.hidden = true;
    }
    await loadChatHistory();
  }
  async function show() {
    if (busy()) return;
    list.replaceChildren();
    const loading = document.createElement('p');loading.className = 'history-empty';loading.textContent = 'Đang tải các cuộc trò chuyện…';list.append(loading);
    dialog.showModal();list.tabIndex = -1;list.focus({preventScroll: true});
    try {
      const response = await apiFetch('/api/history/threads');
      if (!response.ok) throw new Error('history');
      const threads = await response.json();
      list.replaceChildren(...(threads.length ? threads.map(row) : [Object.assign(document.createElement('p'), {className: 'history-empty', textContent: 'Chưa có cuộc trò chuyện nào.'})]));
    } catch {
      list.replaceChildren(Object.assign(document.createElement('p'), {className: 'history-empty', textContent: 'Chưa tải được lịch sử. Em đóng rồi mở lại Lịch sử để thử nhé.'}));
    }
  }
  el('btn-chat-history').addEventListener('click', show);
  el('chat-history-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
})();
