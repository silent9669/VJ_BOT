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
  }));
  document.getElementById('speech-stop').addEventListener('click', () => stopSpeech());
  // Main content remains visible on first paint; only the mascot and panels have entrances.
  document.getElementById('popover-open-chat').addEventListener('click', () => {
    globalThis.closeTeacherQuery?.();
    switchTab('classroom'); loadChatHistory();
  });
})();
