// What the learner is looking at, so thầy Lâm understands "cái này" / "câu này" wherever he is summoned.
// The visible text of the active learning screen is captured at send time; leaving a screen remembers it,
// so the chat tab (which hides the screen) still knows where the learner came from.
(function () {
  const HIDDEN = /^panel-(landing|classroom|admin|settings)$/;
  let last = null, lastAt = 0, shownHash = '';
  function capture(hash = location.hash) {
    const panel = document.querySelector('.tab-panel.active');
    if (!panel || HIDDEN.test(panel.id)) return null;
    const lesson = panel.id === 'panel-lesson' ? document.getElementById('modal-lesson-title')?.textContent : '';
    // Generated feedback and learner submissions must not be laundered back as screen reference.
    const visible = panel.id === 'panel-kaiwa'
      ? ['kaiwa-context', 'kaiwa-prompt-jp', 'kaiwa-prompt-vi'].map(id => document.getElementById(id)?.textContent || '').join('\n')
      : panel.innerText;
    const text = visible.replace(/[ \t]+/g, ' ').replace(/ ?\n[ \n]*/g, '\n').trim().slice(0, 3500);
    if (!text) return null;
    return {
      route: (hash || '#' + panel.id.slice(6)).slice(1, 200),
      title: (lesson || document.getElementById('topbar-view-title')?.textContent || '').trim().slice(0, 200),
      level: typeof activeCurriculumLevel === 'string' ? activeCurriculumLevel : '',
      text
    };
  }
  // The URL hash already points at the next screen while we leave, so use the hash recorded when this one was shown.
  globalThis.markTeacherScreen = () => { shownHash = location.hash; };
  globalThis.rememberTeacherScreen = () => { const screen = capture(shownHash || location.hash); if (screen) { last = screen; lastAt = Date.now(); } };
  globalThis.teacherScreen = () => capture() || (Date.now() - lastAt < 30 * 60000 ? last : null);
})();
