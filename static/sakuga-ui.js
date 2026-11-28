/* Progressive Sakuga VFX wiring for VJBot's native controls.
   The controls stay real buttons/inputs; only their feedback is animated. */
(function () {
  'use strict';
  const fx = window.SakugaFX;
  if (!fx || !document.body) return;

  const entries = new Set();
  let running = false;
  let lastTime = 0;

  const primaryRe = /(?:^|\s)(public-cta|sketch-btn-cta|practice-primary|btn-stage-primary|chat-send-btn|kaiwa-eval-btn|modal-practice-btn|popover-send-btn|plan-continue|production-save|simulation-start)(?:\s|$)/;
  const quietRe = /(?:^|\s)(sidebar-nav-item|mobile-bottom-item|skill-tab-btn|fc-lvl-btn|quiz-lvl-btn|prompt-chip|quick-chip-btn|welcome-chip-btn|card-audio-btn|popover-tts-btn|modal-close-btn|picker-close-btn|reading-chip|kanji-audio-btn|kaiwa-audio-btn|chat-audio-btn|ai-quiet-button|feature-back|sketch-icon-btn|cb-item|curriculum-lesson-card|plan-step|admin-user-row|kanji-set|kaiwa-scenario-card|fc-nav-btn|srs-btn|quiz-option-btn|topbar-summon-btn|level-chip|study-teacher-button|bookmark-review-btn|revise-btn|modal-tts-btn|modal-close-action|lam-walker|lam-float-main|lam-float-toggle)(?:\s|$)/;
  const quietScope = '.settings-nav,.curriculum-view-switch,.lesson-mode-switch,.segmented,.auth-tabs,.learning-breadcrumb,.chat-header-actions,.chat-mode-switch,.live-controls,.fc-nav-btns,.fc-srs-btns,.exam-catalog-nav,.popover-actions-row,.picker-header';
  const silentSelector = '.admin-danger,.delete-account-btn,#ai-remove,#ai-oauth-disconnect,#btn-delete-account,#admin-purge,#btn-clear-chat-history';

  const isSilent = (el) => el.matches?.(silentSelector) || !!el.closest?.('[data-sakuga-off]');
  const kindOf = (el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (el.id === 'btn-quiz-next') return 'quiet';
    if (el.id === 'speech-test') return 'normal';
    if (primaryRe.test(cls)) return 'primary';
    if (quietRe.test(cls) || el.closest?.(quietScope)) return 'quiet';
    return 'normal';
  };

  function enhance(el) {
    if (!(el instanceof HTMLButtonElement) || el.dataset.sakugaReady || isSilent(el)) return;
    el.dataset.sakugaReady = 'true';
    const kind = kindOf(el);
    const entry = {
      el,
      kind,
      squash: new fx.Spring(1, 520, 16),
      pop: new fx.Spring(1, 300, 13),
      tilt: new fx.Spring(0, 260, 11)
    };
    const press = () => {
      if (el.disabled) return;
      entry.squash.to = kind === 'primary' ? 0.66 : kind === 'quiet' ? 0.88 : 0.78;
      start();
    };
    const release = () => {
      if (entry.squash.to !== 1) {
        entry.squash.to = 1;
        start();
      }
    };
    el.addEventListener('pointerdown', press);
    for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) el.addEventListener(type, release);
    el.classList.add('sakuga-native');
    entries.add(entry);
  }

  function scan(root = document) {
    if (root instanceof HTMLButtonElement) enhance(root);
    root.querySelectorAll?.('button').forEach(enhance);
  }

  function frame(time) {
    if (!running) return;
    const dt = fx.clamp((time - lastTime) / 1000, 0, 0.034);
    lastTime = time;
    let active = false;
    for (const entry of entries) {
      const el = entry.el;
      if (!el.isConnected) {
        el.classList.remove('sakuga-native');
        delete el.dataset.sakugaReady;
        entries.delete(entry);
        continue;
      }
      const y = entry.squash.step(dt);
      const p = entry.pop.step(dt);
      const r = entry.tilt.step(dt);
      const still = Math.abs(y - 1) < 0.002 && Math.abs(entry.squash.v) < 0.01 &&
        Math.abs(p - 1) < 0.002 && Math.abs(entry.pop.v) < 0.01 &&
        Math.abs(r) < 0.02 && Math.abs(entry.tilt.v) < 0.02;
      if (still) {
        el.style.scale = '';
        el.style.rotate = '';
      } else {
        const wide = entry.kind === 'primary' ? 0.32 : 0.18;
        const x = (1 + (1 - y) * wide) * p;
        el.style.scale = `${x.toFixed(4)} ${(y * p).toFixed(4)}`;
        el.style.rotate = `${r.toFixed(3)}deg`;
        active = true;
      }
    }
    if (active) requestAnimationFrame(frame);
    else running = false;
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);
  }

  function hitFrame(el) {
    if (fx.calm) return;
    el.classList.add('sakuga-hit-frame');
    setTimeout(() => el.classList.remove('sakuga-hit-frame'), 190);
  }

  function impact(el) {
    const c = fx.at(el);
    hitFrame(el);
    const entry = [...entries].find((item) => item.el === el);
    if (entry) {
      entry.pop.x = 1.16;
      entry.tilt.x = -3.5;
      start();
    }
    fx.burst(c.x, c.y, { r: 78, spikes: 15, life: 0.42 });
    fx.shards(c.x, c.y, { n: 8, speed: 220, size: 7, life: 0.8, arc: 6.28, grav: 300 });
    fx.sfx('don', c.x + 8, c.y - 76, { size: 138, rot: -0.11, life: 0.88 });
    for (const [dx, dy] of [[-1, -0.4], [1, -0.8], [-1, 0.8], [1, 0.8]]) {
      fx.puff(c.x + dx * (c.w / 2 + 5), c.y + dy * 20, { size: fx.rnd(9, 13), n: 4, vx: dx * 38, vy: dy * 24 - 5, life: 0.7 });
    }
  }

  function smallHit(el, quiet) {
    const c = fx.at(el);
    fx.ticks(c.x, c.y - c.h / 2 - 5, { dir: -Math.PI / 2, n: quiet ? 2 : 3, r: 4, len: quiet ? 10 : 15, fan: 0.45, life: 0.38 });
    if (quiet) {
      fx.lines(c.x, c.y, { n: 3, dir: 0, len: 18, spread: 11, life: 0.3 });
      if (el.matches('.sidebar-nav-item,.mobile-bottom-item')) fx.sfx('shu', c.x + 12, c.y - 34, { size: 58, rot: -0.08, life: 0.48, ...fx.hollow() });
    } else {
      fx.puff(c.x - c.w / 2, c.y + 4, { size: 8, n: 3, vx: -22, vy: -12, life: 0.45 });
      fx.puff(c.x + c.w / 2, c.y + 4, { size: 8, n: 3, vx: 22, vy: -12, life: 0.45 });
      fx.sfx('pon', c.x + c.w / 2 + 16, c.y - 24, { size: 52, rot: 0.08, life: 0.45, ...fx.hollow() });
    }
  }


  function sparkle(el, count = 4) {
    const c = fx.at(el);
    for (let i = 0; i < count; i++) {
      fx.kira(c.x + fx.rnd(-0.42, 0.42) * c.w, c.y + fx.rnd(-0.42, 0.42) * c.h, { r: fx.rnd(7, 12), life: fx.rnd(0.45, 0.7) });
    }
  }

  function celebrate(el) {
    const c = fx.at(el);
    fx.donut(c.x - c.w * 0.35, c.y - c.h * 0.35, { r: 18, vx: -18, vy: -44, life: 0.75 });
    fx.donut(c.x + c.w * 0.35, c.y - c.h * 0.25, { r: 15, vx: 20, vy: -38, life: 0.7, tilt: 0.2 });
    sparkle(el, 7);
  }

  document.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const el = event.target.closest?.('button');
    if (!el || el.disabled || isSilent(el)) return;
    const kind = kindOf(el);
    if (kind === 'primary') impact(el);
    else smallHit(el, kind === 'quiet');
  }, true);

  const typedAt = new WeakMap();
  document.addEventListener('input', (event) => {
    if (!event.isTrusted) return;
    const el = event.target;
    const isText = el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLInputElement && /^(text|search|email|password|url|tel)$/.test(el.type));
    if (!isText || isSilent(el)) return;
    const now = performance.now();
    if ((typedAt.get(el) || 0) + 115 > now) return;
    typedAt.set(el, now);
    const c = fx.at(el, 0.92, 0.18);
    fx.puff(c.x, c.y, { size: 6, n: 3, vx: 16, vy: -18, life: 0.36 });
  }, true);


  document.addEventListener('change', (event) => {
    if (!event.isTrusted) return;
    const el = event.target;
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLSelectElement)) return;
    if (isSilent(el)) return;
    const c = fx.at(el);
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      fx.slash(c.x, c.y, { len: 36, ang: -0.4, thick: 7, life: 0.42 });
      fx.sfx('zuza', c.x + 34, c.y - 28, { size: 58, rot: -0.1, life: 0.5, ...fx.dotted() });
    } else if (el instanceof HTMLInputElement && el.type === 'radio') {
      fx.ring(c.x, c.y, { rx: 24, ry: 8, w: 4, life: 0.36 });
      fx.sfx('pon', c.x + 30, c.y - 24, { size: 48, rot: 0.08, life: 0.42, ...fx.hollow() });
    } else if (el instanceof HTMLInputElement && el.type === 'range') {
      fx.lines(c.x, c.y, { n: 5, dir: 0, len: 24, spread: 16, life: 0.38 });
      fx.sfx('shu', c.x + 28, c.y - 34, { size: 58, rot: -0.08, life: 0.45, ...fx.hollow() });
    } else {
      fx.ticks(c.x + c.w / 2, c.y, { dir: 0, n: 3, r: 5, len: 13, fan: 0.4, life: 0.34 });
      fx.sfx('kachi', c.x + 28, c.y - 30, { size: 52, rot: -0.08, life: 0.42, ...fx.hollow() });
    }
  }, true);

  document.addEventListener('toggle', (event) => {
    const el = event.target;
    if (!(el instanceof HTMLDetailsElement) || !el.open || isSilent(el)) return;
    const c = fx.at(el, 0.08, 0.2);
    fx.puff(c.x, c.y, { size: 8, n: 3, vx: -18, vy: -12, life: 0.38 });
    fx.slash(c.x + 24, c.y + 8, { len: 24, ang: 0.4, thick: 5, life: 0.34 });
  }, true);


  document.addEventListener('invalid', (event) => {
    const el = event.target;
    if (!(el instanceof HTMLElement) || isSilent(el)) return;
    const c = fx.at(el, 0.5, 0);
    fx.wob(c.x - c.w * 0.38, c.y - 4, { dir: 1, r: 11, life: 0.42 });
    fx.wob(c.x + c.w * 0.38, c.y - 4, { dir: -1, r: 11, life: 0.42 });
  }, true);

  window.addEventListener('completion-changed', () => {
    const el = document.querySelector('.completion-control button:not([hidden]),.completion-control');
    if (el) sparkle(el, 5);
  });

  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === 1) scan(node);
    }
  }).observe(document.body, { childList: true, subtree: true });

  scan();
  window.SakugaUI = { refresh: scan, impact, sparkle, celebrate };
})();
