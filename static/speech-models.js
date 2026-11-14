// Catalog entries are candidates, not successful synthesis or pricing guarantees.
(function () {
  const select = document.getElementById('speech-model');
  const status = document.getElementById('speech-model-status');
  const refresh = document.getElementById('speech-model-refresh');
  const accounts = document.getElementById('speech-profile');
  const hint = document.getElementById('ai-oauth-voice-hint');
  const form = document.getElementById('speech-key-form'), addKey = document.getElementById('speech-key-add');
  const key = document.getElementById('speech-key'), keyName = document.getElementById('speech-key-name');
  const keyProvider = document.getElementById('speech-key-provider'), modelLabel = document.getElementById('speech-model-label');
  const storage = document.getElementById('speech-key-storage'), save = document.getElementById('speech-key-save');
  const keyToggle = document.getElementById('speech-key-toggle'), formStatus = document.getElementById('speech-key-status');
  const test = document.getElementById('speech-test');
  let formOwner = null, formRevision = 0, saving = false;
  const defaults = {gemini:'gemini-3.8-flash-tts', openai:'gpt-4o-mini-tts'};
  const preference = key => 'vjbot_speech_model:' + key;
  const owner = () => typeof signedInUser === 'undefined' ? null : signedInUser?.user_id;
  const managed = () => typeof signedInUser !== 'undefined' && signedInUser?.is_admin === true;
  const compatible = (model, protocol = provider()) => typeof model === 'string' && model.length <= 100
    && (protocol === 'openai' ? model === defaults.openai
      : protocol === 'gemini' && /^gemini-3\.8-flash(?:-lite)?-tts(?:-[a-z0-9-]+)?$/.test(model));
  const native = row => (row.protocol === 'gemini' && row.base_url === 'https://generativelanguage.googleapis.com')
    || (row.protocol === 'openai' && row.base_url === 'https://api.openai.com/v1');
  const reference = row => row && row.scope !== 'none' ? `${row.scope}:${row.id}` : '';
  let pending = null, version = 0, metadataOwner = null, metadataAdmin = false, profiles = [], platform = null;
  let catalogIdentity = '', catalogModels = [];
  function voiceRows() {
    if (metadataOwner !== owner()) return [];
    return profiles.filter(native);
  }
  function provider() {
    if (managed()) return 'openai';
    try {
      const selected = window.VJProfiles?.voice(owner());
      return voiceRows().find(row => reference(row) === reference(selected))?.protocol || '';
    } catch { return ''; }
  }
  function identity() {
    const user = owner();
    if (!user) return '';
    if (managed()) return JSON.stringify([user, 'platform', 'openai']);
    try {
      const profile = window.VJProfiles?.voice(user);
      return profile && ((['local', 'server'].includes(profile.scope) && profile.id)
        || (profile.scope === 'platform' && profile.id === 'openai'))
        ? JSON.stringify([user, profile.scope, profile.id]) : '';
    } catch { return ''; }
  }
  function choice(key = identity()) {
    if (managed()) return owner() ? defaults.openai : '';
    if (!key || !provider()) return '';
    try {
      const saved = localStorage.getItem(preference(key));
      if (saved === null) return defaults[provider()];
      if (compatible(saved)) return saved;
      status.textContent = 'Model giọng nói đã lưu không hợp lệ. Hãy tải lại và chọn model.';
    } catch { status.textContent = 'Không lưu được lựa chọn giọng nói. Hãy bật lại bộ nhớ của trang rồi dùng đọc thành tiếng.'; }
    return '';
  }
  function draw(models, selected) {
    select.replaceChildren();
    for (const model of [...new Set([selected, ...models])]) {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model || 'Chọn model giọng nói';
      select.append(option);
    }
    select.value = selected;
  }
  function closeKeyForm() {
    formRevision++; formOwner = null;
    form.reset(); form.hidden = true;
    key.type = 'password'; keyToggle.textContent = 'Hiện';
    keyToggle.setAttribute('aria-pressed', 'false');
    keyToggle.setAttribute('aria-label', 'Hiện API key giọng nói');
    addKey.setAttribute('aria-expanded', 'false');
  }
  async function saveKey(event) {
    event.preventDefault();
    if (managed() || saving || !form.reportValidity()) return;
    const user = owner();
    if (!user || formOwner !== user) { closeKeyForm(); return; }
    const ticket = ++formRevision;
    saving = true; save.disabled = true;
    form.setAttribute('aria-busy', 'true');
    formStatus.textContent = 'Đang lưu kết nối đã mã hóa…';
    try {
      if (typeof window.saveVoiceProfile !== 'function') throw new Error('Phần giọng nói chưa tải được. Hãy tải lại Cài đặt.');
      const saved = await window.saveVoiceProfile(user, {name:keyName.value.trim(), api_key:key.value.trim(), protocol:keyProvider.value}, storage.value);
      if (owner() !== user || managed()) return;
      const chooseSaved = ticket === formRevision;
      closeKeyForm();
      if (chooseSaved) window.VJProfiles.setVoice(user, {scope:saved.scope, id:saved.id});
      sync();
      status.textContent = chooseSaved
        ? `Đã lưu ${saved.name}. Bấm Nghe thử để kiểm tra quyền dùng giọng nói.`
        : `Đã lưu ${saved.name}. Lựa chọn giọng nói mới hơn của em được giữ nguyên.`;
      if (chooseSaved) accounts.focus();
    } catch (error) {
      if (owner() === user && ticket === formRevision) formStatus.textContent = error.message || 'Không lưu được tài khoản giọng nói.';
    } finally {
      saving = false; save.disabled = false; addKey.disabled = !owner() || managed();
      form.setAttribute('aria-busy', 'false');
    }
  }
  function sync(preserveRequest = false) {
    const message = status.textContent;
    if (!preserveRequest) { pending?.abort(); pending = null; version++; }
    const user = owner(), admin = managed(), key = identity();
    if (formOwner && (formOwner !== user || admin)) closeKeyForm();
    addKey.hidden = accounts.hidden = admin;
    document.getElementById('speech-account-controls').hidden = admin;
    document.getElementById('speech-personal-setup').hidden = admin;
    document.getElementById('speech-managed-summary').hidden = !admin;
    addKey.disabled = !user || admin || saving;
    if (metadataOwner !== user || metadataAdmin !== admin) { metadataOwner = null; profiles = []; platform = null; }
    if (catalogIdentity !== key) { catalogIdentity = key; catalogModels = []; }
    if (admin) {
      accounts.replaceChildren();
      select.disabled = refresh.disabled = true;
      test.disabled = !user || platform?.configured === false;
      status.textContent = platform?.configured === false
        ? 'OpenAI quản trị chưa được cấu hình. Cần đặt OPENAI_API_KEY trên máy chủ; API cá nhân không được dùng thay thế.'
        : 'OpenAI máy chủ · gpt-4o-mini-tts · alloy. Không cần chọn API hoặc tài khoản giọng nói.';
      draw([], user ? defaults.openai : '');
      return;
    }
    let selected = null, invalid = false;
    try { selected = user && window.VJProfiles?.voice(user); } catch { invalid = true; }
    const rows = voiceRows();
    accounts.replaceChildren();
    const empty = document.createElement('option');
    empty.value = ''; empty.textContent = invalid ? 'Lựa chọn giọng nói không dùng được · hãy chọn lại' : 'Chọn tài khoản giọng nói đã lưu';
    accounts.append(empty);
    for (const scope of ['local', 'server']) {
      const group = document.createElement('optgroup');
      group.label = scope === 'local' ? 'Thiết bị này · đã mã hóa' : 'Máy chủ · đã mã hóa';
      for (const row of rows.filter(row => row.scope === scope)) {
        const option = document.createElement('option');
        option.value = reference(row); option.textContent = row.name; group.append(option);
      }
      if (group.children.length) accounts.append(group);
    }
    const selectedRow = rows.find(row => reference(row) === reference(selected));
    if (key && !selectedRow) {
      const missing = document.createElement('option');
      missing.value = reference(selected); missing.textContent = 'Tài khoản giọng nói đã chọn không dùng được · hãy chọn tài khoản khác';
      accounts.append(missing);
    }
    accounts.value = reference(selected);
    accounts.disabled = !user;
    select.disabled = test.disabled = !key || !selectedRow;
    refresh.disabled = select.disabled || Boolean(pending);
    hint.textContent = 'Giọng nói dùng tài khoản Gemini gốc hoặc OpenAI chính thức đã lưu riêng, độc lập với chat.';
    modelLabel.textContent = selectedRow ? `Model giọng nói · ${selectedRow.protocol === 'openai' ? 'alloy' : 'Charon'}` : 'Model giọng nói';
    status.textContent = invalid ? 'Không lưu được hoặc dữ liệu lựa chọn giọng nói bị lỗi. Hãy bật lại bộ nhớ hoặc chọn lại tài khoản giọng nói.' : key && !selectedRow
      ? 'Tài khoản giọng nói đã chọn không dùng được hoặc không được hỗ trợ. Hệ thống không tự thay thế.'
      : selectedRow ? '' : 'Hãy thêm hoặc chọn tài khoản giọng nói để dùng giọng nói.';
    draw(catalogModels, choice(key));
    if (preserveRequest) status.textContent = message;
  }
  async function update() {
    if (managed()) { sync(); return; }
    const key = identity();
    if (!key) { sync(); return; }
    pending?.abort();
    const controller = new AbortController(), request = ++version;
    pending = controller;
    const current = () => !controller.signal.aborted && request === version && key === identity();
    draw(catalogIdentity === key ? catalogModels : [], choice(key));
    status.textContent = `Đang tải model giọng nói ${provider() === 'openai' ? 'OpenAI' : 'Gemini'} tương thích. Không gửi thử âm thanh.`;
    refresh.disabled = true;
    try {
      const response = await apiFetch('/api/tts', {method:'POST', signal:controller.signal,
        headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'models'})});
      const data = await response.json();
      if (!current()) return;
      if (!response.ok) throw new Error(data.detail || 'Không tải lại được model giọng nói.');
      if (!Array.isArray(data.models) || data.models.length > 1000 || !data.models.every(model => compatible(model))) throw new Error('Danh sách model giọng nói không hợp lệ.');
      catalogIdentity = key; catalogModels = data.models;
      draw(data.models, choice(key));
      status.textContent = `${data.models.length} model giọng nói trong danh sách${data.truncated ? ' (danh sách một phần)' : ''}. Quyền truy cập được kiểm tra khi em nghe.`;
    } catch (error) {
      if (!current()) return;
      status.textContent = error.message || 'Không tải lại được model giọng nói. Lựa chọn của em không đổi.';
    } finally {
      if (request === version) { pending = null; refresh.disabled = false; }
    }
  }
  accounts.addEventListener('change', () => {
    if (managed()) { sync(); return; }
    const user = owner(), value = accounts.value;
    const row = voiceRows().find(row => reference(row) === value);
    if (!user || (value && !row)) { sync(); return; }
    try {
      window.VJProfiles.setVoice(user, row ? {scope:row.scope, id:row.id} : {scope:'none', id:''});
      sync();
    } catch (error) { sync(); status.textContent = error.message || 'Không lưu được tài khoản giọng nói.'; }
  });
  select.addEventListener('change', () => {
    if (managed()) { sync(); return; }
    const key = identity(), selected = select.value, previous = choice(key);
    if (!key || !compatible(selected)) return;
    try {
      localStorage.setItem(preference(key), selected);
      if (localStorage.getItem(preference(key)) !== selected) throw new Error('Không lưu được lựa chọn giọng nói.');
      if (previous !== selected) window.dispatchEvent(new Event('vjbot-voice-changed'));
    } catch { sync(); status.textContent = 'Không lưu được lựa chọn giọng nói. Hãy bật lại bộ nhớ của trang rồi dùng đọc thành tiếng.'; }
  });
  refresh.addEventListener('click', update);
  addKey.addEventListener('click', () => {
    if (!owner() || managed() || saving) return;
    formOwner = owner(); formRevision++;
    form.hidden = false; keyProvider.value = 'gemini'; keyName.value = 'Tài khoản giọng nói'; storage.value = 'local';
    formStatus.textContent = 'Việc lưu không tạo âm thanh và không đổi tài khoản chat.';
    addKey.setAttribute('aria-expanded', 'true'); keyName.focus();
  });
  document.getElementById('speech-key-cancel').addEventListener('click', () => { closeKeyForm(); addKey.focus(); });
  form.addEventListener('submit', saveKey);
  form.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeKeyForm(); addKey.focus(); }
  });
  keyToggle.addEventListener('click', () => {
    const show = key.type === 'password';
    key.type = show ? 'text' : 'password'; keyToggle.textContent = show ? 'Ẩn' : 'Hiện';
    keyToggle.setAttribute('aria-pressed', String(show));
    keyToggle.setAttribute('aria-label', show ? 'Ẩn API key giọng nói' : 'Hiện API key giọng nói');
  });
  test.addEventListener('click', () => {
    if (test.disabled) return;
    if (typeof window.playGeminiTTS !== 'function') { status.textContent = 'Điều khiển âm thanh chưa tải được. Hãy tải lại Cài đặt.'; return; }
    return window.playGeminiTTS('こんにちは。日本語をいっしょに練習しましょう。', {japaneseOnly:true});
  });
  window.addEventListener('pagehide', closeKeyForm);
  window.addEventListener('vjbot-voice-changed', () => { formRevision++; sync(); });
  window.addEventListener('storage', event => {
    if (managed()) return;
    if (identity() && event.key === preference(identity())) window.dispatchEvent(new Event('vjbot-voice-changed'));
  });
  window.renderVoiceProfiles = (user, rows, canStore = false, shared = null) => {
    if (user !== owner()) return;
    if (managed()) {
      metadataOwner = user; metadataAdmin = true; profiles = []; platform = shared;
      sync();
      return;
    }
    document.getElementById('speech-key-server').disabled = !canStore;
    const key = identity();
    const fingerprint = values => {
      const selected = key && values.find(row => JSON.stringify([user, row.scope, row.id]) === key);
      return selected ? JSON.stringify([selected.protocol, selected.base_url, selected.connection_id, selected.key_last4]) : '';
    };
    const changed = metadataOwner === user && key && fingerprint(profiles) !== fingerprint(rows);
    const preserveRequest = metadataOwner === user && catalogIdentity === key && !changed;
    if (changed) { catalogIdentity = ''; catalogModels = []; }
    metadataOwner = user; metadataAdmin = false; profiles = rows; platform = null;
    if (changed) window.dispatchEvent(new Event('vjbot-voice-changed'));
    else sync(preserveRequest);
  };
  window.voiceIdentity = identity;
  window.refreshSpeechModels = update;
  window.selectedSpeechModel = () => choice();
  sync();
})();
