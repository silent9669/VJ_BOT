// Settings: the learner's own API (OpenAI-compatible, Claude or Gemini). Admin: activity.
(function () {
  const el = id => document.getElementById(id);
  const BASES = {openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com'};
  let savedConnection = false, storageEnabled = false, modelRequest = 0, modelAbort = null, testing = false;
  let nextProbeAt = 0, timingIdentity = null, dispatchedAt = Object.freeze([]);
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
    modelRequest++;
    modelAbort?.abort();
    el('ai-stop-models').hidden = true;
    el('ai-fetch-models').disabled = testing;
    el('ai-fetch-models').setAttribute('aria-busy', 'false');
    el('ai-load-progress').hidden = true;
  }
  function resetModels() {
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
    el('ai-save').disabled = !storageEnabled || !list.value;
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
    if (testing) return;
    resetModels();
    invalidateSelection();
    syncProbeBudget();
    const request = modelRequest, status = el('ai-model-status'), owner = signedInUser?.user_id;
    const draft = {protocol: el('ai-protocol').value, base_url: el('ai-base').value, api_key: el('ai-key').value.trim()};
    if (!draft.api_key && !savedConnection) {
      status.textContent = 'Enter your API URL and key to check models.';
      return;
    }
    modelAbort = new AbortController();
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
    syncProbeBudget();
    renderAccountCard();
    el('ai-chat').hidden = true;
    const status = el('ai-status');
    status.textContent = '';
    try {
      const data = await call('/api/ai/settings');
      if (testing) return;
      const own = data.own;
      savedConnection = Boolean(own);
      storageEnabled = data.can_store;
      el('ai-source').textContent = data.source === 'none' ? 'Connect your own API to start chatting with the tutor.' : '';
      el('ai-source').hidden = data.source !== 'none';
      pill(own ? 'saved' : 'none', own ? 'Saved · not tested' : 'Not connected');
      el('ai-protocol').value = own?.protocol || 'openai';
      el('ai-base').value = own?.base_url || '';
      syncProtocol();
      el('ai-model').value = own?.model || '';
      el('ai-key').value = '';
      el('ai-key').placeholder = own ? '••••' + own.key_last4 : 'sk-…';
      el('ai-key').type = 'password';
      el('ai-key-toggle').textContent = 'Show';
      el('ai-key-toggle').setAttribute('aria-label', 'Show API key');
      el('ai-key-toggle').setAttribute('aria-pressed', 'false');
      el('ai-key-hint').textContent = own ? `A key ending ${own.key_last4} is saved. Leave blank to reuse it for this URL and API type. A changed connection requires a new key.` : 'Stored encrypted on the server. Never paste your key into chat.';
      el('ai-key').required = !own;
      el('ai-remove').hidden = !own;
      el('ai-save').disabled = true;
      if (!data.can_store) status.textContent = 'API key storage is not enabled on this server.';
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
    el('ai-save').disabled = !storageEnabled || !el('ai-model-list').value;
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
  el('ai-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (testing) return;
    const model = el('ai-model-list').value;
    if (el('ai-models').hidden || !model) {
      el('ai-status').textContent = 'Check models first, then choose a successful result.';
      return;
    }
    stopModels();
    testing = true;
    const status = el('ai-status'), save = el('ai-save');
    const controls = [...el('ai-form').querySelectorAll('input, select, button')];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    let saved = false;
    save.disabled = true;
    status.textContent = 'Saving connection…';
    try {
      await send('/api/ai/settings', 'PUT', {protocol: el('ai-protocol').value, base_url: el('ai-base').value, model, api_key: el('ai-key').value.trim()});
      saved = true;
      status.textContent = `Saved ${model}. Its last model check succeeded.`;
    } catch (error) { status.textContent = `Connection was not saved. ${error.message}`; }
    controls.forEach((control, index) => { control.disabled = disabled[index]; });
    testing = false;
    const kept = status.textContent;
    if (saved) await renderSettings();
    status.textContent = kept;
    pill(saved ? 'saved' : 'error', saved ? 'Connection saved' : 'Connection was not saved');
    el('ai-chat').hidden = !saved;
    window.checkAiReady();
  });
  el('ai-remove').addEventListener('click', async () => {
    if (!confirm('Remove the saved API key? Chat will be unavailable until you save another connection.')) return;
    try { await send('/api/ai/settings', 'DELETE'); await renderSettings(); window.checkAiReady(); } catch (error) { el('ai-status').textContent = error.message; }
  });
})();
