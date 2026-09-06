(function () {
  'use strict';
  var OLD_VIDEO = '/audio/bg.mp4#t=0.001';
  var OTHER_VIDEO = '/audio/background.mp4#t=0.001';

  var vaultBg = null;
  try { vaultBg = localStorage.getItem('vaultBg') || null; } catch (e) {}

  var mode = 'old';
  try {
    if (localStorage.getItem('bgMode') === 'other') mode = 'other';
  } catch (e) {}

  var BASE = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;pointer-events:none';

  function srcFor(m) { return vaultBg || (m === 'other' ? OTHER_VIDEO : OLD_VIDEO); }
  function otherOf(m) { return m === 'other' ? 'old' : 'other'; }

  function findExisting() {
    var el;
    el = document.getElementById('bgVideo'); if (el) return el;
    el = document.getElementById('bg-video'); if (el) return el;
    el = document.querySelector('video.bg-video'); if (el) return el;
    el = document.querySelector('.pointer-events-none.fixed.inset-0 video'); if (el) return el;
    return null;
  }

  function setSrc(v, s) {
    var kids = v.querySelectorAll('source');
    for (var i = 0; i < kids.length; i++) kids[i].remove();
    if (v.getAttribute('src') !== s) { v.src = s; v.load(); }
  }

  function shape(v) { v.loop = true; v.muted = true; v.playsInline = true; v.autoplay = true; }

  var vis = findExisting();
  if (!vis) {
    vis = document.createElement('video');
    vis.id = 'bgVideo';
    document.body.insertBefore(vis, document.body.firstChild);
  }
  vis.setAttribute('style', BASE + ';opacity:0.6');
  shape(vis);

  var hid = document.createElement('video');
  hid.setAttribute('style', BASE + ';opacity:0');
  shape(hid);
  vis.parentNode.insertBefore(hid, vis);

  // Both stream from the start so a toggle is instant (no re-buffer, no black flash).
  setSrc(vis, srcFor(mode));
  setSrc(hid, srcFor(otherOf(mode)));
  vis.play().catch(function () {});
  hid.play().catch(function () {});

  function toggle() {
    mode = otherOf(mode);
    try { localStorage.setItem('bgMode', mode); } catch (e) {}
    var t = vis;
    vis = hid;
    hid = t;
    vis.style.opacity = '0.6';
    hid.style.opacity = '0';
    setSrc(hid, srcFor(otherOf(mode)));
    vis.play().catch(function () {});
    hid.play().catch(function () {});
    paint();
  }

  var btn = null;
  function paint() {
    if (!btn) return;
    if (mode === 'other') {
      btn.innerHTML = '&#9664;';
      btn.title = 'switch to default background';
    } else {
      btn.innerHTML = '&#9654;';
      btn.title = 'switch to animated background';
    }
    btn.setAttribute('aria-label', btn.title);
  }

  function addToggle() {
    btn = document.getElementById('bgToggle');
    btn = document.createElement('button');
    btn.id = 'bgToggle';
    btn.setAttribute('style',
      'position:fixed;right:18px;bottom:18px;z-index:60;width:40px;height:40px;border-radius:50%;' +
      'border:1px solid rgba(255,255,255,0.18);background:rgba(20,22,35,0.55);backdrop-filter:blur(8px);' +
      'color:#ccd8ec;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
      'transition:transform 0.2s,color 0.2s;box-shadow:0 2px 12px rgba(0,0,0,0.35)');
    btn.addEventListener('click', toggle);
    btn.addEventListener('mouseenter', function () { btn.style.transform = 'scale(1.08)'; });
    btn.addEventListener('mouseleave', function () { btn.style.transform = 'scale(1)'; });
    document.body.appendChild(btn);
    paint();
  }

  addToggle();
})();