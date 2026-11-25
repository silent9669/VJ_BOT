(function () {
  document.querySelector('.skip-link').addEventListener('click', event => {
    event.preventDefault();
    document.getElementById('main-content').focus();
  });
  document.querySelectorAll('[data-demo-answer]').forEach(button => button.addEventListener('click', () => {
    const correct = button.dataset.demoAnswer === 'wa';
    document.querySelectorAll('[data-demo-answer]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
    const feedback = document.getElementById('demo-feedback');
    feedback.dataset.correct = String(correct);
    feedback.textContent = correct ? 'Đúng rồi! Trợ từ は đọc là「わ」. 私は学生です: Tôi là học sinh.' : 'Khi là trợ từ, は đọc là「わ」. Em chọn lại nhé.';
    if (correct) window.SakugaUI?.sparkle?.(feedback, 5);
  }));
  const landingPanel = document.getElementById('panel-landing');
  if (landingPanel) {
    const revealItems = landingPanel.querySelectorAll('[data-reveal]');
    if ('IntersectionObserver' in window && revealItems.length) {
      landingPanel.classList.add('reveal-ready');
      const revealObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
          }
        }
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
      revealItems.forEach(item => revealObserver.observe(item));
    }

    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const parallaxSections = [...landingPanel.querySelectorAll('[data-parallax-speed]')];
      let parallaxFrame = 0;
      const updateParallax = () => {
        parallaxFrame = 0;
        if (document.body.dataset.page !== 'landing') return;
        for (const section of parallaxSections) {
          const rect = section.getBoundingClientRect();
          if (rect.bottom < -80 || rect.top > innerHeight + 80) continue;
          const centerDelta = (rect.top + rect.height / 2 - innerHeight / 2) / Math.max(1, innerHeight);
          const shift = -centerDelta * Number(section.dataset.parallaxSpeed || 0) * 120;
          section.style.setProperty('--section-shift', `${shift.toFixed(1)}px`);
        }
      };
      const queueParallax = () => {
        if (!parallaxFrame) parallaxFrame = requestAnimationFrame(updateParallax);
      };
      addEventListener('scroll', queueParallax, { passive: true });
      addEventListener('resize', queueParallax, { passive: true });
      landingPanel.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch') return;
        const x = (event.clientX / innerWidth - 0.5) * 14;
        const y = (event.clientY / innerHeight - 0.5) * 10;
        landingPanel.style.setProperty('--pointer-x', `${x.toFixed(1)}px`);
        landingPanel.style.setProperty('--pointer-y', `${y.toFixed(1)}px`);
      }, { passive: true });
      queueParallax();
    }
  }

  document.getElementById('speech-stop').addEventListener('click', () => stopSpeech());
  // Main content remains visible on first paint; only the mascot and panels have entrances.
  document.getElementById('popover-open-chat').addEventListener('click', () => {
    globalThis.closeTeacherQuery?.();
    switchTab('classroom'); loadChatHistory();
  });
})();
