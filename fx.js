/* fx.js — site-wide ambience: cursor glow, audio-reactive canvas, scroll
   parallax + reveal. Loaded in <head> (defer) so it can register permanent
   listeners through nav.js. All fixed layers live on <html>, not <body>, so
   soft navigations (which only swap body content) never destroy them.
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
    '#fxAudio{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:55;mix-blend-mode:screen}';
  if (reduced) {
    css += '[data-fx-reveal]{opacity:1;transform:none}';
  } else {
    css +=
      '[data-fx-reveal]{opacity:0;transform:translateY(26px);transition:opacity .7s ease,transform .7s ease}' +
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

  /* ================= AUDIO-REACTIVE CANVAS ================= */
  var canvas = document.createElement('canvas');
  canvas.id = 'fxAudio';
  root.appendChild(canvas);
  var ctx = canvas.getContext ? canvas.getContext('2d') : null;

  var W = 0, H = 0, DPR = 1;
  function resize() {
    W = root.clientWidth;
    H = root.clientHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(W * DPR));
    canvas.height = Math.max(1, Math.floor(H * DPR));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  perm(window, 'resize', resize);

  var particles = [];
  var PALETTE = ['#5573f4', '#4764ec', '#7aa2ff', '#9adcff', '#ffffff'];
  function spawnParticle(rand) {
    var p = {
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.5) * 14,
      r: 1 + Math.random() * 2.2,
      c: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      a: 0.08 + Math.random() * 0.16
    };
    if (rand) { p.vx *= 0.4; p.vy *= 0.4; }
    return p;
  }
  for (var pi = 0; pi < 56; pi++) particles.push(spawnParticle(true));

  var rings = [];
  var bassLvl = 0;
  var audioCtx = null, analyser = null, wired = false;
  function wireAudio() {
    if (wired) return true;
    var hz = window.__hz;
    var el = hz && hz.audio;
    if (!el) return false;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      var src = audioCtx.createMediaElementSource(el);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;
      src.connect(analyser);
      analyser.connect(audioCtx.destination);
      wired = true;
      canvas.setAttribute('data-wired', '1');
      return true;
    } catch (e) {
      return false;
    }
  }
  function kickAudio() {
    try { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {}
  }
  perm(window, 'pointerdown', function () { if (!wired) wired = wireAudio(); kickAudio(); });
  perm(window, 'keydown', function () { if (!wired) wired = wireAudio(); kickAudio(); });
  perm(window, 'touchstart', function () { if (!wired) wired = wireAudio(); kickAudio(); });

  var frame = new Uint8Array(64);
  function bands() {
    if (!analyser) return null;
    try { analyser.getByteFrequencyData(frame); } catch (e) { return null; }
    var bass = 0, mid = 0, high = 0, i;
    for (i = 0; i < 4; i++) bass += frame[i] / 16;   // /255 per bin *4 => avg
    for (i = 4; i < 16; i++) mid += frame[i] / 48;
    for (i = 16; i < 64; i++) high += frame[i] / 192;
    bass = Math.min(1, bass);
    mid = Math.min(1, mid);
    high = Math.min(1, high);
    return { bass: bass, mid: mid, high: high, all: bass * 0.6 + mid * 0.3 + high * 0.1 };
  }

  // No-op path we keep assigning to avoid undefined call on reduced motion.

  /* ================= SCROLL: PARALLAX + REVEAL ================= */
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
      }, { threshold: 0.12 });
    }
    var rv = root.querySelectorAll('[data-fx-reveal]');
    for (var j = 0; j < rv.length; j++) revealObs.observe(rv[j]);
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

  // Universal reveal map: some old elements may hover above threshold already
  // on load; catch first paint via the rAF below anyway.

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

      // -- audio analytics + canvas
      if (ctx) {
        var b = bands();
        var energy = b ? b.all : 0;
        ctx.clearRect(0, 0, W, H);
        var i, p;
        for (i = 0; i < particles.length; i++) {
          p = particles[i];
          var boost = 1 + energy * 4.2;
          p.vx += (Math.random() - 0.5) * 6 * s;
          p.vy += (Math.random() - 0.5) * 6 * s;
          var speed = Math.max(14, Math.abs(p.vx) + 6);
          var maxV = (18 + energy * 240) / speed;
          var damp = Math.pow(0.9, s);
          p.vx *= damp; p.vy *= damp;
          if (Math.abs(p.vx) > maxV * 9) p.vx = (p.vx > 0 ? 1 : -1) * maxV * 9;
          if (Math.abs(p.vy) > maxV * 9) p.vy = (p.vy > 0 ? 1 : -1) * maxV * 9;
          p.vx += (Math.random() - 0.5) * energy * 2.4 * s;
          p.vy += (Math.random() - 0.5) * energy * 2.4 * s;
          p.x += p.vx * boost * 0.35 * s;
          p.y += p.vy * boost * 0.35 * s;
          if (p.x < -10) p.x = W + 10;
          if (p.x > W + 10) p.x = -10;
          if (p.y < -10) p.y = H + 10;
          if (p.y > H + 10) p.y = -10;
          ctx.globalAlpha = p.a * (0.5 + energy * 0.5);
          ctx.fillStyle = p.c;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * (1 + energy * 1.1), 0, 6.2832);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        // beat rings
        var peak = b && b.bass > 0.62 && b.bass > bassLvl + 0.04;
        if (peak) {
          rings.push({ r: 6, a: 0.5, x: W * 0.5, y: H * 0.5 });
          if (rings.length > 6) rings.shift();
        }
        bassLvl = b ? b.bass : 0;
        for (i = rings.length - 1; i >= 0; i--) {
          var rg = rings[i];
          rg.r += 3.2 * s;
          rg.a -= 0.02 * s;
          if (rg.a <= 0) { rings.splice(i, 1); continue; }
          ctx.globalAlpha = rg.a * 0.4;
          ctx.strokeStyle = '#5573f4';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(rg.x, rg.y, rg.r, 0, 6.2832);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // subtle vignette pulse synchronized to energy
        ctx.globalAlpha = 0.05 + energy * 0.05;
        ctx.fillStyle = '#5573f4';
        ctx.fillRect(0, 0, W, 3 + energy * 4);
        ctx.globalAlpha = 1;
      }

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