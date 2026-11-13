// Lâm is reachable on every screen. Drag or use the arrow keys; Home returns him to his corner.
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const base = 'assets/lam/pixel/display/';
  const button = document.createElement('button');
  button.id = 'lam-walker'; button.type = 'button';
  button.setAttribute('aria-label', 'Hỏi thầy Lâm');
  button.setAttribute('aria-controls', 'sensei-floating-popover');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<span class="lam-speech" hidden>Hỏi thầy về bài đang học nhé.</span><img src="'+base+'south.png" alt="" width="88" height="160" draggable="false"><span class="lam-label">Thầy Lâm <span aria-hidden="true">↗</span></span>';
  document.body.append(button);
  const sprite = button.querySelector('img'), speech = button.querySelector('.lam-speech');
  let x = 0, y = 0, press, dragged = false, frame = 0, lastPage = '', timer;
  const clamp = () => {
    const rect = button.getBoundingClientRect();
    x += Math.max(8 - rect.left, Math.min(0, innerWidth - 8 - rect.right));
    y += Math.max(8 - rect.top, Math.min(0, innerHeight - 76 - rect.bottom));
    button.style.transform = `translate(${x}px,${y}px)`;
  };
  function update() {
    const page = document.body.dataset.page;
    button.hidden = page === 'landing';
    button.setAttribute('aria-expanded', String(!document.getElementById('sensei-floating-popover').hidden));
    if (page !== lastPage) {
      lastPage = page; x = 0; y = 0; button.style.transform = '';
      if (!reduce.matches && !button.hidden) {
        button.getAnimations().forEach(animation => animation.cancel());
        button.animate([{opacity:0,translate:'0 24px'},{opacity:1,translate:'0 -6px',offset:.75},{opacity:1,translate:'0 0'}],{duration:400,easing:'cubic-bezier(.23,1,.32,1)'});
      }
    }
  }
  const observer = new MutationObserver(update);
  observer.observe(document.body, {attributes:true,attributeFilter:['data-page']});
  observer.observe(document.getElementById('sensei-floating-popover'), {attributes:true,attributeFilter:['hidden']});
  update();
  button.addEventListener('click', event => {
    if (dragged) { event.preventDefault(); dragged = false; return; }
    document.getElementById('btn-topbar-summon').click();
  });
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    press = {x:event.clientX,y:event.clientY,startX:x,startY:y}; dragged = false;
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', event => {
    if (!press) return;
    if (Math.hypot(event.clientX-press.x,event.clientY-press.y)>6) dragged = true;
    if (!dragged) return;
    x = press.startX + event.clientX-press.x; y = press.startY + event.clientY-press.y;
    button.style.transform = `translate(${x}px,${y}px)`; clamp();
  });
  button.addEventListener('pointerup', () => { press = null; });
  button.addEventListener('pointercancel', () => { press = null; dragged = false; });
  button.addEventListener('keydown', event => {
    if (event.key === 'Home') { event.preventDefault(); x = 0; y = 0; button.style.transform = ''; return; }
    const delta = {ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[event.key];
    if (delta) { event.preventDefault(); x += delta[0]; y += delta[1]; button.style.transform = `translate(${x}px,${y}px)`; clamp(); }
  });
  button.addEventListener('pointerenter', () => { speech.hidden = false; clearTimeout(timer); timer = setTimeout(() => speech.hidden = true,3000); });
  button.addEventListener('pointerleave', () => { speech.hidden = true; });
  button.addEventListener('focus', () => { speech.hidden = false; });
  button.addEventListener('blur', () => { speech.hidden = true; });
  const animateIdle = () => {
    if (!document.hidden && !button.hidden && !reduce.matches && !press) { frame = (frame+1)%4; sprite.src = `${base}idle/${frame}.png`; }
  };
  setInterval(animateIdle, 650);
  reduce.addEventListener('change', () => { if (reduce.matches) { button.getAnimations().forEach(a=>a.cancel()); sprite.src=base+'south.png'; } });
  addEventListener('resize', () => { x=0;y=0;button.style.transform=''; });
})();
