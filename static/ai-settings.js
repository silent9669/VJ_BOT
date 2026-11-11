// Settings: the learner's own API (OpenAI-compatible, Claude or Gemini). Admin: activity.
(function () {
  const el = id => document.getElementById(id);
  const BASES = {openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com'};
  let savedConnection = false, storageEnabled = false, modelRequest = 0, modelAbort = null, testing = false;
  let nextProbeAt = 0, timingIdentity = null, dispatchedAt = Object.freeze([]);
  let modelSnapshot = null;
  let activeScan = null;
  let profileRows = [], selectedProfile = null, profileKey = '', rendering = 0;
  const profileChoice = profile => profile ? `${profile.scope}:${profile.id}` : '';
  const draftKey = () => el('ai-key').value.trim() || (selectedProfile?.protocol === el('ai-protocol').value
    && selectedProfile?.base_url === el('ai-base').value.trim() ? profileKey : '');
  function storageHint() {
    const local = el('ai-profile-storage').value === 'local';
    el('ai-profile-storage-hint').textContent = local
      ? 'Encrypted in this browser profile, not synced. The backend receives the key only during AI requests. A compromised browser can still access it.'
      : 'Saved encrypted on the server under your account. Other devices signed into your account can use this profile.';
  }
  function fillProfile(profile, cache = null, key = '') {
    selectedProfile = profile;
    profileKey = key;
    el('ai-profile-name').value = profile?.name || '';
    el('ai-profile-storage').value = profile?.scope || 'local';
    el('ai-profile-list').value = profileChoice(profile);
    storageHint();
    el('ai-protocol').value = profile?.protocol || 'openai';
    el('ai-base').value = profile?.base_url || '';
    syncProtocol();
    el('ai-model').value = profile?.model || '';
    el('ai-key').value = '';
    el('ai-key').placeholder = profile ? '••••' + profile.key_last4 : 'sk-…';
    el('ai-key').type = 'password';
    el('ai-key-toggle').textContent = 'Show';
    el('ai-key-toggle').setAttribute('aria-label', 'Show API key');
    el('ai-key-toggle').setAttribute('aria-pressed', 'false');
    el('ai-key').required = !profile;
    el('ai-key-hint').textContent = profile ? 'Leave blank to reuse the key in this profile. A different URL or API type needs a new key.' : 'Choose a save location. Never paste your key into chat.';
    el('ai-remove').hidden = !profile;
    restoreModels(cache || (profile?.models?.length ? {models: profile.models, checkedAt: profile.checked_at} : null));
    el('ai-chat').hidden = !profile?.model;
  }
  async function saveProfile(useModel) {
    const owner = signedInUser?.user_id, scope = el('ai-profile-storage').value;
    if (!owner) throw new Error('Sign in before saving a profile.');
    const model = el('ai-models').hidden ? '' : el('ai-model-list').value;
    if (useModel && !model) throw new Error('Check models and choose a responding result first.');
    const snapshot = modelSnapshot;
    const draft = {name: el('ai-profile-name').value.trim(), protocol: el('ai-protocol').value,
      base_url: el('ai-base').value, model, api_key: draftKey(),
      models: [...el('ai-model-list').options].map(option => option.value),
      checked_at: snapshot?.checkedAt || selectedProfile?.checked_at || null,
      connection_id: snapshot?.identity || selectedProfile?.connection_id || null};
    if (!draft.name) throw new Error('Enter a profile name.');
    const id = selectedProfile?.scope === scope ? selectedProfile.id : null;
    let profile;
    if (scope === 'local') {
      profile = await VJProfiles.save(owner, {...draft, ...(id ? {id} : {})});
    } else {
      const result = await send('/api/ai/profiles' + (id ? '/' + encodeURIComponent(id) : ''), id ? 'PUT' : 'POST', draft);
      profile = result.profile;
      await send(`/api/ai/profiles/${encodeURIComponent(profile.id)}/activate`, 'POST', {});
    }
    if (signedInUser?.user_id !== owner) throw new Error('The signed-in account changed.');
    VJProfiles.setActive(owner, {scope, id: profile.id});
    modelSnapshot = null;
    return `Saved ${profile.name} on ${scope === 'local' ? 'this device' : 'your account'}. ${model ? 'Ready to use; no models were rechecked.' : 'Choose Find usable models when ready.'}`;
  }
  async function profileAction(action) {
    if (testing) return;
    stopModels();
    testing = true;
    const owner = signedInUser?.user_id;
    const controls = [...el('ai-form').querySelectorAll('input, select, button')];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    let message, succeeded = false;
    try { message = await action(owner); succeeded = true; }
    catch (error) { message = error.message; }
    finally {
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
      testing = false;
    }
    if (signedInUser?.user_id !== owner) return;
    if (succeeded) await renderSettings();
    el('ai-status').textContent = message || '';
    window.checkAiReady();
  }
  const cacheName = (owner, identity) => `vjbot_ai_models_v1:${encodeURIComponent(owner)}:${encodeURIComponent(identity)}`;
  const cacheWarning = () => { el('ai-selection-hint').textContent = 'Browser storage is unavailable. These models will not be remembered after a reload.'; };
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
    el('ai-model-status').textContent = `${cache.models.length} previously responding models · last checked ${new Date(cache.checkedAt).toLocaleString()}. Refresh to check again.`;
    el('ai-selection-hint').textContent = 'Restored from this browser. Quota and access may have changed since the last check.';
  }
  const KIND = {google: 'Google', email: 'Email'};
  async function call(path, options) {
    const response = await apiFetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && !signedInUser) {
      resetModels();
      syncProbeBudget(null);
    }
    if (!response.ok) throw Object.assign(new Error(data.detail || 'Request failed. Please try again.'), {
      status: response.status, providerStatus: data.provider_status, retryAfterMs: data.retry_after_ms
    });
    return data;
  }
  const send = (path, method, body) => call(path, {method, headers: {'Content-Type': 'application/json'}, body: body && JSON.stringify(body)});

  // The server limiter is per signed-in account, not per provider, key or catalog connection.
  function syncProbeBudget(owner = signedInUser?.user_id ?? null) {
    if (owner === timingIdentity) return;
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
    el('ai-selection-hint').textContent = 'Only models that returned a real response can be selected. Future quota and availability may change.';
  }
  function invalidateSelection() {
    pill('saved', 'Connection not saved');
    el('ai-status').textContent = '';
    el('ai-chat').hidden = true;
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
  }
  function confirmModelChecks(total, partial, signal) {
    if (signal.aborted) return Promise.resolve(false);
    const dialog = el('ai-confirm-dialog');
    el('ai-confirm-count').textContent = String(total);
    el('ai-confirm-start').textContent = `Check ${total} models`;
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
    if (testing || activeScan) return;
    resetModels();
    invalidateSelection();
    syncProbeBudget();
    const request = modelRequest, status = el('ai-model-status'), owner = signedInUser?.user_id;
    const draft = {protocol: el('ai-protocol').value, base_url: el('ai-base').value, api_key: draftKey(),
      ...(selectedProfile?.scope === 'server' ? {profile_id: selectedProfile.id} : {})};
    if (!draft.api_key && !savedConnection) {
      status.textContent = 'Enter your API URL and key to check models.';
      return;
    }
    modelAbort = new AbortController();
    activeScan = {owner, request};
    const current = () => request === modelRequest && signedInUser?.user_id === owner;
    let checked = 0, passed = 0, total = 0, partial = '';
    const progress = el('ai-load-progress');
    progress.removeAttribute('value');
    el('ai-fetch-models').disabled = true;
    el('ai-fetch-models').setAttribute('aria-busy', 'true');
    el('ai-load-progress').hidden = false;
    el('ai-stop-models').hidden = false;
    status.textContent = 'Loading models…';
    try {
      const data = await call('/api/ai/models', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        signal: modelAbort.signal, body: JSON.stringify(draft)
      });
      if (!current()) return;
      total = data.models.length;
      partial = data.truncated ? ' Catalog is partial.' : '';
      if (!total) { status.textContent = 'No candidate models returned.'; return; }
      const accepted = await confirmModelChecks(total, partial, modelAbort.signal);
      if (!current()) return;
      if (!accepted) {
        status.textContent = 'Cancelled. No model tests were sent.';
        return;
      }
      if (!current()) return;
      try { if (data.connection_id) localStorage.setItem(cacheName(owner, data.connection_id),
        JSON.stringify({identity: data.connection_id, checkedAt: Date.now(), models: []})); } catch { cacheWarning(); }
      const ordered = VJModelScan.plan(data.models, {}, {force: true, selected: el('ai-model').value}).pending;
      progress.max = total;
      progress.value = 0;
      const result = await VJModelScan.run({
        models: ordered, mode: 'burst', signal: modelAbort.signal, current, startAt: nextProbeAt, dispatchedAt,
        maxCooldownMs: Infinity,
        probe: model => call('/api/ai/models/test', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, signal: modelAbort.signal,
          body: JSON.stringify({...draft, model, ...(data.connection_id ? {connection_id: data.connection_id} : {})})
        }),
        onResult: (model, outcome) => {
          if (!current()) return;
          if (outcome.invalidate) {
            try { localStorage.removeItem(cacheName(owner, data.connection_id)); } catch { cacheWarning(); }
            resetModels();
            status.textContent = `Connection changed or key rejected. ${outcome.message}`;
            return;
          }
          checked++;
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
          const wait = Math.max(0, Math.ceil((info.nextAt - Date.now()) / 1000));
          status.textContent = `Checked ${checked}/${total} · ${passed} responded${wait ? ` · waiting ${wait}s for quota` : ''}`;
        }
      });
      if (!current()) return;
      publishModels();
      pill(passed ? 'ok' : 'saved', passed ? `${passed} models responded` : 'No confirmed models');
      status.textContent = `${result.halted ? 'Stopped' : 'Complete'}: ${checked}/${total} checked · ${passed} responded.${partial}${result.halted ? ' Remaining models were not checked.' : ''}`;
    } catch (error) {
      if (current()) {
        publishModels();
        status.textContent = `Stopped: ${error.message} ${checked}/${total} checked.`;
      }
    } finally {
      if (activeScan?.request === request) activeScan = null;
      if (current()) {
        el('ai-fetch-models').disabled = testing;
        el('ai-fetch-models').setAttribute('aria-busy', 'false');
        el('ai-stop-models').hidden = true;
        el('ai-load-progress').hidden = true;
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
    el('settings-kind').textContent = user.user_id.startsWith('google:') ? KIND.google : KIND.email;
  }

  async function renderSettings() {
    if (testing) return;
    const owner = signedInUser?.user_id;
    if (activeScan && activeScan.owner !== owner) resetModels();
    syncProbeBudget();
    renderAccountCard();
    if (activeScan?.owner === owner) return;
    const version = ++rendering;
    const status = el('ai-status'), pending = modelSnapshot?.owner === owner && modelSnapshot.draft?.api_key ? modelSnapshot : null;
    status.textContent = '';
    try {
      const data = await call('/api/ai/profiles');
      let local = [], deviceError = '';
      try { local = await VJProfiles.list(owner); } catch { deviceError = 'Device storage is unavailable. Choose server storage or enable browser storage.'; }
      if (testing || activeScan || version !== rendering || signedInUser?.user_id !== owner) return;
      profileRows = [...data.profiles.map(profile => ({...profile, scope: 'server'})), ...local.map(profile => ({...profile, scope: 'local'}))];
      storageEnabled = data.can_store;
      const choice = VJProfiles.active(owner);
      const profile = choice?.scope === 'none' ? null : choice?.scope === 'local'
        ? profileRows.find(row => row.scope === 'local' && row.id === choice.id)
        : profileRows.find(row => row.scope === 'server' && row.id === (choice?.scope === 'server' ? choice.id : data.active_id));
      let key = '';
      if (profile?.scope === 'local') key = (await VJProfiles.load(owner, profile.id)).api_key;
      if (activeScan || version !== rendering || signedInUser?.user_id !== owner) return;
      if (!choice && profile) VJProfiles.setActive(owner, {scope: profile.scope, id: profile.id});
      savedConnection = Boolean(profile);
      const list = el('ai-profile-list');
      list.replaceChildren();
      const empty = document.createElement('option');
      empty.value = ''; empty.textContent = 'New connection'; list.append(empty);
      for (const row of profileRows) {
        const option = document.createElement('option');
        option.value = profileChoice(row);
        option.textContent = `${row.name} · ${row.scope === 'local' ? 'This device' : 'Server'} · …${row.key_last4}`;
        list.append(option);
      }
      const cache = pending || recalledModels(owner, profile?.connection_id);
      fillProfile(profile, cache, key);
      if (pending) {
        el('ai-protocol').value = pending.draft.protocol;
        el('ai-base').value = pending.draft.base_url;
        el('ai-key').value = pending.draft.api_key;
        el('ai-key-hint').textContent = 'This checked draft is not saved. Save the profile to keep it after reload.';
      }
      modelSnapshot = pending;
      el('ai-source').hidden = Boolean(profile);
      el('ai-source').textContent = choice && choice.scope !== 'none' && !profile ? 'The selected API profile is unavailable. Choose another profile; no fallback is used.' : 'Save a connection once, then switch profiles without entering keys again.';
      pill(profile ? 'saved' : 'none', profile ? `Using ${profile.name}` : 'No profile selected');
      if (deviceError) status.textContent = deviceError;
    } catch (error) {
      if (version === rendering && signedInUser?.user_id === owner) { resetModels(); status.textContent = error.message; }
    }
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
    try {
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
      if (data.own?.id && data.own.model) VJProfiles.setActive(owner, {scope: 'server', id: data.own.id});
      return data.own?.model ? data.source : 'none';
    } catch { return 'none'; }
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
    el('ai-model-status').textContent = 'Stopped. Only completed successful responses are shown.';
  });
  el('ai-model-list').addEventListener('change', () => {
    if (el('ai-model-list').value) el('ai-model').value = el('ai-model-list').value;
    invalidateSelection();
    publishModels();
  });
  el('ai-key-toggle').addEventListener('click', () => {
    const show = el('ai-key').type === 'password';
    el('ai-key').type = show ? 'text' : 'password';
    el('ai-key-toggle').textContent = show ? 'Hide' : 'Show';
    el('ai-key-toggle').setAttribute('aria-label', show ? 'Hide API key' : 'Show API key');
    el('ai-key-toggle').setAttribute('aria-pressed', String(show));
  });
  el('auth-logout').addEventListener('click', () => {
    resetModels();
    syncProbeBudget(null);
  });
  el('settings-logout').addEventListener('click', () => el('auth-logout').click());
  document.querySelectorAll('.settings-nav button').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.settings-nav button').forEach(b => b.removeAttribute('aria-current'));
    button.setAttribute('aria-current', 'true');
    el(button.dataset.target).scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
  }));
  el('ai-profile-storage').addEventListener('change', () => { storageHint(); publishModels(); });
  el('ai-profile-new').addEventListener('click', () => {
    if (testing) return;
    ++rendering;
    fillProfile(null);
    savedConnection = false;
    invalidateSelection();
    el('ai-profile-name').focus();
  });
  el('ai-profile-list').addEventListener('change', () => {
    const value = el('ai-profile-list').value;
    if (!value) { el('ai-profile-new').click(); return; }
    const profile = profileRows.find(row => profileChoice(row) === value);
    if (!profile) return;
    profileAction(async owner => {
      if (profile.scope === 'server') await send(`/api/ai/profiles/${encodeURIComponent(profile.id)}/activate`, 'POST', {});
      else await VJProfiles.load(owner, profile.id);
      if (signedInUser?.user_id !== owner) throw new Error('The signed-in account changed.');
      VJProfiles.setActive(owner, {scope: profile.scope, id: profile.id});
      modelSnapshot = null;
      return `Using ${profile.name}. Saved models restored without checking them again.`;
    });
  });
  el('ai-profile-save').addEventListener('click', () => profileAction(() => saveProfile(false)));
  el('ai-form').addEventListener('submit', event => {
    event.preventDefault();
    return profileAction(() => saveProfile(true));
  });
  el('ai-remove').addEventListener('click', () => {
    const profile = selectedProfile;
    if (!profile || !confirm(`Delete ${profile.name} from ${profile.scope === 'local' ? 'this device' : 'your account'}? Other profiles will remain.`)) return;
    return profileAction(async owner => {
      if (profile.scope === 'local') await VJProfiles.remove(owner, profile.id);
      else await send(`/api/ai/profiles/${encodeURIComponent(profile.id)}`, 'DELETE');
      VJProfiles.setActive(owner, {scope: 'none', id: ''});
      modelSnapshot = null;
      return 'Profile deleted. Choose another connection to continue; no fallback was selected.';
    });
  });
})();
