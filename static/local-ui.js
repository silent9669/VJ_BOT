// Local comparison only: never load trial assets or controls on a public/LAN host.
(() => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
  const key = 'vjbot_local_ui';
  const valid = value => value === 'manga' || value === 'current';
  let selected = 'manga';
  try { const saved = localStorage.getItem(key); if (valid(saved)) selected = saved; } catch {}
  const requested = new URLSearchParams(location.search).get('ui');
  if (valid(requested)) selected = requested;
  const apply = value => {
    selected = valid(value) ? value : 'manga';
    document.documentElement.dataset.ui = selected;
    try { localStorage.setItem(key, selected); } catch {}
  };
  apply(selected);
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet'; stylesheet.href = '/manga.css'; document.head.append(stylesheet);
  const fonts = document.createElement('link'); fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap';
  document.head.append(fonts);

  function mount() {
    const bar = document.createElement('aside');
    bar.id = 'local-ui-bar'; bar.setAttribute('aria-label', 'Thử giao diện cục bộ');
    // Inline because comparison controls must stay usable with either theme selected.
    bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 20px;padding:8px 20px;min-height:52px;background:#181818;color:#fff;font:12px/1.5 system-ui,sans-serif;border-bottom:1px solid #50504c;position:relative;z-index:60';
    const note = document.createElement('span'); note.textContent = 'BẢN THỬ CỤC BỘ · Dữ liệu trên máy này';
    const label = document.createElement('label'); label.htmlFor = 'local-ui-switch';
    label.style.cssText = 'display:flex;align-items:center;gap:10px;color:#fff'; label.textContent = 'Giao diện';
    const select = document.createElement('select'); select.id = 'local-ui-switch';
    select.style.cssText = 'min-height:44px;border:1px solid #fff;border-radius:3px;background:#fff;color:#181818;padding:6px 12px;font:inherit';
    for (const [value, text] of [['manga', 'B · Manga Club'], ['current', 'Giao diện hiện tại']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
    }
    select.value = selected;
    select.addEventListener('change', () => apply(select.value));
    label.append(select); bar.append(note, label); document.body.prepend(bar);

    const nav = document.createElement('nav'); nav.id = 'manga-nav'; nav.setAttribute('aria-label', 'Điều hướng Manga Club');
    const brand = document.createElement('span'); brand.className = 'manga-wordmark'; brand.textContent = 'VJBOT'; nav.append(brand);
    const routes = [['dashboard', 'Học tập'], ['curriculum', 'Khóa học'], ['flashcards', 'Thẻ nhớ'], ['kanji', 'Kanji'],
      ['kaiwa', 'Luyện nói'], ['quiz', 'Luyện thi'], ['classroom', 'Thầy Lâm'], ['mastery', 'Tiến độ'], ['settings', 'Cài đặt'], ['admin', 'Quản trị']];
    const adminButton = document.getElementById('tab-btn-admin');
    const links = routes.map(([route, title]) => {
      const link = document.createElement('a'); link.href = '#' + route; link.textContent = title; nav.append(link);
      return {link, route};
    });
    const update = () => {
      const route = location.hash.slice(1).split('/')[0];
      for (const entry of links) {
        if (entry.route === 'admin') entry.link.hidden = !adminButton || adminButton.hidden;
        if (entry.route === route) entry.link.setAttribute('aria-current', 'page');
        else entry.link.removeAttribute('aria-current');
      }
    };
    update(); addEventListener('hashchange', update);
    // switchTab uses pushState, so hashchange alone misses in-app navigation.
    new MutationObserver(update).observe(document.body, {attributes: true, attributeFilter: ['data-page']});
    if (adminButton) new MutationObserver(update).observe(adminButton, {attributes: true, attributeFilter: ['hidden']});
    const main = document.querySelector('.app-main'); if (main) main.prepend(nav);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true});
  else mount();
})();
