// Settings: the learner's own API (OpenAI-compatible, Claude or Gemini). Admin: platform AI and activity.
(function () {
  const el = id => document.getElementById(id);
  const BASES = {openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com'};
  const SOURCE = {own: 'Đang dùng API của bạn.', platform: 'Đang dùng AI của hệ thống.', none: 'Chưa có API. Thêm API key để chat với thầy Lâm.'};
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
    const stats = el('admin-stats'), status = el('admin-status');
    status.textContent = '';
    try {
      const data = await call('/api/admin/overview');
      const tiles = [['Người dùng', data.users], ['Hoạt động 7 ngày', data.active_7d], ['Tin nhắn 24 giờ', data.messages_24h], ['API riêng', data.own_api_users]];
      stats.replaceChildren(...tiles.map(([label, value]) => {
        const tile = document.createElement('div'), number = document.createElement('strong'), name = document.createElement('span');
        number.textContent = value; name.textContent = label; tile.append(number, name);
        return tile;
      }));
      el('admin-protocol').value = data.platform.protocol;
      el('admin-model').value = data.platform.model;
      el('admin-fallbacks').value = data.platform.fallbacks.join(', ');
      el('admin-key').textContent = data.platform.has_key ? 'Đã có khóa AI hệ thống.' : 'Chưa có khóa AI hệ thống.';
      el('admin-top').replaceChildren(...(data.top.length ? data.top : [{name: 'Chưa có hoạt động.', messages: ''}]).map(row => {
        const line = document.createElement('p'), name = document.createElement('span'), count = document.createElement('b');
        name.textContent = row.name; count.textContent = row.messages;
        line.append(name, count);
        return line;
      }));
    } catch (error) { stats.textContent = error.message; }
  }

  window.renderAiPanels = tab => (tab === 'admin' ? renderAdmin() : renderSettings());

  // Chat is unavailable without an API: say so before the learner types a message.
  window.checkAiReady = async () => {
    try {
      const data = await call('/api/ai/settings');
      if (data.source === 'none') chatError('Thêm API key của bạn trong Cài đặt để chat với thầy Lâm.', null);
    } catch { /* the send path reports its own errors */ }
  };

  el('ai-protocol').addEventListener('change', () => { el('ai-base').placeholder = BASES[el('ai-protocol').value]; });
  el('ai-form').addEventListener('submit', async event => {
    event.preventDefault();
    const status = el('ai-status'), save = el('ai-save');
    save.disabled = true;
    status.textContent = 'Đang lưu…';
    try {
      await send('/api/ai/settings', 'PUT', {protocol: el('ai-protocol').value, base_url: el('ai-base').value, model: el('ai-model').value.trim(), api_key: el('ai-key').value.trim()});
      status.textContent = 'Đang kiểm tra…';
      await send('/api/ai/test', 'POST', {});
      status.textContent = 'Kết nối được.';
    } catch (error) { status.textContent = error.message; }
    save.disabled = false;
    const kept = status.textContent;
    await renderSettings();
    status.textContent = kept;
  });
  el('ai-remove').addEventListener('click', async () => {
    if (!confirm('Xóa API key đã lưu?')) return;
    try { await send('/api/ai/settings', 'DELETE'); await renderSettings(); } catch (error) { el('ai-status').textContent = error.message; }
  });
  el('admin-form').addEventListener('submit', async event => {
    event.preventDefault();
    const status = el('admin-status');
    try {
      await send('/api/admin/provider', 'PUT', {protocol: el('admin-protocol').value, model: el('admin-model').value.trim(), fallbacks: el('admin-fallbacks').value.split(',').map(s => s.trim()).filter(Boolean)});
      status.textContent = 'Đã lưu.';
    } catch (error) { status.textContent = error.message; }
  });
  el('admin-test').addEventListener('click', async () => {
    const status = el('admin-status');
    status.textContent = 'Đang kiểm tra…';
    try { await send('/api/admin/test', 'POST', {}); status.textContent = 'Kết nối được.'; } catch (error) { status.textContent = error.message; }
  });
})();
