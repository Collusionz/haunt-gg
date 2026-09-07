/* fx.js — site-wide ambience: cursor glow, scroll parallax + reveal.
   Loaded in <head> (defer) so it can register permanent listeners through
   nav.js. All fixed layers live on <html>, not <body>, so soft navigations
   (which only swap body content) never destroy them.
   Respects prefers-reduced-motion. */
(function () {
  'use strict';
  if (window.__fxLoaded) return;
  window.__fxLoaded = true;

  var root = document.documentElement;
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function perm(t, type, fn) {
    if (window.__navPermEventListener) return window.__navPermEventListener(t, type, fn);
    return t.addEventListener(type, fn);
  }

  /* ---------- tiny on-demand style sheet (survives swaps: lives in head) ---------- */
  var css =
    '#fxGlow{position:fixed;top:0;left:0;width:360px;height:360px;border-radius:50%;pointer-events:none;z-index:45;' +
    'mix-blend-mode:screen;background:radial-gradient(circle,rgba(85,115,244,0.22) 0%,rgba(71,100,236,0.10) 40%,transparent 72%);' +
    'transform:translate(-50%,-50%);transition:transform .3s ease,opacity .3s ease;will-change:left,top}' +
    '#fxGlow.fx-hot{transform:translate(-50%,-50%) scale(1.7)}' +
    'main.nav-enter{animation:navEnter .5s ease}@keyframes navEnter{from{opacity:0;transform:translateY(14px) scale(.995)}to{opacity:1;transform:none}}' +
    '@media(prefers-reduced-motion:reduce){main.nav-enter{animation:none}}';
  if (reduced) {
    css += '[data-fx-reveal]{opacity:1;transform:none}';
  } else {
    css +=
      '[data-fx-reveal]{opacity:0;transform:translate(var(--fx-x,0px),var(--fx-y,26px)) var(--fx-s,scale(1));transition:opacity .7s ease,transform .7s ease}' +
      '[data-fx-reveal].fx-in{opacity:1;transform:none}' +
      '@media(prefers-reduced-motion:reduce){[data-fx-reveal]{opacity:1;transform:none;transition:none}}';
  }
  var sheet = document.createElement('style');
  sheet.id = 'fxStyle';
  sheet.textContent = css;
  document.head.appendChild(sheet);

  /* ================= CURSOR GLOW ================= */
  var glow = document.createElement('div');
  glow.id = 'fxGlow';
  root.appendChild(glow);

  var gx = -200, gy = -200, tx = -200, ty = -200;
  var INTERACTIVE = 'a,button,[role="button"],input,textarea,select,label,[data-gb-post],[data-gb-more]';

  perm(window, 'pointermove', function (e) {
    tx = e.clientX;
    ty = e.clientY;
    var t = e.target;
    var hot = t && t.closest && t.closest(INTERACTIVE);
    if (hot) {
      glow.classList.add('fx-hot');
    } else {
      glow.classList.remove('fx-hot');
    }
  }, undefined);

  // Hide entirely for coarse pointers (touch).
  try {
    if (window.matchMedia('(pointer:coarse)').matches) glow.style.display = 'none';
  } catch (e) {}

  /* ================= SCROLL: PARALLAX + REVEAL ================= */
  // Directional reveal: data-fx-reveal="up|down|left|right|zoom"
  // Optional data-fx-delay="150" (ms). Wrap children in data-fx-stagger to
  // auto-stagger them by index.
  var DIR = {
    up:    [0,   '26px'],
    down:  [0,   '-26px'],
    left:  ['26px',  0],
    right: ['-26px', 0],
    zoom:  ['0px', '0px']
  };
  function applyRevealStyles(el) {
    try {
      var dir = (el.getAttribute('data-fx-reveal') || 'up').toLowerCase();
      var d = DIR[dir] || DIR.up;
      var zoom = (dir === 'zoom') ? 'scale(0.92)' : 'scale(1)';
      el.style.setProperty('--fx-x', d[0]);
      el.style.setProperty('--fx-y', d[1]);
      el.style.setProperty('--fx-s', zoom);
      var del = parseFloat(el.getAttribute('data-fx-delay')) || 0;
      if (del) el.style.transitionDelay = del + 'ms';
    } catch (e) {}
  }
  function applyStagger(container) {
    var kids = container.children;
    var base = parseFloat(container.getAttribute('data-fx-stagger')) || 60;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (!k.hasAttribute('data-fx-reveal')) continue;
      try { k.style.transitionDelay = (i * base) + 'ms'; } catch (e) {}
    }
  }
  var parallaxEls = [];
  var revealObs = null;
  function collectFx() {
    parallaxEls = [];
    var pl = root.querySelectorAll('[data-fx-parallax]');
    for (var i = 0; i < pl.length; i++) {
      parallaxEls.push({
        el: pl[i],
        sp: parseFloat(pl[i].getAttribute('data-fx-parallax')) || 0.25
      });
    }
    // stagger containers first so child delays attach before observers run
    var st = root.querySelectorAll('[data-fx-stagger]');
    for (var s = 0; s < st.length; s++) applyStagger(st[s]);
    if (reduced) return;
    if (!('IntersectionObserver' in window)) return;
    if (!revealObs) {
      revealObs = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            entries[i].target.classList.add('fx-in');
            revealObs.unobserve(entries[i].target);
          }
        }
      }, { threshold: 0.1 });
    }
    var rv = root.querySelectorAll('[data-fx-reveal]');
    for (var j = 0; j < rv.length; j++) {
      applyRevealStyles(rv[j]);
      revealObs.observe(rv[j]);
    }
  }
  collectFx();

  // After a soft navigation the freshly swapped body brings new fx elements;
  // rescan shortly after any body mutation (rAF-debounced, so nav.js's visit
  // cleanup can never leave a stale timeout behind).
  var observer = null;
  var rescanned = false;
  function scheduleRescan() {
    if (rescanned) return;
    rescanned = true;
    requestAnimationFrame(function () {
      rescanned = false;
      collectFx();
    });
  }
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(scheduleRescan);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ================= MASTER FRAME LOOP ================= */
  if (!reduced) {
    var last = performance.now();
    (function frame(now) {
      var dt = Math.min(64, now - last);
      last = now;
      var s = dt / 16.667;

      // -- glow easing
      gx += (tx - gx) * 0.18 * s;
      gy += (ty - gy) * 0.18 * s;
      if (gx > -100) { glow.style.left = gx + 'px'; glow.style.top = gy + 'px'; }

      // -- parallax
      var py = window.scrollY;
      for (var k = 0; k < parallaxEls.length; k++) {
        parallaxEls[k].el.style.transform = 'translateY(' + (py * -parallaxEls[k].sp) + 'px)';
      }

      requestAnimationFrame(frame);
    })(last);
  } else {
    // Reduced motion: reveal everything, keep effect layers inert.
    var rvAll = root.querySelectorAll('[data-fx-reveal]');
    for (var ri = 0; ri < rvAll.length; ri++) rvAll[ri].classList.add('fx-in');
  }
})();