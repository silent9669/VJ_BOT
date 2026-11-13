// Lâm stays in the navigation, clear of lesson controls and the composer.
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const base = 'assets/lam/pixel/display/';
  const button = document.createElement('button');
  button.id = 'lam-walker'; button.type = 'button';
  button.setAttribute('aria-label', 'Hỏi thầy Lâm');
  button.setAttribute('aria-controls', 'sensei-floating-popover');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<span class="lam-speech" hidden>Hỏi thầy về bài đang học nhé.</span><img src="'+base+'south.png" alt="" width="88" height="160" draggable="false"><span class="lam-label">Thầy Lâm <span aria-hidden="true">↗</span></span>';
  document.getElementById('sidebar-companion').append(button);
  const sprite = button.querySelector('img'), speech = button.querySelector('.lam-speech');
  let frame = 0, lastPage = '', timer;
  function update() {
    const page = document.body.dataset.page;
    button.hidden = page === 'landing';
    button.setAttribute('aria-expanded', String(!document.getElementById('sensei-floating-popover').hidden));
    if (page !== lastPage) {
      lastPage = page;
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
    globalThis.closeAppSidebar?.();
    document.getElementById('btn-topbar-summon').click();
  });
  button.addEventListener('pointerenter', () => { speech.hidden = false; clearTimeout(timer); timer = setTimeout(() => speech.hidden = true,3000); });
  button.addEventListener('pointerleave', () => { speech.hidden = true; });
  button.addEventListener('focus', () => { speech.hidden = false; });
  button.addEventListener('blur', () => { speech.hidden = true; });
  const animateIdle = () => {
    if (!document.hidden && button.getClientRects().length && !reduce.matches) { frame = (frame+1)%4; sprite.src = `${base}idle/${frame}.png`; }
  };
  setInterval(animateIdle, 650);
  reduce.addEventListener('change', () => { if (reduce.matches) { button.getAnimations().forEach(a=>a.cancel()); sprite.src=base+'south.png'; } });
})();
