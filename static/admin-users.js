// Admin: find and manage learners. Message contents are deliberately never shown here.
(function () {
  const el = id => document.getElementById(id);
  const KIND = {google: 'Google', email: 'Email', guest: 'Khách cũ'};
  const ROLE = {owner: 'Chủ sở hữu', admin: 'Quản trị viên', free: 'Miễn phí'};
  const ACTIONS = [
    ['clear_chat', 'Xóa lịch sử chat', 'Xóa toàn bộ lịch sử chat của người này?'],
    ['reset_progress', 'Đặt lại tiến độ', 'Xóa toàn bộ tiến độ, bài hoàn thành và bài thi của người này?'],
    ['remove_api', 'Xóa API đã lưu', 'Xóa API key đã lưu của người này?'],
    ['revoke_sessions', 'Đăng xuất mọi thiết bị', 'Đăng xuất người này khỏi mọi thiết bị?'],
    ['delete', 'Xóa tài khoản', 'Xóa vĩnh viễn tài khoản và mọi dữ liệu của người này? Không thể hoàn tác.']
  ];
  let offset = 0, total = 0, query = '', timer, current = null, loadVersion = 0;

  async function call(path, options) {
    const response = await apiFetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Không thực hiện được.');
    return data;
  }
  const post = body => call('/api/admin/user', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const day = iso => iso ? new Date(iso).toLocaleDateString('vi-VN') : '—';
  const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };

  async function load() {
    const host = el('admin-users'), version = ++loadVersion;
    try {
      const data = await call(`/api/admin/users?offset=${offset}&q=${encodeURIComponent(query)}`);
      if (version !== loadVersion) return;
      total = data.total;
      el('admin-purge').hidden = !data.guests;
      el('admin-purge').textContent = `Dọn ${data.guests} tài khoản khách cũ`;
      host.replaceChildren(...(data.users.length ? data.users : [null]).map(user => {
        if (!user) return node('p', 'Không có người dùng.', 'ai-source');
        const row = node('button', undefined, 'admin-user-row'), who = node('span', undefined, 'admin-user-who');
        row.type = 'button';
        who.append(node('strong', user.name || 'Học viên ' + user.user_id.slice(-4)), node('small', user.email || user.user_id));
        row.append(who, node('span', ROLE[user.role] || KIND[user.kind], 'admin-badge'), node('span', user.level), node('span', user.messages + ' tin'), node('span', day(user.last_login || user.last_chat)));
        if (user.api) row.append(node('span', 'API', 'admin-badge admin-badge-on'));
        row.onclick = () => openUser(user.user_id);
        return row;
      }));
      el('admin-range').textContent = total ? `${offset + 1}–${Math.min(offset + data.users.length, total)} / ${total}` : '0';
      el('admin-prev').disabled = offset === 0;
      el('admin-next').disabled = offset + 25 >= total;
    } catch (error) { if (version === loadVersion) host.textContent = error.message; }
  }

  async function openUser(id) {
    const dialog = el('admin-user-dialog');
    el('admin-user-status').textContent = '';
    try {
      const user = current = await call('/api/admin/user?id=' + encodeURIComponent(id));
      el('admin-user-name').textContent = user.name || 'Học viên ' + user.user_id.slice(-4);
      el('admin-user-meta').textContent = [KIND[user.kind], user.email, user.admin ? 'Admin' : ''].filter(Boolean).join(' · ');
      const stats = [['Tin nhắn', user.messages], ['Mục đã học', user.items], ['Bài hoàn thành', user.completed], ['Phiên đang mở', user.sessions], ['Đăng nhập gần nhất', day(user.last_login)], ['API', user.api || 'Chưa có']];
      el('admin-user-stats').replaceChildren(...stats.flatMap(([label, value]) => [node('dt', label), node('dd', String(value))]));
      el('admin-level').value = user.level;
      el('admin-role-label').textContent = ROLE[user.role] || 'Miễn phí';
      const roleButton = el('admin-role-toggle');
      roleButton.textContent = user.admin ? 'Thu hồi quyền quản trị' : 'Cấp quyền quản trị';
      roleButton.hidden = user.kind === 'guest' || user.role === 'owner' || user.user_id === signedInUser?.user_id;
      el('admin-user-actions').replaceChildren(...ACTIONS.map(([action, label, ask]) => {
        const button = node('button', label, action === 'delete' ? 'stage-btn admin-danger' : 'stage-btn');
        button.type = 'button';
        button.onclick = async () => {
          if (!confirm(ask)) return;
          try {
            await post({id: user.user_id, action});
            if (action === 'delete') { dialog.close(); load(); window.renderAiPanels('admin'); return; }
            await openUser(user.user_id);
            el('admin-user-status').textContent = 'Đã thực hiện.';
            load();
          } catch (error) { el('admin-user-status').textContent = error.message; }
        };
        return button;
      }));
      if (!dialog.open) dialog.showModal();
    } catch (error) { el('admin-users').textContent = error.message; }
  }

  window.renderAdminUsers = () => { offset = 0; load(); };
  el('admin-search').addEventListener('input', event => { clearTimeout(timer); timer = setTimeout(() => { query = event.target.value.trim(); offset = 0; load(); }, 250); });
  el('admin-purge').addEventListener('click', async () => {
    if (!confirm('Xóa vĩnh viễn các tài khoản khách cũ (không có Google hay email) và dữ liệu của chúng?')) return;
    try { await call('/api/admin/purge-guests', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}); window.renderAiPanels('admin'); } catch (error) { el('admin-users').textContent = error.message; }
  });
  el('admin-prev').addEventListener('click', () => { offset = Math.max(0, offset - 25); load(); });
  el('admin-next').addEventListener('click', () => { offset += 25; load(); });
  el('admin-user-close').addEventListener('click', () => el('admin-user-dialog').close());
  el('admin-user-dialog').addEventListener('click', event => { if (event.target === el('admin-user-dialog')) el('admin-user-dialog').close(); });
  el('admin-level-form').addEventListener('submit', async event => {
    event.preventDefault();
    try { await post({id: current.user_id, action: 'set_level', level: el('admin-level').value}); el('admin-user-status').textContent = 'Đã lưu cấp độ.'; load(); } catch (error) { el('admin-user-status').textContent = error.message; }
  });
  el('admin-role-toggle').addEventListener('click', async () => {
    const user = current, button = el('admin-role-toggle'), role = user.admin ? 'free' : 'admin';
    if (!confirm(role === 'admin' ? 'Cấp quyền quản trị và quyền dùng OpenAI chung cho tài khoản này?' : 'Thu hồi quyền quản trị và quyền dùng OpenAI chung?')) return;
    button.disabled = true;
    try { await post({id: user.user_id, action: 'set_role', role}); await openUser(user.user_id); el('admin-user-status').textContent = 'Đã cập nhật quyền.'; load(); }
    catch (error) { el('admin-user-status').textContent = error.message; }
    finally { button.disabled = false; }
  });
})();
