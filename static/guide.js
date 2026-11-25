(() => {
  const button = document.getElementById('btn-app-guide');
  if (!button) return;

  const steps = [
    { tab: 'dashboard', target: '#app-sidebar', title: 'Bản đồ lớp học', text: 'Từ đây em mở bài học, thẻ nhớ, Hán tự, Kaiwa và luyện thi. Thầy sẽ đi cùng em trong vài màn hình.' },
    { tab: 'dashboard', target: '#dashboard-content', title: 'Học tập', text: 'Bảng này cho biết hôm nay em nên học gì và chỗ nào đang cần ôn.' },
    { tab: 'curriculum', target: '#panel-curriculum', title: 'Khóa học', text: 'Chọn JLPT N5–N1, rồi đi theo lộ trình từng chương. Bài nào cũng có hoạt động để kiểm tra hiểu bài.' },
    { tab: 'classroom', target: '.classroom-chat-window', title: 'Thầy Lâm', text: 'Đây là lớp học đảo ngược: thầy hỏi, em tự trả lời. Đừng chỉ đọc câu mẫu, hãy thử viết hoặc nói trước.' },
    { tab: 'flashcards', target: '#panel-flashcards', title: 'Thẻ nhớ', text: 'Lật thẻ, tự nhớ nghĩa và cách đọc, rồi chọn mức nhớ để thẻ quay lại đúng lúc.' },
    { tab: 'kanji', target: '#panel-kanji', title: 'Hán tự', text: 'Học Hán tự theo cấp độ, xem nghĩa và luyện nhận diện từng chữ.' },
    { tab: 'kaiwa', target: '#panel-kaiwa', title: 'Luyện nói Kaiwa', text: 'Chọn một tình huống, nghe lời thoại rồi nói hoặc viết câu trả lời của em.' },
    { tab: 'quiz', target: '#panel-quiz', title: 'Luyện thi', text: 'Làm bài theo cấp độ, xem giải thích và quay lại những câu còn yếu.' },
    { tab: 'mastery', target: '#panel-mastery', title: 'Tiến độ', text: 'Khu vực này tóm tắt mức thành thạo và những chỗ cần ưu tiên ôn.' },
    { tab: 'settings', target: '#panel-settings', title: 'Cài đặt', text: 'Kết nối AI, tài khoản và dữ liệu học nằm ở đây. Xong rồi, mình vào học thôi.' }
  ];

  let overlay, spotlight, card, mascot, title, text, count, back, next, skip, activeIndex = 0, lastFocus, resizeTimer;

  function build() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'app-guide-overlay';
    overlay.innerHTML = `
      <div class="guide-spotlight" aria-hidden="true"></div>
      <section class="guide-card" role="dialog" aria-modal="true" aria-labelledby="guide-title" aria-describedby="guide-text">
        <img src="assets/lam/pixel/south.png" width="68" height="124" alt="" class="guide-mascot">
        <div class="guide-copy">
          <div class="guide-count"></div>
          <h2 id="guide-title"></h2>
          <p id="guide-text"></p>
        </div>
        <div class="guide-actions">
          <button type="button" class="guide-skip">Bỏ qua</button>
          <span></span>
          <button type="button" class="guide-back">Trước</button>
          <button type="button" class="guide-next">Tiếp</button>
        </div>
      </section>`;
    document.body.append(overlay);
    spotlight = overlay.querySelector('.guide-spotlight');
    card = overlay.querySelector('.guide-card');
    mascot = overlay.querySelector('.guide-mascot');
    title = overlay.querySelector('#guide-title');
    text = overlay.querySelector('#guide-text');
    count = overlay.querySelector('.guide-count');
    back = overlay.querySelector('.guide-back');
    next = overlay.querySelector('.guide-next');
    skip = overlay.querySelector('.guide-skip');
    back.addEventListener('click', () => go(activeIndex - 1));
    next.addEventListener('click', () => go(activeIndex + 1));
    skip.addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', event => {
      if (!document.body.classList.contains('guide-active')) return;
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowRight') go(activeIndex + 1);
      if (event.key === 'ArrowLeft') go(activeIndex - 1);
    });
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => position(steps[activeIndex]), 80);
    }, { passive: true });
  }

  function targetFor(step) {
    return document.querySelector(step.target) || document.getElementById(`panel-${step.tab}`);
  }

  function position(step) {
    const target = targetFor(step);
    if (!target) return;
    target.scrollIntoView({ block: step.target === '#app-sidebar' ? 'nearest' : 'start', behavior: 'smooth' });
    setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const margin = 7;
      const x = Math.max(8, rect.left - margin);
      const y = Math.max(8, rect.top - margin);
      const width = Math.min(innerWidth - 16, rect.width + margin * 2);
      const height = Math.min(innerHeight - 16, rect.height + margin * 2);
      Object.assign(spotlight.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });

      const cardWidth = Math.min(430, innerWidth - 24);
      card.style.width = `${cardWidth}px`;
      let left = rect.right + 18;
      if (left + cardWidth > innerWidth - 12) left = Math.min(innerWidth - cardWidth - 12, Math.max(12, rect.left + rect.width / 2 - cardWidth / 2));
      let top = rect.top + Math.min(90, Math.max(0, rect.height / 3));
      if (top + card.offsetHeight > innerHeight - 18) top = Math.max(12, rect.bottom - card.offsetHeight - 10);
      if (innerWidth < 740) {
        left = 12;
        top = Math.max(82, Math.min(innerHeight - card.offsetHeight - 88, rect.bottom + 12));
        if (rect.bottom + card.offsetHeight + 100 > innerHeight) top = 12;
      }
      card.style.left = `${Math.max(12, Math.min(innerWidth - cardWidth - 12, left))}px`;
      card.style.top = `${Math.max(12, Math.min(innerHeight - card.offsetHeight - 12, top))}px`;
    }, 180);
  }

  async function go(index) {
    if (index < 0) return;
    if (index >= steps.length) { close(); return; }
    activeIndex = index;
    const step = steps[index];
    document.body.classList.remove('guide-step-in');
    const mobileTour = matchMedia('(max-width: 739px)').matches;
    const sidebar = document.getElementById('app-sidebar');
    if (index === 0 && mobileTour && sidebar && !sidebar.classList.contains('open')) document.getElementById('btn-mobile-sidebar')?.click();
    if (index > 0) globalThis.closeAppSidebar?.();
    switchTab(step.tab);
    await new Promise(resolve => setTimeout(resolve, 300));
    title.textContent = step.title;
    text.textContent = step.text;
    count.textContent = `${index + 1} / ${steps.length}`;
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? 'Xong' : 'Tiếp';
    position(step);
    requestAnimationFrame(() => document.body.classList.add('guide-step-in'));
    next.focus({ preventScroll: true });
  }

  function open() {
    build();
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.body.classList.add('guide-active');
    globalThis.closeTeacherQuery?.();
    go(0);
    window.SakugaUI?.impact?.(card);
  }

  function close() {
    if (!overlay) return;
    document.body.classList.remove('guide-active', 'guide-step-in');
    globalThis.closeAppSidebar?.();
    overlay.hidden = true;
    (lastFocus || button).focus?.({ preventScroll: true });
  }

  button.addEventListener('click', open);
  window.VJBotGuide = { open, close };
})();
