(function () {
  'use strict';
  var OLD_VIDEO = '/audio/bg.mp4#t=0.001';
  var OTHER_VIDEO = '/audio/background.mp4#t=0.001';

  var vaultBg = null;
  try { vaultBg = localStorage.getItem('vaultBg') || null; } catch (e) {}

  var mode = 'old';
  try {
    var stored = localStorage.getItem('bgMode');
    if (stored === 'other') mode = 'other';
  } catch (e) {}

  var videoEl;

  function videoSrc() {
    if (vaultBg) return vaultBg;
    return mode === 'other' ? OTHER_VIDEO : OLD_VIDEO;
  }

  function baseStyle() {
    return 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;pointer-events:none';
  }

  function findBgVideo() {
    if (document.getElementById('bgVideo')) return document.getElementById('bgVideo');
    if (document.getElementById('bg-video')) return document.getElementById('bg-video');
    var cls = document.querySelector('video.bg-video');
    if (cls) return cls;
    var wrap = document.querySelector('.pointer-events-none.fixed.inset-0 video');
    if (wrap) return wrap;
    return null;
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
    if (videoEl.getAttribute('src') !== videoSrc()) {
      videoEl.src = videoSrc();
      videoEl.load();
    }
    videoEl.style.zIndex = '-1';
    videoEl.style.opacity = '0.6';
    videoEl.play().catch(function () {});
  }

  function applyMode() {
    ensureVideo();
  }

  function addToggle() {
    var btn = document.getElementById('bgToggle');
    if (btn) return;
    btn = document.createElement('button');
    btn.id = 'bgToggle';
    btn.setAttribute('style',
      'position:fixed;right:18px;bottom:18px;z-index:60;width:40px;height:40px;border-radius:50%;' +
      'border:1px solid rgba(255,255,255,0.18);background:rgba(20,22,35,0.55);backdrop-filter:blur(8px);' +
      'color:#ccd8ec;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
      'transition:transform 0.2s,color 0.2s;box-shadow:0 2px 12px rgba(0,0,0,0.35)');
    function paint() {
      if (mode === 'other') {
        btn.innerHTML = '&#9664;';
        btn.title = 'switch to default background';
      } else {
        btn.innerHTML = '&#9654;';
        btn.title = 'switch to animated background';
      }
      btn.setAttribute('aria-label', btn.title);
    }
    btn.addEventListener('click', function () {
      mode = mode === 'other' ? 'old' : 'other';
      try { localStorage.setItem('bgMode', mode); } catch (e) {}
      applyMode();
      paint();
    });
    btn.addEventListener('mouseenter', function () { btn.style.transform = 'scale(1.08)'; });
    btn.addEventListener('mouseleave', function () { btn.style.transform = 'scale(1)'; });
    document.body.appendChild(btn);
    paint();
  }

  ensureVideo();
  addToggle();
})();