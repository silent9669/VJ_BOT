// Learners use saved API/OAuth connections; administrators use managed server OpenAI.
(function () {
  const el = id => document.getElementById(id);
  const BASES = {openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com'};
  let savedConnection = false, storageEnabled = false, modelRequest = 0, modelAbort = null, testing = false;
  let nextProbeAt = 0, timingIdentity = null, dispatchedAt = Object.freeze([]);
  let modelSnapshot = null;
  let activeScan = null, readiness = 0;
  let profileRows = [], selectedProfile = null, profileKey = '', rendering = 0;
  let profilesOwner = null, loadedProfile = null;
  const methodKey = owner => 'vjbot_ai_method:' + owner;
  const managed = () => signedInUser?.is_admin === true;
  const accountIdentity = () => JSON.stringify([signedInUser?.user_id || null, managed()]);
  let renderedIdentity = accountIdentity();
  const errorText = error => ['SecurityError', 'QuotaExceededError'].includes(error.name)
    ? 'Không truy cập được bộ nhớ trình duyệt. Cho phép lưu dữ liệu trang web hoặc giải phóng dung lượng rồi thử lại.'
    : error.name === 'TypeError' ? 'Chưa kết nối được. Em kiểm tra mạng rồi thử lại nhé. Chi tiết kết nối: ' + error.message
    : error.message;
  function connectionChoice() {
    const owner = signedInUser?.user_id;
    if (managed()) return 'platform';
    try {
      return window.usesAntigravityOAuth?.(owner)
        ? 'oauth:' + (window.antigravityConnectionId?.(owner) || '')
        : profileChoice(window.VJProfiles?.active(owner));
    } catch { return 'unavailable'; }
  }
  function refreshSavedConnections() {
    if (managed()) return;
    const list = el('ai-profile-list'), owner = signedInUser?.user_id;
    list.replaceChildren();
    const empty = document.createElement('option');
    empty.value = ''; empty.textContent = 'Chọn kết nối đã lưu'; list.append(empty);
    for (const [label, scope] of [['Khóa API · Thiết bị này', 'local'], ['Khóa API · Máy chủ', 'server'], ['Antigravity OAuth', 'oauth']]) {
      const rows = scope === 'oauth' ? window.savedOAuthConnections?.() || [] : profilesOwner === owner ? profileRows.filter(row => row.scope === scope) : [];
      if (!rows.length) continue;
      const group = document.createElement('optgroup'); group.label = label;
      for (const row of rows) {
        const option = document.createElement('option');
        option.value = scope === 'oauth' ? 'oauth:' + row.id : profileChoice(row);
        option.textContent = row.name;
        group.append(option);
      }
      list.append(group);
    }
    const choice = connectionChoice();
    const available = choice.startsWith('oauth:')
      ? (window.savedOAuthConnections?.() || []).some(row => 'oauth:' + row.id === choice)
      : profilesOwner === owner && profileRows.some(row => profileChoice(row) === choice);
    if (choice && choice !== 'oauth:' && !available) {
      const missing = document.createElement('option');
      missing.value = choice; missing.textContent = 'Kết nối đã chọn không dùng được · hãy chọn kết nối khác'; list.append(missing);
    }
    list.value = choice === 'oauth:' ? '' : choice;
    const currentProfile = choice.startsWith('oauth:')
      ? (window.savedOAuthConnections?.() || []).find(row => 'oauth:' + row.id === choice)
      : profilesOwner === owner && profileRows.find(row => profileChoice(row) === choice);
    el('ai-current-model').textContent = currentProfile?.model || 'Chưa chọn kết nối';
    el('ai-current-hint').textContent = currentProfile ? '' : 'Chọn kết nối đã lưu hoặc thêm kết nối.';
    el('ai-card').dataset.connected = String(Boolean(currentProfile?.model));
    el('ai-chat').hidden = !currentProfile?.model;
    window.renderVoiceProfiles?.(owner, profilesOwner === owner ? profileRows : [], profilesOwner === owner && storageEnabled);
  }
  window.refreshSavedConnections = refreshSavedConnections;
  const profileChoice = profile => profile && profile.scope !== 'none' ? `${profile.scope}:${profile.id}` : '';
  const draftKey = () => el('ai-key').value.trim() || (selectedProfile?.protocol === el('ai-protocol').value
    && selectedProfile?.base_url === el('ai-base').value.trim() ? profileKey : '');
  function storageHint() {
    const local = el('ai-profile-storage').value === 'local';
    el('ai-profile-storage-hint').textContent = local
      ? 'Được mã hóa trong trình duyệt này và không đồng bộ. Máy chủ chỉ nhận khóa khi gửi yêu cầu AI. Trình duyệt bị xâm nhập vẫn có thể đọc được khóa.'
      : 'Được mã hóa và lưu trên máy chủ theo tài khoản của em. Các thiết bị khác đăng nhập tài khoản này dùng được kết nối này.';
  }
  function fillProfile(profile, cache = null, key = '') {
    el('ai-form').hidden = false;
    selectedProfile = profile;
    savedConnection = Boolean(profile);
    el('ai-form').dataset.draft = String(!profile);
    el('ai-api-editor-title').textContent = profile ? 'Sửa kết nối dùng khóa API' : 'Thêm kết nối API';
    el('ai-api-back').hidden = Boolean(profile);
    el('ai-api-manage').open = !profile;
    el('ai-api-scan').open = Boolean(profile && !profile.model);
    profileKey = key;
    el('ai-profile-name').value = profile?.name || '';
    el('ai-profile-storage').value = profile?.scope || 'local';
    storageHint();
    el('ai-protocol').value = profile?.protocol || 'openai';
    el('ai-base').value = profile?.base_url || '';
    syncProtocol();
    el('ai-model').value = profile?.model || '';
    el('ai-key').value = '';
    el('ai-key').placeholder = profile ? '••••' + profile.key_last4 : 'sk-…';
    el('ai-key').type = 'password';
    el('ai-key-toggle').textContent = 'Hiện';
    el('ai-key-toggle').setAttribute('aria-label', 'Hiện khóa API');
    el('ai-key-toggle').setAttribute('aria-pressed', 'false');
    el('ai-key').required = !profile;
    el('ai-key-hint').textContent = profile ? 'Để trống để dùng lại khóa của kết nối này. Đổi URL hoặc loại API thì cần khóa mới.' : 'Chọn nơi lưu. Đừng dán khóa vào khung trò chuyện.';
    el('ai-remove').hidden = !profile;
    restoreModels(cache || (profile?.models?.length ? {models: profile.models, checkedAt: profile.checked_at} : null));
  }
  async function saveProfile(useModel) {
    const owner = signedInUser?.user_id, scope = el('ai-profile-storage').value;
    if (!owner || managed()) throw new Error('API cá nhân chỉ dành cho tài khoản học viên.');
    const model = el('ai-models').hidden ? '' : el('ai-model-list').value;
    if (useModel && !model) throw new Error('Hãy kiểm tra model và chọn một kết quả phản hồi được trước.');
    const snapshot = modelSnapshot;
    const draft = {name: el('ai-profile-name').value.trim(), protocol: el('ai-protocol').value,
      base_url: el('ai-base').value, model, api_key: draftKey(),
      models: [...el('ai-model-list').options].map(option => option.value),
      checked_at: snapshot?.checkedAt || selectedProfile?.checked_at || null,
      connection_id: snapshot?.identity || selectedProfile?.connection_id || null};
    if (!draft.name) throw new Error('Nhập tên kết nối.');
    const id = selectedProfile?.scope === scope ? selectedProfile.id : null;
    let profile;
    if (scope === 'local') {
      profile = await VJProfiles.save(owner, {...draft, ...(id ? {id} : {})});
    } else {
      const result = await send('/api/ai/profiles' + (id ? '/' + encodeURIComponent(id) : ''), id ? 'PUT' : 'POST', draft);
      profile = result.profile;
      await send(`/api/ai/profiles/${encodeURIComponent(profile.id)}/activate`, 'POST', {});
    }
    if (signedInUser?.user_id !== owner || managed()) throw new Error('Tài khoản hoặc quyền đăng nhập đã thay đổi.');
    VJProfiles.setActive(owner, {scope, id: profile.id});
    localStorage.setItem(methodKey(owner), 'key');
    window.aiConnectionChanged?.();
    modelSnapshot = null;
    return `Đã lưu ${profile.name} ${scope === 'local' ? 'trên thiết bị này' : 'vào tài khoản của em'}. ${model ? 'Đã chọn model đã lưu. Không gửi yêu cầu thử mới.' : 'Bấm Tìm model dùng được khi sẵn sàng.'}`;
  }
  window.saveVoiceProfile = async (owner, input, scope) => {
    if (!owner || signedInUser?.user_id !== owner || managed()) throw new Error('API cá nhân chỉ dành cho tài khoản học viên.');
    if (!['local', 'server'].includes(scope)) throw new Error('Chọn nơi lưu hợp lệ.');
    if (scope === 'server' && !storageEnabled) throw new Error('Máy chủ chưa lưu được khóa. Hãy chọn lưu trên thiết bị này.');
    const protocol = input.protocol || 'gemini';
    if (!['gemini', 'openai'].includes(protocol)) throw new Error('Chọn Gemini gốc hoặc OpenAI chính thức.');
    const draft = {name:input.name, api_key:input.api_key, protocol, base_url:BASES[protocol], model:''};
    const profile = scope === 'local' ? await VJProfiles.save(owner, draft)
      : (await send('/api/ai/profiles', 'POST', draft)).profile;
    if (signedInUser?.user_id !== owner || managed()) throw new Error('Tài khoản hoặc quyền đăng nhập đã thay đổi.');
    rendering++;
    const previous = profilesOwner === owner ? profileRows : [];
    profileRows = [...previous, {...profile, scope}];
    profilesOwner = owner;
    refreshSavedConnections();
    return {scope, id:profile.id, name:profile.name};
  };

  async function profileAction(action) {
    if (testing || managed()) return;
    stopModels();
    testing = true;
    el('ai-connection-status').textContent = 'Đang cập nhật kết nối đã lưu…';
    el('ai-profile-list').setAttribute('aria-busy', 'true');
    const owner = signedInUser?.user_id;
    const controls = [...el('ai-form').querySelectorAll('input, select, button'), el('ai-profile-list'), el('ai-profile-new'), el('ai-method-oauth'), el('ai-add-connection'), el('ai-chat')];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    let message, succeeded = false;
    try { message = await action(owner); succeeded = true; }
    catch (error) { message = errorText(error); }
    finally {
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
      testing = false;
      el('ai-profile-list').setAttribute('aria-busy', 'false');
    }
    if (signedInUser?.user_id !== owner || managed()) return;
    if (succeeded) loadedProfile = null;
    if (succeeded) await renderSettings();
    el('ai-status').textContent = message || '';
    el('ai-connection-status').textContent = message || '';
    window.checkAiReady();
  }
  const cacheName = (owner, identity) => `vjbot_ai_models_v1:${encodeURIComponent(owner)}:${encodeURIComponent(identity)}`;
  const cacheWarning = () => { el('ai-selection-hint').textContent = 'Bộ nhớ trình duyệt không dùng được. Danh sách model sẽ mất sau khi tải lại.'; };
  const scanName = (owner, identity) => `vjbot_ai_scan_v1:${encodeURIComponent(owner)}:${encodeURIComponent(identity)}`;
  const validModel = value => typeof value === 'string' && value.length <= 100 && /^~?[\w.:/-]+$/.test(value);
  function readScan(owner, identity) {
    if (!owner || !identity) return null;
    let raw;
    try { raw = localStorage.getItem(scanName(owner, identity)); } catch { cacheWarning(); return null; }
    if (raw === null) return null;
    try {
      const scan = JSON.parse(raw);
      if (scan?.identity !== identity || !Array.isArray(scan.catalog) || scan.catalog.length > 1000
        || !scan.catalog.every(validModel) || new Set(scan.catalog).size !== scan.catalog.length
        || !Array.isArray(scan.entries) || scan.entries.length > scan.catalog.length
        || new Set(scan.entries.map(entry => entry.model)).size !== scan.entries.length
        || !scan.entries.every(entry => validModel(entry.model) && scan.catalog.includes(entry.model)
          && ['sent', 'ok', 'failed'].includes(entry.state) && Number.isFinite(entry.at) && entry.at > 0 && entry.at <= Date.now() + 60000)
        || !Array.isArray(scan.dispatchedAt) || scan.dispatchedAt.length > 1000
        || !scan.dispatchedAt.every(at => Number.isFinite(at) && at > 0 && at <= Date.now() + 60000)
        || !Number.isFinite(scan.nextAt) || scan.nextAt < 0) throw new Error();
      return scan;
    } catch { throw new Error('Tiến độ quét đã lưu không hợp lệ. Chọn Kiểm tra lại mọi model để quét mới.'); }
  }
  function writeScan(owner, scan) {
    if (!owner || !scan.identity) return;
    try { localStorage.setItem(scanName(owner, scan.identity), JSON.stringify(scan)); } catch { cacheWarning(); }
  }
  function scanHint() {
    if (activeScan) return;
    const identity = modelSnapshot?.identity || selectedProfile?.connection_id;
    let scan;
    try { scan = readScan(signedInUser?.user_id, identity); }
    catch (error) { el('ai-resume-hint').textContent = error.message; return; }
    const dispatched = new Set(scan?.entries.map(entry => entry.model));
    const remaining = scan?.catalog.filter(model => !dispatched.has(model)).length || 0;
    el('ai-fetch-models').textContent = el('ai-recheck-all').checked || !scan ? 'Tìm model dùng được'
      : remaining ? `Tiếp tục ${remaining} model chưa kiểm tra` : 'Hiện kết quả đã kiểm tra';
    el('ai-resume-hint').textContent = scan
      ? `${scan.entries.filter(entry => entry.state !== 'sent').length}/${scan.catalog.length} đã kiểm tra · ${remaining} chưa gửi. Yêu cầu bị gián đoạn không tự thử lại.`
      : 'Tiến độ được lưu theo tài khoản và đúng kết nối API này. Tải lại hoặc Dừng, rồi tiếp tục các model chưa gửi.';
  }
  function rememberModels(identity, draft) {
    const owner = signedInUser?.user_id;
    if (!owner || !identity) return;
    const cache = {identity, checkedAt: Date.now(), models: [...el('ai-model-list').options].map(option => option.value)};
    modelSnapshot = {...cache, owner, draft: {...draft}};
    try { localStorage.setItem(cacheName(owner, identity), JSON.stringify(cache)); } catch { cacheWarning(); }
  }
  function recalledModels(owner, identity) {
    if (!owner || !identity) return null;
    try {
      const cache = JSON.parse(localStorage.getItem(cacheName(owner, identity)) || 'null');
      return cache?.identity === identity && Number.isFinite(cache.checkedAt) && cache.checkedAt > 0
        && cache.checkedAt <= Date.now() + 60000 && Array.isArray(cache.models) && cache.models.length <= 1000
        && cache.models.every(model => typeof model === 'string' && model.length <= 100 && /^~?[\w.:/-]+$/.test(model))
        ? cache : null;
    } catch { cacheWarning(); return null; }
  }
  function restoreModels(cache) {
    if (!cache?.models.length) return;
    for (const model of cache.models) {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      el('ai-model-list').append(option);
    }
    publishModels();
    el('ai-model-status').textContent = `${cache.models.length} model từng phản hồi · kiểm tra lần cuối ${new Date(cache.checkedAt).toLocaleString()}. `;
    el('ai-selection-hint').textContent = 'Danh sách gồm các model từng phản hồi. Quyền truy cập và hạn mức có thể đã đổi. Muốn thử lại model cũ, chọn ‘Kiểm tra lại mọi model’; việc thử có thể tính phí.';
  }
  const KIND = {google: 'Google', email: 'Email'};
  async function call(path, options) {
    const response = await apiFetch(path, options);
    let data;
    try { data = await response.json(); } catch {
      if (response.status === 401 && !signedInUser) { resetModels(); syncProbeBudget(null); }
      throw Object.assign(new Error('Máy chủ trả về dữ liệu không đọc được. Em tải lại trạng thái để kiểm tra trước khi thử lại; yêu cầu chưa được tự gửi lại.'), {status: response.status});
    }
    if (response.status === 401 && !signedInUser) {
      resetModels();
      syncProbeBudget(null);
    }
    if (!response.ok) throw Object.assign(new Error(data.detail || 'Yêu cầu không thành công. Hãy thử lại.'), {
      status: response.status, providerStatus: data.provider_status, retryAfterMs: data.retry_after_ms
    });
    return data;
  }
  const send = (path, method, body) => call(path, {method, headers: {'Content-Type': 'application/json'}, body: body && JSON.stringify(body)});

  // The server limiter is per signed-in account, not per provider, key or catalog connection.
  function syncProbeBudget(owner = signedInUser?.user_id ?? null) {
    if (owner === timingIdentity) return;
    if (timingIdentity !== null) el('ai-key').value = '';
    loadedProfile = null;
    timingIdentity = owner;
    selectedProfile = null;
    profileKey = '';
    nextProbeAt = 0;
    dispatchedAt = Object.freeze([]);
  }

  // Credential edits discard in-flight catalogs and all choices from the old connection.
  function syncProtocol() {
    const protocol = el('ai-protocol').value;
    document.querySelectorAll('#ai-segments button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.protocol === protocol)));
    el('ai-base').placeholder = BASES[protocol];
    resetModels();
  }
  function stopModels() {
    activeScan = null;
    rendering++;
    modelRequest++;
    modelAbort?.abort();
    el('ai-stop-models').hidden = true;
    el('ai-fetch-models').disabled = testing;
    el('ai-fetch-models').setAttribute('aria-busy', 'false');
    el('ai-load-progress').hidden = true;
  }
  function resetModels() {
    modelSnapshot = null;
    stopModels();
    el('ai-model-list').replaceChildren();
    el('ai-models').hidden = true;
    el('ai-model-list').disabled = true;
    el('ai-save').disabled = true;
    el('ai-model-status').textContent = '';
    el('ai-fetch-models').textContent = 'Tìm model dùng được';
    el('ai-resume-hint').textContent = '';
    el('ai-selection-hint').textContent = 'Chỉ chọn được model đã phản hồi thật. Hạn mức và tình trạng sau này có thể đổi.';
  }
  function invalidateSelection() {
    el('ai-status').textContent = 'Thay đổi chưa được lưu. Kết nối trò chuyện hiện tại vẫn được giữ.';
  }
  function publishModels() {
    const list = el('ai-model-list'), available = list.options.length > 0;
    el('ai-models').hidden = !available;
    list.disabled = !available;
    if (available) {
      list.value = [...list.options].some(option => option.value === el('ai-model').value)
        ? el('ai-model').value : list.options[0].value;
      el('ai-model').value = list.value;
    }
    el('ai-save').disabled = !(el('ai-profile-storage').value === 'local' || storageEnabled) || !list.value;
    el('ai-save').hidden = Boolean(selectedProfile?.model && list.value === selectedProfile.model);
  }
  function confirmModelChecks(total, partial, signal) {
    if (signal.aborted) return Promise.resolve(false);
    const dialog = el('ai-confirm-dialog');
    el('ai-confirm-count').textContent = String(total);
    el('ai-confirm-start').textContent = `Kiểm tra ${total} model`;
    el('ai-confirm-partial').hidden = !partial;
    dialog.returnValue = '';
    return new Promise(resolve => {
      const cancel = () => { if (dialog.open) dialog.close('cancel'); };
      dialog.addEventListener('close', () => {
        signal.removeEventListener('abort', cancel);
        resolve(!signal.aborted && dialog.returnValue === 'start');
      }, {once: true});
      signal.addEventListener('abort', cancel, {once: true});
      dialog.showModal();
    });
  }
  async function loadModels() {
    if (managed() || testing || activeScan) return;
    resetModels();
    invalidateSelection();
    syncProbeBudget();
    const request = modelRequest, status = el('ai-model-status'), owner = signedInUser?.user_id;
    const draft = {protocol: el('ai-protocol').value, base_url: el('ai-base').value, api_key: draftKey(),
      ...(selectedProfile?.scope === 'server' ? {profile_id: selectedProfile.id} : {})};
    if (!draft.api_key && !savedConnection) {
      status.textContent = 'Nhập URL và khóa API để kiểm tra model.';
      return;
    }
    modelAbort = new AbortController();
    activeScan = {owner, request};
    const current = () => request === modelRequest && signedInUser?.user_id === owner && !managed();
    let checked = 0, passed = 0, total = 0, partial = '', releaseScan = null;
    const progress = el('ai-load-progress');
    progress.removeAttribute('value');
    el('ai-fetch-models').disabled = true;
    el('ai-fetch-models').setAttribute('aria-busy', 'true');
    el('ai-load-progress').hidden = false;
    el('ai-stop-models').hidden = false;
    status.textContent = 'Đang tải danh sách model…';
    try {
      const data = await call('/api/ai/models', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        signal: modelAbort.signal, body: JSON.stringify(draft)
      });
      if (!current()) return;
      total = data.models.length;
      partial = data.truncated ? ' Danh sách nhà cung cấp trả về chưa đầy đủ.' : '';
      if (!total) { status.textContent = 'Không có model nào để kiểm tra.'; return; }
      if (data.connection_id && typeof navigator !== 'undefined' && navigator.locks) {
        const acquired = await new Promise((resolve, reject) => {
          navigator.locks.request(scanName(owner, data.connection_id), {ifAvailable: true}, lock => {
            if (!lock) { resolve(false); return; }
            return new Promise(release => { releaseScan = release; resolve(true); });
          }).catch(() => reject(new Error('Không phối hợp được lần quét giữa các tab. Hãy đóng lần quét kia rồi thử lại.')));
        });
        if (!current()) return;
        if (!acquired) { status.textContent = 'Một lần quét khác của kết nối này đang chạy. Hãy tiếp tục sau khi nó dừng.'; return; }
      }
      const fresh = el('ai-recheck-all').checked;
      const catalog = new Set(data.models);
      let saved;
      try { saved = readScan(owner, data.connection_id); } catch (error) { if (!fresh) throw error; }
      let checkpoint = {identity: data.connection_id || null, catalog: [...data.models],
        entries: !fresh && saved ? saved.entries.filter(entry => catalog.has(entry.model)) : [],
        dispatchedAt: saved?.dispatchedAt || [], nextAt: saved?.nextAt || 0};
      const dispatched = new Set(checkpoint.entries.map(entry => entry.model));
      const unfinished = data.models.filter(model => !dispatched.has(model));
      checked = checkpoint.entries.filter(entry => entry.state !== 'sent').length;
      passed = checkpoint.entries.filter(entry => entry.state === 'ok').length;
      for (const entry of checkpoint.entries.filter(entry => entry.state === 'ok')) {
        const option = document.createElement('option');
        option.value = entry.model; option.textContent = entry.model; el('ai-model-list').append(option);
      }
      if (saved && !fresh) {
        publishModels();
        el('ai-selection-hint').textContent = 'Gồm cả kết quả kiểm tra thành công trước đó, không kiểm tra lại; quyền truy cập và hạn mức có thể đã đổi.';
      }
      if (!unfinished.length) {
        status.textContent = `Đã lưu: ${checked}/${total} đã kiểm tra · ${passed} phản hồi · ${checkpoint.entries.filter(entry => entry.state === 'sent').length} bị gián đoạn, không thử lại. Chỉ chọn Kiểm tra lại mọi model khi muốn quét mới.`;
        return;
      }
      const accepted = await confirmModelChecks(unfinished.length, partial, modelAbort.signal);
      if (!current()) return;
      if (!accepted) {
        status.textContent = 'Đã hủy. Không gửi thêm lần thử nào; kết quả đã lưu giữ nguyên.';
        return;
      }
      if (!current()) return;
      writeScan(owner, checkpoint);
      try { if (data.connection_id) localStorage.setItem(cacheName(owner, data.connection_id),
        JSON.stringify({identity: data.connection_id, checkedAt: Date.now(), models: checkpoint.entries.filter(entry => entry.state === 'ok').map(entry => entry.model)})); } catch { cacheWarning(); }
      const ordered = VJModelScan.plan(unfinished, {}, {force: true, selected: el('ai-model').value}).pending;
      const previousStarts = checkpoint.dispatchedAt.filter(at => at > Date.now() - 60000);
      if (previousStarts.length > dispatchedAt.filter(at => at > Date.now() - 60000).length) dispatchedAt = Object.freeze(previousStarts);
      nextProbeAt = Math.max(nextProbeAt, checkpoint.nextAt);
      progress.max = total;
      progress.value = checked;
      const result = await VJModelScan.run({
        models: ordered, mode: 'burst', signal: modelAbort.signal, current, startAt: nextProbeAt, dispatchedAt,
        maxCooldownMs: Infinity,
        onDispatch: model => {
          if (!current()) return;
          checkpoint = {...checkpoint, entries: [...checkpoint.entries, {model, state: 'sent', at: Date.now()}]};
          writeScan(owner, checkpoint);
        },
        probe: model => call('/api/ai/models/test', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, signal: modelAbort.signal,
          body: JSON.stringify({...draft, model, ...(data.connection_id ? {connection_id: data.connection_id} : {})})
        }),
        onResult: (model, outcome) => {
          if (!current()) return;
          if (outcome.invalidate) {
            try { localStorage.removeItem(cacheName(owner, data.connection_id)); } catch { cacheWarning(); }
            try { if (data.connection_id) localStorage.removeItem(scanName(owner, data.connection_id)); } catch { cacheWarning(); }
            resetModels();
            status.textContent = `Kết nối đã đổi hoặc khóa bị từ chối. ${outcome.message}`;
            return;
          }
          checked++;
          checkpoint = {...checkpoint, entries: checkpoint.entries.map(entry => entry.model === model
            ? {...entry, state: outcome.ok ? 'ok' : 'failed', at: Date.now()} : entry)};
          writeScan(owner, checkpoint);
          progress.value = checked;
          if (outcome.ok) {
            passed++;
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            el('ai-model-list').append(option);
            rememberModels(data.connection_id, draft);
          }
        },
        onState: info => {
          if (!current()) return;
          nextProbeAt = info.nextAt;
          dispatchedAt = info.dispatchedAt;
          checkpoint = {...checkpoint, dispatchedAt: [...dispatchedAt], nextAt: nextProbeAt};
          writeScan(owner, checkpoint);
          const wait = Math.max(0, Math.ceil((info.nextAt - Date.now()) / 1000));
          status.textContent = `Đã kiểm tra ${checked}/${total} · ${passed} phản hồi${wait ? ` · chờ ${wait}s vì hạn mức` : ''}`;
        }
      });
      if (!current()) return;
      publishModels();
      pill(passed ? 'ok' : 'saved', passed ? `${passed} mô hình đã phản hồi` : 'Chưa có mô hình được xác nhận');
      const interrupted = checkpoint.entries.filter(entry => entry.state === 'sent').length;
      status.textContent = `${result.halted ? 'Đã dừng' : 'Hoàn tất'}: ${checked}/${total} đã kiểm tra · ${passed} phản hồi.${partial}${interrupted ? ` ${interrupted} yêu cầu bị gián đoạn, không thử lại.` : ''}${result.halted ? ' Hãy tiếp tục để kiểm tra các model chưa gửi.' : ''}`;
    } catch (error) {
      if (current()) {
        publishModels();
        status.textContent = `Đã dừng: ${error.message} ${checked}/${total} đã kiểm tra.`;
      }
    } finally {
      releaseScan?.();
      if (activeScan?.request === request) activeScan = null;
      if (current()) {
        el('ai-fetch-models').disabled = testing;
        el('ai-fetch-models').setAttribute('aria-busy', 'false');
        el('ai-stop-models').hidden = true;
        el('ai-load-progress').hidden = true;
        scanHint();
      }
    }
  }
  const pill = (state, text) => { el('ai-pill').dataset.state = state; el('ai-pill').textContent = text; };

  function renderAccountCard() {
    const user = signedInUser;
    if (!user) return;
    el('settings-initial').textContent = (user.name || '?').trim().charAt(0).toUpperCase();
    el('settings-name').textContent = user.name || 'Học viên';
    el('settings-email').textContent = user.email || '';
    el('settings-kind').textContent = user.is_admin ? 'Quản trị viên' : user.user_id.startsWith('google:') ? KIND.google : KIND.email;
  }
  window.renderAccountSettings = renderAccountCard;

  // Restore voice metadata at sign-in without opening editors or discovering/generating models.
  window.loadVoiceProfiles = async () => {
    const owner = signedInUser?.user_id, version = rendering;
    if (!owner || managed()) return;
    let local = [];
    try { local = await VJProfiles.list(owner); } catch { /* Server references may still be usable. */ }
    if (signedInUser?.user_id !== owner || managed() || version !== rendering) return;
    try {
      const data = await call('/api/ai/profiles');
      if (signedInUser?.user_id !== owner || managed() || version !== rendering) return;
      profileRows = [...data.profiles.map(profile => ({...profile,scope:'server'})), ...local.map(profile => ({...profile,scope:'local'}))];
      profilesOwner = owner; storageEnabled = data.can_store;
      window.renderVoiceProfiles?.(owner, profileRows, storageEnabled);
    } catch {
      if (signedInUser?.user_id !== owner || managed() || version !== rendering) return;
      profileRows = local.map(profile => ({...profile,scope:'local'}));
      profilesOwner = owner; storageEnabled = false;
      window.renderVoiceProfiles?.(owner, profileRows);
    }
  };
  async function renderSettings() {
    if (managed()) {
      resetModels();
      renderAccountCard();
      return window.renderAdminAISettings?.();
    }
    if (testing) return;
    const owner = signedInUser?.user_id;
    if (activeScan && activeScan.owner !== owner) resetModels();
    syncProbeBudget();
    renderAccountCard();
    const oauthRendering = window.renderAntigravityOAuth?.();
    if (activeScan?.owner === owner) return;
    const version = ++rendering;
    const status = el('ai-status'), pending = modelSnapshot?.owner === owner && modelSnapshot.draft?.api_key ? modelSnapshot : null;
    status.textContent = '';
    let metadataLoaded = false;
    try {
      const data = await call('/api/ai/profiles');
      if (testing || activeScan || version !== rendering || signedInUser?.user_id !== owner || managed()) return;
      let local = [], deviceError = '';
      try { local = await VJProfiles.list(owner); } catch { deviceError = 'Bộ nhớ thiết bị không dùng được. Chọn lưu trên máy chủ hoặc bật bộ nhớ trình duyệt.'; }
      if (testing || activeScan || version !== rendering || signedInUser?.user_id !== owner || managed()) return;
      profileRows = [...data.profiles.map(profile => ({...profile, scope: 'server'})), ...local.map(profile => ({...profile, scope: 'local'}))];
      profilesOwner = owner;
      storageEnabled = data.can_store;
      window.renderVoiceProfiles?.(owner, profileRows, storageEnabled);
      metadataLoaded = true;
      const choice = VJProfiles.active(owner);
      const profile = choice?.scope === 'none' ? null : choice?.scope === 'local'
        ? profileRows.find(row => row.scope === 'local' && row.id === choice.id)
        : profileRows.find(row => row.scope === 'server' && row.id === (choice?.scope === 'server' ? choice.id : data.active_id));
      let key = '';
      if (profile?.scope === 'local') key = (await VJProfiles.load(owner, profile.id)).api_key;
      if (activeScan || version !== rendering || signedInUser?.user_id !== owner || managed()) return;
      if (!choice && profile) VJProfiles.setActive(owner, {scope: profile.scope, id: profile.id});
      refreshSavedConnections();
      const cache = pending || recalledModels(owner, profile?.connection_id);
      const identity = owner + ':' + profileChoice(profile);
      if (loadedProfile !== identity) { fillProfile(profile, cache, key); loadedProfile = identity; }
      if (pending) {
        el('ai-protocol').value = pending.draft.protocol;
        el('ai-base').value = pending.draft.base_url;
        el('ai-key').value = pending.draft.api_key;
        el('ai-key-hint').textContent = 'Kết quả kiểm tra này chưa được lưu. Hãy lưu kết nối để giữ lại sau khi tải lại.';
      }
      modelSnapshot = pending;
      scanHint();
      if (!window.usesAntigravityOAuth?.(owner)) {
        el('ai-source').hidden = Boolean(profile);
        el('ai-source').textContent = choice && choice.scope !== 'none' && !profile ? 'Kết nối API đã chọn không khả dụng. Hãy chọn kết nối khác; không tự động dùng kết nối thay thế.' : 'Em thêm kết nối AI để trò chuyện với thầy nhé.';
        pill(profile ? 'saved' : 'none', profile ? `Đang dùng ${profile.name}` : 'Chưa chọn API');
      }
      if (!profile && !pending) el('ai-form').hidden=true;
      if (deviceError) status.textContent = deviceError;
    } catch (error) {
      if (version === rendering && signedInUser?.user_id === owner && !managed()) {
        if (!metadataLoaded) {
          profilesOwner = null; profileRows = []; storageEnabled = false;
          let local = [];
          try { local = await VJProfiles.list(owner); } catch { /* Keep an inaccessible voice reference explicit. */ }
          if (version !== rendering || signedInUser?.user_id !== owner || managed()) return;
          window.renderVoiceProfiles?.(owner, local.map(profile => ({...profile, scope:'local'})));
        }
        resetModels(); status.textContent = errorText(error);
      }
    }
    await oauthRendering;
  }

  async function renderAdmin() {
    const stats = el('admin-stats');
    try {
      const data = await call('/api/admin/overview');
      if(el('admin-ai-status'))el('admin-ai-status').textContent=data.shared_ai?.configured ? `OpenAI · ${data.shared_ai.model} · Tự động cho quản trị viên` : 'Chưa cấu hình OPENAI_API_KEY trên máy chủ.';
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
  window.pauseApiModelScan = () => { rendering++; stopModels(); };

  // The readiness gate routes administrators to managed settings, never a personal API editor.
  const openAiSettings = () => {
    switchTab('settings',{view:managed() ? 'admin' : 'api'});
  };
  async function aiSource() {
    try {
      const identity = accountIdentity();
      if (managed()) {
        const owner = signedInUser?.user_id;
        const data = await call('/api/ai/settings');
        if (owner !== signedInUser?.user_id || !managed()) return 'none';
        window.renderVoiceProfiles?.(owner, [], false, data.platform);
        return data.source === 'platform' && data.platform?.configured ? 'platform' : 'none';
      }
      if (window.usesAntigravityOAuth?.(signedInUser?.user_id)) {
        const owner = signedInUser?.user_id, connection = window.antigravityConnectionId?.(owner);
        if (!connection) return 'none';
        const data = await call('/api/ai/oauth/antigravity');
        const row = data.connections?.find(row => row.id === connection);
        return data.configured && row?.state === 'active' && row.model ? 'antigravity_oauth' : 'none';
      }
      if (!window.VJProfiles) return 'none';
      const owner = signedInUser?.user_id, choice = owner && VJProfiles.active(owner);
      if (choice?.scope === 'none') return 'none';
      if (choice?.scope === 'local') {
        const profile = await VJProfiles.load(owner, choice.id);
        return signedInUser?.user_id === owner && profile?.model ? 'own' : 'none';
      }
      if (choice?.scope === 'server') {
        const data = await call('/api/ai/profiles');
        return data.profiles.some(profile => profile.id === choice.id && profile.model) ? 'own' : 'none';
      }
      const data = await call('/api/ai/settings');
      if (identity !== accountIdentity()) return 'none';
      if (data.own?.id && data.own.model) VJProfiles.setActive(owner, {scope: 'server', id: data.own.id});
      return data.own?.model ? data.source : 'none';
    } catch { return 'none'; }
  }
  window.checkAiReady = async () => {
    const version = ++readiness, owner = signedInUser?.user_id, choice = connectionChoice();
    const source = await aiSource();
    if (version !== readiness || owner !== signedInUser?.user_id || choice !== connectionChoice()) return;
    const room = document.querySelector('.classroom-chat-window'), none = source === 'none';
    el('ai-chat').hidden = none;
    room.dataset.ai = source === 'unknown' ? 'unknown' : none ? 'none' : 'ready';
    el('chat-ai-gate').hidden = !none;
    el('chat-gate-title').textContent = managed()
      ? 'OpenAI quản trị chưa sẵn sàng. Kiểm tra OPENAI_API_KEY trên máy chủ và quyền quản trị.'
      : 'Kết nối API để chat với thầy Lâm';
    el('chat-gate-open').textContent = managed() ? 'Chọn model' : 'Thêm API';
    el('chat-input').disabled = none;
    el('btn-send-message').disabled = none;
    if (!none && /Cài đặt/.test(el('chat-error-text').textContent)) chatError('', null);
  };
  window.mountAiBanner = async host => {
    if (await aiSource() !== 'none') return;
    const banner = document.createElement('div'), text = document.createElement('p'), open = document.createElement('button');
    banner.className = 'ai-banner';
    text.textContent = managed() ? 'OpenAI quản trị chưa sẵn sàng. Kiểm tra cấu hình máy chủ.' : 'Kết nối API để chat với thầy Lâm.';
    open.type = 'button'; open.className = 'public-cta'; open.textContent = managed() ? 'Chọn model' : 'Thêm API';
    open.onclick = openAiSettings;
    banner.append(text, open);
    host.prepend(banner);
  };
  el('chat-gate-open').addEventListener('click', openAiSettings);
  el('ai-chat').addEventListener('click', () => switchTab('classroom'));
  el('ai-add-connection').addEventListener('click', () => { if (!managed()) el('ai-add-dialog').showModal(); });
  el('ai-add-close').addEventListener('click', () => el('ai-add-dialog').close());
  for (const id of ['ai-profile-new', 'ai-method-oauth']) {
    el(id).addEventListener('click', () => el('ai-add-dialog').close(), {capture:true});
  }
  async function returnToSavedConnection() {
    loadedProfile = null;
    modelSnapshot = null;
    window.aiConnectionChanged?.();
    await renderSettings();
    el('ai-profile-list').focus();
  }
  el('ai-api-back').addEventListener('click', returnToSavedConnection);
  el('ai-oauth-back').addEventListener('click', returnToSavedConnection);

  document.querySelectorAll('#ai-segments button').forEach(button => button.addEventListener('click', () => {
    el('ai-protocol').value = button.dataset.protocol;
    invalidateSelection();
    syncProtocol();
  }));
  for (const id of ['ai-base', 'ai-key']) {
    el(id).addEventListener('input', () => { resetModels(); invalidateSelection(); });
  }
  el('ai-fetch-models').addEventListener('click', () => loadModels());
  el('ai-stop-models').addEventListener('click', () => {
    stopModels();
    publishModels();
    el('ai-model-status').textContent = 'Đã dừng. Chỉ hiện các phản hồi thành công đã hoàn tất.';
    scanHint();
  });
  el('ai-recheck-all').addEventListener('change', scanHint);
  el('ai-model-list').addEventListener('change', () => {
    if (el('ai-model-list').value) el('ai-model').value = el('ai-model-list').value;
    invalidateSelection();
    publishModels();
  });
  el('ai-key-toggle').addEventListener('click', () => {
    const show = el('ai-key').type === 'password';
    el('ai-key').type = show ? 'text' : 'password';
    el('ai-key-toggle').textContent = show ? 'Ẩn' : 'Hiện';
    el('ai-key-toggle').setAttribute('aria-label', show ? 'Ẩn khóa API' : 'Hiện khóa API');
    el('ai-key-toggle').setAttribute('aria-pressed', String(show));
  });
  el('auth-logout').addEventListener('click', () => {
    resetModels();
    syncProbeBudget(null);
  });
  el('settings-logout').addEventListener('click', () => el('auth-logout').click());
  document.querySelectorAll('.settings-nav button').forEach(button => button.addEventListener('click', () => {
    switchTab('settings',{view:button.dataset.settings});
  }));
  el('ai-profile-storage').addEventListener('change', () => { storageHint(); publishModels(); });
  el('ai-profile-new').addEventListener('click', () => {
    if (testing || managed()) return;
    ++rendering;
    window.showAiConnectionForm?.('key');
    fillProfile(null);
    savedConnection = false;
    refreshSavedConnections();
    invalidateSelection();
    el('ai-profile-name').focus();
  });
  el('ai-profile-list').addEventListener('change', async () => {
    if (managed()) return;
    const value = el('ai-profile-list').value;
    if (value.startsWith('oauth:')) {
      stopModels();
      await window.selectAntigravityConnection?.(value.slice(6));
      refreshSavedConnections();
      return;
    }
    const profile = profileRows.find(row => profileChoice(row) === value);
    if (value && !profile) return;
    await profileAction(async owner => {
      if (profile?.scope === 'server') await send(`/api/ai/profiles/${encodeURIComponent(profile.id)}/activate`, 'POST', {});
      else if (profile) await VJProfiles.load(owner, profile.id);
      if (signedInUser?.user_id !== owner || managed()) throw new Error('Tài khoản hoặc quyền đăng nhập đã thay đổi.');
      VJProfiles.setActive(owner, profile ? {scope: profile.scope, id: profile.id} : {scope:'none', id:''});
      localStorage.setItem(methodKey(owner), 'key');
      window.aiConnectionChanged?.();
      modelSnapshot = null;
      return profile ? `Đang dùng ${profile.name}. Đã khôi phục model đã lưu, không kiểm tra lại.` : 'Chưa chọn kết nối trò chuyện.';
    });
    refreshSavedConnections();
  });
  el('ai-profile-save').addEventListener('click', () => profileAction(() => saveProfile(false)));
  el('ai-form').addEventListener('submit', event => {
    event.preventDefault();
    return profileAction(() => saveProfile(true));
  });
  el('ai-remove').addEventListener('click', () => {
    const profile = selectedProfile;
    if (!profile || !confirm(`Xóa ${profile.name} khỏi ${profile.scope === 'local' ? 'thiết bị này' : 'tài khoản của em'}? Các kết nối khác vẫn được giữ.`)) return;
    return profileAction(async owner => {
      if (profile.scope === 'local') await VJProfiles.remove(owner, profile.id);
      else await send(`/api/ai/profiles/${encodeURIComponent(profile.id)}`, 'DELETE');
      if (signedInUser?.user_id !== owner) throw new Error('Tài khoản đăng nhập đã thay đổi.');
      let voice;
      try { voice = VJProfiles.voice(owner); } catch { /* Independent corrupt voice storage does not block credential deletion. */ }
      if (voice?.scope === profile.scope && voice.id === profile.id) VJProfiles.setVoice(owner, {scope:'none', id:''});
      VJProfiles.setActive(owner, {scope: 'none', id: ''});
      modelSnapshot = null;
      return 'Đã xóa kết nối. Hãy chọn kết nối khác để tiếp tục; hệ thống không tự chọn thay.';
    });
  });
  window.addEventListener('vjbot-voice-changed', () => {
    const identity = accountIdentity();
    if (identity === renderedIdentity) return;
    renderedIdentity = identity;
    readiness++;
    resetModels();
    syncProbeBudget();
    selectedProfile = null; profileKey = ''; loadedProfile = null;
    profilesOwner = null; profileRows = []; storageEnabled = false;
    el('ai-key').value = '';
    el('ai-profile-list').replaceChildren();
    el('ai-current-model').textContent = 'Chưa chọn kết nối';
    el('ai-current-hint').textContent = '';
    el('ai-card').dataset.connected = 'false';
    el('ai-form').hidden = el('ai-oauth-panel').hidden = true;
    if (el('ai-add-dialog').open) el('ai-add-dialog').close();
  });
})();
