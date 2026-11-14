// Account dropdown under the avatar: theme, settings, sign out. Signed-out visitors still get the sign-in sheet.
(function () {
  const el = id => document.getElementById(id);
  const menu = el('account-menu'), button = el('btn-topbar-account');
  if (!menu || !button) return;
  const theme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  function applyTheme(value) {
    document.documentElement.dataset.theme = value;
    try { localStorage.setItem('vjbot_theme', value); } catch {}
    const color = document.querySelector('meta[name=theme-color]'); if (color) color.content = value === 'dark' ? '#121413' : '#f7f8f6';
    sync();
  }
  function sync() {
    for (const choice of menu.querySelectorAll('[data-theme-choice]')) choice.setAttribute('aria-checked', String(choice.dataset.themeChoice === theme()));
    const user = typeof signedInUser === 'undefined' ? null : signedInUser;
    el('account-menu-name').textContent = user?.name || 'Tài khoản';
    el('account-menu-initial').textContent = (user?.name || 'A').trim().slice(0, 1).toUpperCase();
    el('account-menu-role').textContent = user?.is_admin ? 'Quản trị viên' : 'Học viên';
  }
  function close() { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); }
  window.toggleAccountMenu = () => {
    if (!menu.hidden) return close();
    sync(); menu.hidden = false; button.setAttribute('aria-expanded', 'true');
  };
  button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
  menu.addEventListener('click', event => {
    const choice = event.target.closest('[data-theme-choice]');
    if (choice) return applyTheme(choice.dataset.themeChoice);
    const item = event.target.closest('[role=menuitem]');
    if (!item) return;
    close();
    if (item.id === 'account-menu-settings') switchTab('settings');
    else if (item.id === 'account-menu-logout') el('auth-logout').click();
  });
  document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target) && !el('sidebar-account')?.contains(event.target)) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { close(); button.focus(); } });
  window.addEventListener('hashchange', close);
  sync();
})();
