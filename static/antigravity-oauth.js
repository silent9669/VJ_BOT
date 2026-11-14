// Browser storage contains only per-user connection preferences, never OAuth secrets.
(function () {
  const el = id => document.getElementById(id), root = '/api/ai/oauth/antigravity';
  const owner = () => signedInUser?.is_admin === true ? null : signedInUser?.user_id;
  const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  const selected = () => window.antigravityConnectionId?.(owner());
  let rows = [], rowsOwner = null, rendering = 0, revision = 0, busy = false;
  let pending = null, timer = null, polling = 0, panel = null, panelOwner = null;
  let loaded = '', usageRequest = 0, catalogRequest = 0;
  const errorText = error => ['SecurityError', 'QuotaExceededError'].includes(error.name)
    ? 'Không truy cập được bộ nhớ trình duyệt. Cho phép lưu dữ liệu trang web hoặc giải phóng dung lượng rồi thử lại.'
    : error.message;
  async function api(path = '', method = 'GET', body) {
    const response = await apiFetch(root + path, {method, headers:{'Content-Type':'application/json'},
      ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const data = await response.json().catch(() => { throw new Error('Máy chủ trả về dữ liệu không đọc được. Làm mới trạng thái kết nối rồi thử lại.'); });
    if (!response.ok) throw new Error(data.detail || 'Kết nối Antigravity không khả dụng.');
    return data;
  }
  function current(id, connection, version) {
    return id === owner() && connection === selected() && version === revision && usesAntigravityOAuth(id);
  }
  function paint() {
    if (signedInUser?.is_admin === true) {
      el('ai-form').hidden = el('ai-oauth-panel').hidden = true;
      return;
    }
    if (panelOwner !== owner()) { panelOwner = owner(); panel = null; }
    const oauth = panel ? panel === 'oauth' : usesAntigravityOAuth(owner());
    el('ai-form').hidden = oauth;
    el('ai-oauth-panel').hidden = !oauth;
    const adding = panel === 'oauth';
    el('ai-oauth-panel').dataset.adding = String(adding);
    el('ai-oauth-add-fields').hidden = !adding;
    el('ai-oauth-back').hidden = !adding;
    if (oauth) el('ai-source').hidden = true;
  }
  function showPanel(method) {
    panelOwner = owner(); panel = method; paint();
    if (method === 'oauth') { el('ai-oauth-manage').open = true; el('ai-oauth-name').focus(); }
  }
  function choose(connection) {
    const id = owner();
    if (!id) throw new Error('Đăng nhập trước khi chọn kết nối AI.');
    if (!validId(connection)) throw new Error('Chọn kết nối Antigravity đã lưu.');
    window.pauseApiModelScan?.();
    localStorage.setItem('vjbot_ai_oauth:' + id, connection);
    localStorage.setItem('vjbot_ai_method:' + id, 'antigravity');
    revision++; loaded = ''; panel = null; panelOwner = id; paint();
    window.cancelPracticeCoach?.();
    el('ai-oauth-manage').open = false;
    window.refreshSavedConnections?.(); window.checkAiReady?.();
  }
  function stopPolling() { polling++; clearTimeout(timer); timer = null; pending = null; }
  function authorizationUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Địa chỉ đăng nhập Antigravity không hợp lệ.'); }
    if (url.origin !== 'https://accounts.google.com' || !['/o/oauth2/auth','/o/oauth2/v2/auth'].includes(url.pathname)) throw new Error('Địa chỉ đăng nhập Antigravity không hợp lệ.');
    return url.href;
  }
  function showPending(value) {
    el('ai-oauth-pending').hidden = !value;
    if (value) el('ai-oauth-continue').href = authorizationUrl(value.authorization_url);
    else { el('ai-oauth-continue').removeAttribute('href'); el('ai-oauth-callback-url').value = ''; }
  }
  function startPolling(value, id) {
    if (pending?.handle === value.handle && pending.owner === id) return;
    stopPolling(); pending = {...value, owner:id};
    const version = polling;
    async function tick() {
      if (version !== polling || owner() !== id) { if (version === polling) stopPolling(); return; }
      if (Date.now() >= value.expires_at) { stopPolling(); el('ai-oauth-status').textContent = 'Phiên đăng nhập đã hết hạn. Làm mới danh sách tài khoản rồi bắt đầu lại.'; return; }
      try {
        const data = await api('/status', 'POST', {handle:value.handle});
        if (version !== polling || owner() !== id) return;
        if (data.status === 'ok') {
          if (!validId(data.connection_id)) throw new Error('Đăng nhập không trả về mã kết nối đã lưu. Hãy làm mới danh sách tài khoản.');
          stopPolling(); showPending(null); el('ai-oauth-name').value = ''; choose(data.connection_id); await render(); return;
        }
        timer = setTimeout(tick, 2000);
      } catch (error) {
        if (version === polling && owner() === id) { stopPolling(); el('ai-oauth-status').textContent = errorText(error); }
      }
    }
    timer = setTimeout(tick, 1000);
  }
  function modelActionState() {
    const model = el('ai-oauth-model').value;
    const saved = rows.find(row => row.id === selected())?.model;
    const changed = Boolean(model && model !== saved);
    el('ai-oauth-use').hidden = !changed;
    el('ai-oauth-use').disabled = !model;
    el('ai-oauth-test-hint').hidden = !changed;
    el('ai-oauth-model-hint').textContent = changed
      ? 'Lựa chọn mới. Hãy kiểm tra và lưu trước khi dùng để trò chuyện.'
      : '';
  }
  async function catalog(connection, savedModel = '') {
    const id = owner(), version = revision, request = ++catalogRequest;
    const data = await api('/models?connection_id=' + encodeURIComponent(connection));
    if (!current(id, connection, version) || request !== catalogRequest) return;
    if (!Array.isArray(data.models) || data.models.some(model => typeof model !== 'string')) throw new Error('Danh mục mô hình của tài khoản Antigravity không hợp lệ.');
    const select = el('ai-oauth-model'); select.replaceChildren();
    const models = savedModel && !data.models.includes(savedModel) ? [savedModel, ...data.models] : data.models;
    for (const model of models) {
      const option = document.createElement('option'); option.value = model; option.textContent = model; select.append(option);
    }
    if (savedModel) select.value = savedModel;
    modelActionState();
    el('ai-oauth-status').textContent = `Đã liệt kê ${data.models.length} mô hình · chưa kiểm tra quyền truy cập.`;
  }
  async function usage() {
    const id = owner(), connection = selected(), version = revision, request = ++usageRequest;
    if (!connection || !usesAntigravityOAuth(id)) return;
    const section = el('ai-oauth-usage'), status = el('ai-oauth-usage-status');
    section.hidden = false; section.setAttribute('aria-busy', 'true');
    el('ai-oauth-usage-refresh').disabled = true;
    el('ai-oauth-usage-models').replaceChildren(); status.textContent = 'Đang tải mức sử dụng từ nhà cung cấp…';
    el('ai-oauth-usage-overview').textContent = 'Đang tải hạn mức…';
    const overviewMeter = el('ai-oauth-usage-meter');
    overviewMeter.hidden = true;
    try {
      const data = await api('/usage?connection_id=' + encodeURIComponent(connection));
      if (!current(id, connection, version) || request !== usageRequest) return;
      if (data.connection_id !== connection) throw new Error('Thông tin sử dụng trả về không khớp với kết nối đã chọn.');
      const checked = typeof data.checked_at === 'string' && Number.isFinite(Date.parse(data.checked_at))
        ? new Date(data.checked_at).toLocaleString('vi-VN') : 'chưa rõ';
      const checkedTime = checked === 'chưa rõ' ? checked : new Date(data.checked_at).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'});
      status.textContent = data.available ? `Đã cập nhật ${checkedTime}` : `Chưa có thông tin sử dụng · ${checkedTime}`;
      status.title = `Mức sử dụng do nhà cung cấp báo cáo. Kiểm tra lúc: ${checked}.`;
      const fractions = (Array.isArray(data.models) ? data.models : []).map(row => row.remaining_fraction)
        .filter(value => Number.isFinite(value) && value >= 0 && value <= 1);
      const percent = value => (value * 100).toLocaleString('vi-VN', {maximumFractionDigits:1}) + '%';
      const low = Math.min(...fractions);
      el('ai-oauth-usage-overview').textContent = fractions.length ? `Còn ${percent(low)}` : 'Chưa có thông tin hạn mức';
      el('ai-oauth-usage-overview').title = fractions.length ? 'Hạn mức mô hình thấp nhất được báo cáo, không phải số dư chung của tài khoản.' : '';
      overviewMeter.hidden = !fractions.length;
      if (fractions.length) {
        overviewMeter.value = low;
        overviewMeter.setAttribute('aria-valuetext', `Còn ${percent(low)} ở hạn mức mô hình thấp nhất được báo cáo`);
      }
      for (const row of Array.isArray(data.models) ? data.models : []) {
        if (typeof row.model !== 'string') continue;
        const item = document.createElement('li'), name = document.createElement('strong'), detail = document.createElement('span');
        name.textContent = row.model;
        const fraction = row.remaining_fraction;
        const known = Number.isFinite(fraction) && fraction >= 0 && fraction <= 1;
        const remaining = known
          ? fraction === 0 ? 'Còn 0% · đã hết hạn mức' : `Còn ${(fraction * 100).toLocaleString('vi-VN', {maximumFractionDigits:2})}%`
          : 'Chưa rõ hạn mức còn lại';
        const reset = typeof row.reset_at === 'string' ? Date.parse(row.reset_at) : NaN;
        detail.textContent = remaining + (Number.isFinite(reset)
          ? ` · ${reset < Date.now() ? 'Mốc khôi phục đã qua' : 'Khôi phục lúc'}: ${new Date(reset).toLocaleString('vi-VN')}` : ' · Chưa rõ thời điểm khôi phục');
        item.append(name, detail);
        if (known) {
          const meter = document.createElement('meter');
          meter.className = 'ai-quota-meter';
          meter.min = 0; meter.max = 1; meter.value = fraction;
          meter.setAttribute('aria-label', 'Hạn mức còn lại của ' + row.model);
          meter.setAttribute('aria-valuetext', remaining);
          item.append(meter);
        }
        el('ai-oauth-usage-models').append(item);
      }
      if (!data.models?.length) status.textContent += ' Nhà cung cấp chưa báo cáo hạn mức của mô hình nào.';
    } catch (error) {
      if (current(id, connection, version) && request === usageRequest) {
        status.textContent = 'Chưa có thông tin sử dụng. ' + error.message;
        el('ai-oauth-usage-overview').textContent = 'Chưa có thông tin hạn mức';
      }
    } finally {
      if (current(id, connection, version) && request === usageRequest) {
        section.setAttribute('aria-busy', 'false'); el('ai-oauth-usage-refresh').disabled = false;
      }
    }
  }
  async function render() {
    const id = owner(), version = ++rendering;
    if (rowsOwner !== id) {
      stopPolling(); revision++; loaded = ''; rows = []; rowsOwner = null;
      el('ai-oauth-model').replaceChildren(); el('ai-oauth-usage-models').replaceChildren();
      el('ai-oauth-usage-status').textContent = ''; el('ai-oauth-usage').hidden = true;
      el('ai-oauth-usage-overview').textContent = 'Chưa có thông tin hạn mức';
      showPending(null);
    }
    if (!id) { paint(); window.refreshSavedConnections?.(); return; }
    try {
      const preference = localStorage.getItem('vjbot_ai_oauth:' + id);
      paint();
      const data = await api();
      if (id !== owner() || version !== rendering) return;
      rows = (data.connections || []).filter(row => validId(row.id)); rowsOwner = id;
      if (preference === null && localStorage.getItem('vjbot_ai_oauth:' + id) === null && validId(data.active_id)) {
        localStorage.setItem('vjbot_ai_oauth:' + id, data.active_id);
        window.checkAiReady?.();
      }
      window.refreshSavedConnections?.();
      const connection = selected(), row = rows.find(row => row.id === connection);
      const oauth = usesAntigravityOAuth(id);
      el('ai-oauth-connect').hidden = !!data.pending;
      el('ai-oauth-connect').disabled = !data.configured;
      el('ai-oauth-disconnect').hidden = !oauth || !row;
      el('ai-oauth-selection').hidden = !oauth || !row || row.state !== 'active';
      el('ai-oauth-usage').hidden = !oauth || !row;
      el('ai-oauth-setup').hidden = data.configured;
      el('ai-oauth-missing').textContent = 'Các thiết lập máy chủ bắt buộc: ' + (data.missing || []).join(', ');
      if (oauth) {
        el('ai-pill').textContent = row ? row.name : 'Chưa chọn kết nối OAuth';
        el('ai-pill').dataset.state = row ? 'saved' : 'none';
      }
      showPending(data.pending);
      if (data.pending) startPolling(data.pending, id); else stopPolling();
      el('ai-oauth-status').textContent = data.pending ? 'Đang chờ đăng nhập Google. Các kết nối đã lưu vẫn dùng được.'
        : !data.configured ? 'Máy chủ cần cổng kết nối Antigravity riêng. Các kết nối dùng khóa API vẫn dùng được.'
        : row && oauth ? row.state === 'active' ? '' : 'Tài khoản này cần được xử lý. Thêm tài khoản khác hoặc xóa kết nối này.'
        : connection && oauth ? 'Kết nối OAuth đã chọn không khả dụng. Hãy chọn kết nối khác; không tự động dùng kết nối thay thế.'
        : 'Đăng nhập để thêm tài khoản Antigravity. Các kết nối hiện có được giữ nguyên.';
      const identity = `${id}:${connection}`;
      if (oauth && row && loaded !== identity) {
        loaded = identity; el('ai-oauth-model').replaceChildren();
        el('ai-oauth-usage').setAttribute('aria-busy', 'false');
        await Promise.all([row.state === 'active' ? catalog(connection, row.model) : Promise.resolve(), usage()]);
      }
    } catch (error) {
      if (id === owner() && version === rendering) {
        el('ai-oauth-status').textContent = errorText(error);
        el('ai-connection-status').textContent = 'Không tải được tài khoản OAuth. ' + errorText(error);
      }
    }
  }
  async function action(task) {
    if (busy) return;
    busy = true;
    rendering++;
    el('ai-connection-status').textContent = 'Đang cập nhật kết nối OAuth…';
    el('ai-profile-list').setAttribute('aria-busy', 'true');
    const id = owner(), version = revision, connection = selected();
    const controls = [...el('ai-oauth-panel').querySelectorAll('input, select, button'), el('ai-method-oauth'), el('ai-profile-list'), el('ai-profile-new'), el('ai-add-connection'), el('ai-chat')]
      .filter(control => control !== el('ai-oauth-usage-refresh'));
    const previous = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; }); el('ai-oauth-panel').setAttribute('aria-busy', 'true');
    try { await task(id, connection, version); if (id === owner()) el('ai-connection-status').textContent = ''; }
    catch (error) { if (id === owner() && version === revision) { el('ai-oauth-status').textContent = errorText(error); el('ai-connection-status').textContent = errorText(error); } }
    finally {
      controls.forEach((control, index) => { control.disabled = previous[index]; });
      busy = false; el('ai-oauth-panel').setAttribute('aria-busy', 'false');
      el('ai-profile-list').setAttribute('aria-busy', 'false');
      modelActionState();
    }
  }
  window.selectAntigravityConnection = connection => action(async (id, _old, version) => {
    if (rowsOwner !== id || !rows.some(row => row.id === connection)) throw new Error('Làm mới danh sách tài khoản trước khi chọn kết nối này.');
    await api('/connections/' + encodeURIComponent(connection) + '/activate', 'POST', {});
    if (id !== owner() || version !== revision) return;
    choose(connection); await render();
  });
  el('ai-method-oauth').onclick = () => { showPanel('oauth'); render(); };
  el('ai-oauth-connect').onclick = () => {
    if (busy) return;
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    return action(async id => {
      try {
        const name = el('ai-oauth-name').value.trim();
        const data = await api('/start', 'POST', name ? {name} : {});
        if (id !== owner()) { popup?.close(); return; }
        const url = authorizationUrl(data.authorization_url);
        showPending(data); startPolling(data, id); el('ai-oauth-connect').hidden = true;
        el('ai-oauth-status').textContent = 'Đang chờ đăng nhập Google. Nếu không có thẻ mới mở ra, chọn Tiếp tục với Google.';
        if (popup) popup.location.replace(url);
      } catch (error) { popup?.close(); throw error; }
    });
  };
  el('ai-oauth-status-refresh').onclick = () => render();
  el('ai-oauth-refresh').onclick = () => action(async (_id, connection) => {
    const row = rows.find(row => row.id === connection);
    if (!row) throw new Error('Chọn kết nối OAuth đã lưu.');
    await catalog(connection, row.model);
  });
  el('ai-oauth-usage-refresh').onclick = () => usage();
  el('ai-oauth-model').onchange = modelActionState;
  el('ai-oauth-use').onclick = () => action(async (id, connection, version) => {
    if (!connection) throw new Error('Chọn kết nối OAuth đã lưu.');
    const model = el('ai-oauth-model').value;
    el('ai-oauth-status').textContent = 'Đang kiểm tra mô hình Antigravity đã chọn…';
    const data = await api('/model', 'PUT', {connection_id:connection, model});
    if (!current(id, connection, version)) return;
    rows = rows.map(row => row.id === connection ? {...row, model:data.model} : row);
    el('ai-oauth-status').textContent = `${data.model} đã trả về văn bản. Đọc thành tiếng vẫn dùng kết nối khóa API riêng.`;
    window.refreshSavedConnections?.(); window.checkAiReady?.();
  });
  el('ai-oauth-cancel').onclick = () => action(async id => {
    const handle = pending?.handle;
    if (!handle) throw new Error('Làm mới trạng thái đăng nhập trước khi hủy.');
    await api('/cancel', 'POST', {handle});
    if (id !== owner()) return;
    stopPolling(); showPending(null); el('ai-oauth-connect').hidden = false;
    el('ai-oauth-status').textContent = 'Đã hủy đăng nhập Antigravity.';
  });
  el('ai-oauth-callback-submit').onclick = () => action(async id => {
    if (!pending || pending.owner !== id) throw new Error('Làm mới trạng thái đăng nhập trước khi gửi URL chuyển hướng về ứng dụng.');
    await api('/callback', 'POST', {handle:pending.handle, redirect_url:el('ai-oauth-callback-url').value.trim()});
    if (id !== owner()) return;
    el('ai-oauth-callback-url').value = '';
    el('ai-oauth-status').textContent = 'Đã gửi URL chuyển hướng về ứng dụng. Đang chờ hoàn tất đăng nhập…';
  });
  el('ai-oauth-disconnect').onclick = () => action(async (id, connection, version) => {
    if (!connection) throw new Error('Chọn kết nối OAuth đã lưu.');
    await api('', 'DELETE', {connection_id:connection});
    if (!current(id, connection, version)) return;
    localStorage.setItem('vjbot_ai_oauth:' + id, '');
    revision++; loaded = ''; rows = rows.filter(row => row.id !== connection);
    el('ai-oauth-model').replaceChildren(); el('ai-oauth-usage-models').replaceChildren();
    await render(); window.checkAiReady?.();
  });
  window.savedOAuthConnections = () => rowsOwner === owner() ? rows : [];
  window.showAiConnectionForm = showPanel;
  window.aiConnectionChanged = () => {
    revision++; rendering++; loaded = ''; panel = null; paint();
    window.cancelPracticeCoach?.();
    el('ai-oauth-model').replaceChildren(); el('ai-oauth-usage-models').replaceChildren();
  };
  window.renderAntigravityOAuth = render;
  window.addEventListener('vjbot-account-ready', () => { stopPolling(); revision++; loaded = ''; panel = null; render(); });
})();
