(function () {
  'use strict';
  var DEFAULT_VIDEO = 'https://akryst.moe/videos/background.mp4#t=0.001';
  var vaultBg = null;
  try { vaultBg = localStorage.getItem('vaultBg') || null; } catch (e) {}
  var mode = 'video';
  try { mode = localStorage.getItem('bgMode') || 'video'; } catch (e) {}
  if (mode !== 'video') mode = 'stars';

  var videoSrc = vaultBg || DEFAULT_VIDEO;

  function findBgVideo() {
    if (document.getElementById('bgVideo')) return document.getElementById('bgVideo');
    if (document.getElementById('bg-video')) return document.getElementById('bg-video');
    var cls = document.querySelector('video.bg-video');
    if (cls) return cls;
    var wrap = document.querySelector('.pointer-events-none.fixed.inset-0 video');
    if (wrap) return wrap;
    return null;
  }

  var videoEl, canvas, ctx, W, H, stars = [];
  var layerCounts = [70, 50, 25];
  var speeds = [0.04, 0.12, 0.28];
  var sizes = [1, 1.6, 2.4];
  var alphas = [0.35, 0.6, 0.95];
  var parallax = [3, 8, 16];
  var mouse = { nx: 0, ny: 0 };

  function baseStyle() {
    return 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;pointer-events:none';
  }

  function ensureVideo() {
    videoEl = findBgVideo();
    if (!videoEl) {
      videoEl = document.createElement('video');
      videoEl.id = 'bgVideo';
      videoEl.setAttribute('style', baseStyle() + ';opacity:0.6');
      videoEl.loop = true; videoEl.muted = true; videoEl.playsInline = true; videoEl.autoplay = true;
      document.body.insertBefore(videoEl, document.body.firstChild);
    }
    videoEl.loop = true; videoEl.muted = true; videoEl.playsInline = true;
    var kids = videoEl.querySelectorAll('source');
    for (var i = 0; i < kids.length; i++) kids[i].remove();
    if (videoEl.getAttribute('src') !== videoSrc) {
      videoEl.src = videoSrc;
      videoEl.load();
    }
    videoEl.style.zIndex = '-1';
    videoEl.style.opacity = '0.6';
  }

  function ensureCanvas() {
    canvas = document.getElementById('bgCanvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'bgCanvas';
      canvas.setAttribute('style', baseStyle() + ';opacity:1');
      document.body.insertBefore(canvas, document.body.firstChild);
    }
    canvas.style.zIndex = '-1';
    ctx = canvas.getContext('2d');
    window.addEventListener('mousemove', function (e) {
      mouse.nx = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      mouse.ny = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    });
    resize();
    window.addEventListener('resize', function () { resize(); makeStars(); });
    makeStars();
    requestAnimationFrame(frame);
  }

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeStars() {
    stars = [];
    for (var l = 0; l < layerCounts.length; l++) {
      for (var i = 0; i < layerCounts[l]; i++) {
        stars.push({
          x: Math.random() * W,
          y: Math.random() * H,
          layer: l,
          r: sizes[l] * (0.5 + Math.random()),
          baseA: alphas[l] * (0.6 + Math.random() * 0.4),
          tw: Math.random() * Math.PI * 2,
          tws: 0.5 + Math.random() * 1.5
        });
      }
    }
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var px = mouse.nx * parallax[s.layer];
      var py = mouse.ny * parallax[s.layer];
      s.y -= speeds[s.layer];
      if (s.y < -4) { s.y = H + 4; s.x = Math.random() * W; }
      s.tw += s.tws * 0.016;
      var a = s.baseA * (0.7 + 0.3 * Math.sin(s.tw));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#cdd6ff';
      ctx.beginPath();
      ctx.arc(s.x + px, s.y + py, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }

  function applyMode() {
    if (videoEl) videoEl.style.display = mode === 'video' ? '' : 'none';
    if (canvas) canvas.style.display = mode === 'stars' ? '' : 'none';
    if (mode === 'video') videoEl.play().catch(function () {});
  }

  function addToggle() {
    var btn = document.getElementById('bgToggle');
    if (btn) return;
    btn = document.createElement('button');
    btn.id = 'bgToggle';
    btn.innerHTML = '✦';
    btn.title = mode === 'stars' ? 'switch to video background' : 'switch to starfield';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('style',
      'position:fixed;right:18px;bottom:18px;z-index:60;width:40px;height:40px;border-radius:50%;' +
      'border:1px solid rgba(255,255,255,0.18);background:rgba(20,22,35,0.55);backdrop-filter:blur(8px);' +
      'color:#ccd8ec;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
      'transition:transform 0.2s,color 0.2s;box-shadow:0 2px 12px rgba(0,0,0,0.35)');
    btn.addEventListener('click', function () {
      mode = mode === 'video' ? 'stars' : 'video';
      try { localStorage.setItem('bgMode', mode); } catch (e) {}
      applyMode();
      btn.innerHTML = mode === 'stars' ? '✦' : '▶';
      btn.title = mode === 'stars' ? 'switch to video background' : 'switch to starfield';
      btn.setAttribute('aria-label', btn.title);
    });
    btn.addEventListener('mouseenter', function () { btn.style.transform = 'scale(1.08)' });
    btn.addEventListener('mouseleave', function () { btn.style.transform = 'scale(1)' });
    document.body.appendChild(btn);
  }

  ensureVideo();
  ensureCanvas();
  applyMode();
  addToggle();
})();