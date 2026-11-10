// Pixel thầy Lâm: strolls along the page, reacts on hover, opens the ask popover on click and can be dragged
// anywhere. Reduced motion: no strolling, he stays put (hover, click and drag still work).
(function () {
  const BASE = 'assets/lam/pixel/', SIZE = 72, FLOOR = 14, SPEED = 38;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)'), narrow = matchMedia('(max-width: 899px)');
  const frames = {south: BASE + 'south.png', east: BASE + 'east.png', west: BASE + 'west.png', idle: [0, 1, 2, 3].map(i => `${BASE}idle/${i}.png`)};
  [frames.south, frames.east, frames.west, ...frames.idle].forEach(src => { new Image().src = src; });

  const el = document.createElement('div');
  el.id = 'lam-walker';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'Hỏi thầy Lâm');
  el.innerHTML = '<span class="lam-speech" role="status" hidden></span><img alt="" draggable="false" width="' + SIZE + '" height="' + SIZE + '">';
  const sprite = el.querySelector('img'), speech = el.querySelector('.lam-speech');
  document.body.append(el);

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('vjbot_lam') || '{}'); } catch { /* storage unavailable */ }
  const state = {x: Math.random() * Math.max(0, innerWidth - SIZE), bottom: Number.isFinite(saved.bottom) ? saved.bottom : FLOOR, mode: 'idle', dir: 1, target: null, until: performance.now() + 1500, frame: 0, frameAt: 0, speechTimer: 0};
  const limits = () => ({maxX: Math.max(0, innerWidth - SIZE - 8), maxBottom: Math.max(FLOOR, innerHeight - SIZE - 8)});
  const clamp = () => { const l = limits(); state.x = Math.min(Math.max(8, state.x), l.maxX); state.bottom = Math.min(Math.max(FLOOR, state.bottom), l.maxBottom); };
  const popoverOpen = () => { const p = document.getElementById('sensei-floating-popover'); return p && !p.hidden; };
  const visible = () => document.body.dataset.page !== 'landing' && document.body.dataset.page !== undefined;

  const show = src => { if (sprite.getAttribute('src') !== src) sprite.setAttribute('src', src); };
  function say(text, ms = 2800) {
    speech.textContent = text;
    speech.hidden = false;
    clearTimeout(state.speechTimer);
    state.speechTimer = setTimeout(() => { speech.hidden = true; }, ms);
  }
  function greeting() {
    const screen = globalThis.teacherScreen?.();
    if (screen?.title) return `Em đang xem “${screen.title.slice(0, 40)}”? Hỏi thầy nhé!`;
    return ['Thầy đây! Hỏi gì nào?', 'Cần thầy giúp không?', 'Cứ hỏi đi, thầy chờ em.'][Math.floor(Math.random() * 3)];
  }
  function set(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    el.dataset.mode = mode;
  }
  function pickTarget() {
    const {maxX} = limits();
    let to = 8 + Math.random() * (maxX - 8);
    if (Math.abs(to - state.x) < 160) to = state.x < maxX / 2 ? Math.min(maxX, state.x + 260) : Math.max(8, state.x - 260);
    state.target = to;
    state.dir = to > state.x ? 1 : -1;
    set('walk');
  }

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    el.hidden = !visible();
    if (!el.hidden) {
      const frozen = state.mode === 'hover' || state.mode === 'drag' || popoverOpen() || document.hidden;
      if (state.mode === 'walk' && !frozen) {
        state.x += state.dir * SPEED * dt;
        if ((state.dir > 0 && state.x >= state.target) || (state.dir < 0 && state.x <= state.target)) { set('idle'); state.until = now + 3000 + Math.random() * 5000; }
      } else if (state.mode === 'idle' && !frozen && !reduce.matches && !narrow.matches && now >= state.until) {
        pickTarget();
      }
      if (state.mode === 'walk' && !frozen) show(state.dir > 0 ? frames.east : frames.west);
      else if (state.mode === 'drag') show(frames.south);
      else if (now - state.frameAt > 280) { state.frameAt = now; state.frame = (state.frame + 1) % 4; show(state.mode === 'hover' || state.mode === 'idle' ? frames.idle[state.frame] : frames.south); }
      clamp();
      // Narrow screens: CSS parks him bottom-right above the bottom bar; he does not stroll or move.
      el.style.transform = narrow.matches ? 'none' : `translate3d(${state.x}px, ${-(state.bottom - FLOOR)}px, 0)`;
    }
    requestAnimationFrame(tick);
  }

  // Pointer: a short press is a click, moving past 6px is a drag.
  let press = null;
  el.addEventListener('pointerdown', event => {
    press = {x: event.clientX, y: event.clientY, startX: state.x, startBottom: state.bottom, moved: false};
    el.setPointerCapture(event.pointerId);
  });
  el.addEventListener('pointermove', event => {
    if (!press) return;
    if (!press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) { press.moved = true; set('drag'); speech.hidden = true; }
    if (press.moved && !narrow.matches) {
      state.x = press.startX + event.clientX - press.x;
      state.bottom = press.startBottom - (event.clientY - press.y);
      clamp();
    }
  });
  el.addEventListener('pointerup', () => {
    if (!press) return;
    const dragged = press.moved;
    press = null;
    if (dragged) {
      try { localStorage.setItem('vjbot_lam', JSON.stringify({bottom: state.bottom})); } catch { /* storage unavailable */ }
      set('idle');
      state.until = performance.now() + 4000;
    } else {
      document.getElementById('btn-topbar-summon')?.click();
    }
  });
  el.addEventListener('pointercancel', () => { press = null; if (state.mode === 'drag') set('idle'); });
  el.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse' && state.mode !== 'drag') { set('hover'); say(greeting(), 4000); } });
  el.addEventListener('pointerleave', () => { if (state.mode === 'hover') { set('idle'); state.until = performance.now() + 1500; } });
  el.addEventListener('dblclick', () => { state.bottom = FLOOR; try { localStorage.removeItem('vjbot_lam'); } catch { /* storage unavailable */ } say('Thầy về chỗ cũ nhé.'); });
  el.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); document.getElementById('btn-topbar-summon')?.click(); } });
  el.addEventListener('focus', () => say(greeting(), 3000));
  addEventListener('resize', clamp);

  requestAnimationFrame(tick);
})();
