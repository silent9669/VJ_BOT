// Settings: the learner's own API (OpenAI-compatible, Claude or Gemini). Admin: activity.
(function () {
  const el = id => document.getElementById(id);
  const BASES = {openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com'};
  const SOURCE = {own: 'Đang dùng API của bạn.', none: 'Chưa có API. Thêm API key để chat với thầy Lâm.'};
  async function call(path, options) {
    const response = await apiFetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Không thực hiện được. Hãy thử lại.');
    return data;
  }
  const send = (path, method, body) => call(path, {method, headers: {'Content-Type': 'application/json'}, body: body && JSON.stringify(body)});

  async function renderSettings() {
    const status = el('ai-status');
    status.textContent = '';
    try {
      const data = await call('/api/ai/settings');
      const own = data.own;
      el('ai-source').textContent = SOURCE[data.source];
      el('ai-protocol').value = own?.protocol || 'openai';
      el('ai-base').value = own?.base_url || '';
      el('ai-base').placeholder = BASES[el('ai-protocol').value];
      el('ai-model').value = own?.model || '';
      el('ai-key').value = '';
      el('ai-key').placeholder = own ? '••••' + own.key_last4 : 'sk-…';
      el('ai-key').required = !own;
      el('ai-remove').hidden = !own;
      el('ai-save').disabled = !data.can_store;
      if (!data.can_store) status.textContent = 'Máy chủ chưa bật lưu API key.';
    } catch (error) { status.textContent = error.message; }
  }

  async function renderAdmin() {
    const stats = el('admin-stats');
    try {
      const data = await call('/api/admin/overview');
      const tiles = [['Người dùng', data.users], ['Hoạt động 7 ngày', data.active_7d], ['Tin nhắn 24 giờ', data.messages_24h], ['API riêng', data.own_api_users]];
      stats.replaceChildren(...tiles.map(([label, value]) => {
        const tile = document.createElement('div'), number = document.createElement('strong'), name = document.createElement('span');
        number.textContent = value; name.textContent = label; tile.append(number, name);
        return tile;
      }));
      el('admin-top').replaceChildren(...(data.top.length ? data.top : [{name: 'Chưa có hoạt động.', messages: ''}]).map(row => {
        const line = document.createElement('p'), name = document.createElement('span'), count = document.createElement('b');
        name.textContent = row.name; count.textContent = row.messages;
        line.append(name, count);
        return line;
      }));
    } catch (error) { stats.textContent = error.message; }
  }

  window.renderAiPanels = tab => (tab === 'admin' ? renderAdmin() : renderSettings());

  // There is no built-in AI: chat stays closed (with one clear next step) until the learner saves an API.
  const openAiSettings = () => {
    switchTab('settings');
    setTimeout(() => { el('ai-card').scrollIntoView({block: 'start'}); el('ai-protocol').focus({preventScroll: true}); }, 250);
  };
  async function aiSource() {
    try { return (await call('/api/ai/settings')).source; } catch { return 'unknown'; }
  }
  window.checkAiReady = async () => {
    const source = await aiSource(), room = document.querySelector('.classroom-chat-window'), none = source === 'none';
    room.dataset.ai = source === 'unknown' ? 'unknown' : none ? 'none' : 'ready';
    el('chat-ai-gate').hidden = !none;
    el('chat-input').disabled = none;
    el('btn-send-message').disabled = none;
    if (!none && /Cài đặt/.test(el('chat-error-text').textContent)) chatError('', null);
  };
  window.mountAiBanner = async host => {
    if (await aiSource() !== 'none') return;
    const banner = document.createElement('div'), text = document.createElement('p'), open = document.createElement('button');
    banner.className = 'ai-banner';
    text.textContent = 'Kết nối API để chat với thầy Lâm.';
    open.type = 'button'; open.className = 'public-cta'; open.textContent = 'Thêm API';
    open.onclick = openAiSettings;
    banner.append(text, open);
    host.prepend(banner);
  };
  el('chat-gate-open').addEventListener('click', openAiSettings);
  el('ai-chat').addEventListener('click', () => switchTab('classroom'));

  el('ai-protocol').addEventListener('change', () => { el('ai-base').placeholder = BASES[el('ai-protocol').value]; });
  el('ai-form').addEventListener('submit', async event => {
    event.preventDefault();
    const status = el('ai-status'), save = el('ai-save');
    let connected = false;
    save.disabled = true;
    status.textContent = 'Đang lưu…';
    try {
      await send('/api/ai/settings', 'PUT', {protocol: el('ai-protocol').value, base_url: el('ai-base').value, model: el('ai-model').value.trim(), api_key: el('ai-key').value.trim()});
      status.textContent = 'Đang kiểm tra…';
      await send('/api/ai/test', 'POST', {});
      status.textContent = 'Kết nối được.';
      connected = true;
    } catch (error) { status.textContent = error.message; }
    save.disabled = false;
    const kept = status.textContent;
    await renderSettings();
    status.textContent = kept;
    el('ai-chat').hidden = !connected;
    window.checkAiReady();
  });
  el('ai-remove').addEventListener('click', async () => {
    if (!confirm('Xóa API key đã lưu?')) return;
    try { await send('/api/ai/settings', 'DELETE'); await renderSettings(); window.checkAiReady(); } catch (error) { el('ai-status').textContent = error.message; }
  });
})();
