// Settings: the learner's own API (OpenAI-compatible, Claude or Gemini). Admin: activity.
(function () {
  const el = id => document.getElementById(id);
  const BASES = {openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com'};
  const PRESETS = {openai: [], anthropic: ['claude-sonnet-5-5', 'claude-haiku-5-5'], gemini: ['gemini-3.8-flash', 'gemini-3.5-flash-lite']};
  const KIND = {google: 'Google', email: 'Email'};
  async function call(path, options) {
    const response = await apiFetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Không thực hiện được. Hãy thử lại.');
    return data;
  }
  const send = (path, method, body) => call(path, {method, headers: {'Content-Type': 'application/json'}, body: body && JSON.stringify(body)});

  // Keeps the segmented control, URL placeholder and model suggestions in step with the hidden select.
  function syncProtocol() {
    const protocol = el('ai-protocol').value;
    document.querySelectorAll('#ai-segments button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.protocol === protocol)));
    el('ai-base').placeholder = BASES[protocol];
    el('ai-models').replaceChildren(...PRESETS[protocol].map(model => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.textContent = model;
      chip.onclick = () => { el('ai-model').value = model; };
      return chip;
    }));
  }
  const pill = (state, text) => { el('ai-pill').dataset.state = state; el('ai-pill').textContent = text; };

  function renderAccountCard() {
    const user = signedInUser;
    if (!user) return;
    el('settings-initial').textContent = (user.name || '?').trim().charAt(0).toUpperCase();
    el('settings-name').textContent = user.name || 'Học viên';
    el('settings-email').textContent = user.email || '';
    el('settings-kind').textContent = user.user_id.startsWith('google:') ? KIND.google : KIND.email;
  }

  async function renderSettings() {
    renderAccountCard();
    const status = el('ai-status');
    status.textContent = '';
    try {
      const data = await call('/api/ai/settings');
      const own = data.own;
      el('ai-source').textContent = data.source === 'none' ? 'Thêm API key để chat với thầy Lâm.' : '';
      el('ai-source').hidden = data.source !== 'none';
      pill(own ? 'saved' : 'none', own ? 'Đã lưu ••••' + own.key_last4 : 'Chưa kết nối');
      el('ai-protocol').value = own?.protocol || 'openai';
      el('ai-base').value = own?.base_url || '';
      syncProtocol();
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
    window.renderAdminUsers?.();
  }

  window.renderAiPanels = tab => (tab === 'admin' ? renderAdmin() : renderSettings());

  // There is no built-in AI: chat stays closed (with one clear next step) until the learner saves an API.
  const openAiSettings = () => {
    switchTab('settings');
    setTimeout(() => { el('ai-card').scrollIntoView({block: 'start'}); document.querySelector('#ai-segments button').focus({preventScroll: true}); }, 250);
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

  document.querySelectorAll('#ai-segments button').forEach(button => button.addEventListener('click', () => { el('ai-protocol').value = button.dataset.protocol; syncProtocol(); }));
  el('ai-key-toggle').addEventListener('click', () => {
    const show = el('ai-key').type === 'password';
    el('ai-key').type = show ? 'text' : 'password';
    el('ai-key-toggle').textContent = show ? 'Ẩn' : 'Hiện';
    el('ai-key-toggle').setAttribute('aria-pressed', String(show));
  });
  el('settings-logout').addEventListener('click', () => el('auth-logout').click());
  document.querySelectorAll('.settings-nav button').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.settings-nav button').forEach(b => b.removeAttribute('aria-current'));
    button.setAttribute('aria-current', 'true');
    el(button.dataset.target).scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
  }));
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
    pill(connected ? 'ok' : 'error', connected ? 'Kết nối được' : 'Lỗi kết nối');
    el('ai-chat').hidden = !connected;
    window.checkAiReady();
  });
  el('ai-remove').addEventListener('click', async () => {
    if (!confirm('Xóa API key đã lưu?')) return;
    try { await send('/api/ai/settings', 'DELETE'); await renderSettings(); window.checkAiReady(); } catch (error) { el('ai-status').textContent = error.message; }
  });
})();
