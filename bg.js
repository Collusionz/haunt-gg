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

  /* ---- sleek dark/light background switcher ----
     mode 'old'   = dark background (default)  -> shows the sun (click = go light)
     mode 'other' = light background           -> shows the moon (click = go dark) */
  var btn = null;
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.2v2.4M12 19.4v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.2 12h2.4M19.4 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1z"/></svg>';

  function paint() {
    if (!btn) return;
    var light = (mode === 'other');
    btn.setAttribute('data-mode', light ? 'light' : 'dark');
    btn.title = light ? 'switch to dark background' : 'switch to light background';
    btn.setAttribute('aria-label', btn.title);
    if (btn.__setIcons) btn.__setIcons(light);
  }

  function addToggle() {
    if (document.getElementById('bgToggle')) { btn = document.getElementById('bgToggle'); paint(); return; }
    btn = document.createElement('button');
    btn.id = 'bgToggle';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', 'toggle background mode');
    btn.style.cssText =
      'position:fixed;right:18px;bottom:18px;z-index:60;width:44px;height:44px;border-radius:50%;' +
      'border:1px solid rgba(255,255,255,0.16);background:rgba(16,18,30,0.6);backdrop-filter:blur(12px);' +
      '-webkit-backdrop-filter:blur(12px);color:#e6ecf7;cursor:pointer;display:flex;align-items:center;' +
      'justify-content:center;overflow:hidden;' +
      'transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s ease;' +
      'box-shadow:0 4px 18px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.08);outline:none';
    var s1 = document.createElement('span');
    s1.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:opacity .35s ease,transform .5s cubic-bezier(.34,1.56,.64,1)';
    s1.innerHTML = SUN;
    var s2 = document.createElement('span');
    s2.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:opacity .35s ease,transform .5s cubic-bezier(.34,1.56,.64,1)';
    s2.innerHTML = MOON;
    btn.appendChild(s1);
    btn.appendChild(s2);
    btn.__setIcons = function (light) {
      s1.style.opacity = light ? '0' : '1';
      s1.style.transform = light ? 'rotate(-90deg) scale(0.6)' : 'rotate(0deg) scale(1)';
      s2.style.opacity = light ? '1' : '0';
      s2.style.transform = light ? 'rotate(0deg) scale(1)' : 'rotate(90deg) scale(0.6)';
    };
    btn.addEventListener('click', function (e) { e.preventDefault(); toggle(); });
    btn.addEventListener('mouseenter', function () { btn.style.transform = 'scale(1.08)'; btn.style.boxShadow = '0 6px 24px rgba(71,100,236,0.35),inset 0 1px 0 rgba(255,255,255,0.1)'; });
    btn.addEventListener('mouseleave', function () { btn.style.transform = 'scale(1)'; btn.style.boxShadow = '0 4px 18px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.08)'; });
    btn.addEventListener('focus', function () { btn.style.borderColor = 'rgba(85,115,244,0.7)'; });
    btn.addEventListener('blur', function () { btn.style.borderColor = 'rgba(255,255,255,0.16)'; });
    document.body.appendChild(btn);
    paint();
  }

  addToggle();
})();