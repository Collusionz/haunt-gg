(function () {
  'use strict';

  var HOME = location.pathname === '/' || location.pathname === '/index.html';
  if (!HOME) return;

  var TRACKS = [
    { src: '/audio/song-1.mp3', cover: '/audio/song-1-cover.jpg', title: 'untitled', artist: 'song 1' },
    { src: '/audio/song-2.mp3', cover: '/audio/song-2-cover.jpg', title: 'untitled', artist: 'song 2' },
    { src: '/audio/mystery-of-love.mp3', cover: '/assets/img/mystery-cover.jpg', title: 'Mystery of Love', artist: 'Sufjan Stevens' }
  ];

  var audio = new Audio();
  audio.preload = 'auto';
  audio.loop = false;
  try { var v = parseFloat(localStorage.getItem('hzVol')); if (isFinite(v) && v >= 0 && v <= 1) audio.volume = v; } catch (e) {}

  var order = TRACKS.map(function (_, i) { return i; });
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  shuffle(order);

  var cur = -1;
  var resume = null;
  try { resume = JSON.parse(sessionStorage.getItem('hzPlayer') || 'null'); } catch (e) {}
  if (resume && typeof resume.i === 'number' && resume.i >= 0 && resume.i < TRACKS.length) {
    cur = resume.i;
  }

  function buildChip() {
    if (document.getElementById('hzPlayer')) return null;
    var c = document.createElement('div');
    c.id = 'hzPlayer';
    c.setAttribute('role', 'region');
    c.setAttribute('aria-label', 'music player');
    c.style.cssText =
      'position:fixed;right:18px;bottom:70px;z-index:56;display:flex;align-items:center;gap:8px;' +
      'padding:6px 10px 6px 8px;border-radius:999px;background:rgba(20,22,35,0.62);' +
      'border:1px solid rgba(255,255,255,0.14);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);' +
      'box-shadow:0 2px 14px rgba(0,0,0,0.35);font-family:"Satoshi",sans-serif;color:#e8edff;user-select:none';
    c.innerHTML =
      '<div style="position:relative;width:30px;height:30px;flex-shrink:0">' +
      '<img id="hzCover" alt="" style="width:30px;height:30px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,255,255,0.14);display:block" />' +
      '<span id="hzSpin" style="position:absolute;inset:0;border-radius:50%;border:2px solid rgba(255,255,255,0.16);border-top-color:#5573f4;opacity:0;transition:opacity .3s"></span>' +
      '</div>' +
      '<button id="hzPlay" type="button" title="play music" aria-label="play music" style="width:28px;height:28px;border-radius:50%;border:0;background:linear-gradient(135deg,#5573f4,#4764ec);color:#fff;font-size:0.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .15s">' +
      '<span id="hzPlayIcon">&#9654;</span></button>' +
      '<span id="hzLabel" style="font-size:0.7rem;line-height:1.25;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">music off</span>' +
      '<button id="hzNext" type="button" title="next" aria-label="next song" style="background:none;border:0;color:rgba(255,255,255,0.6);font-size:0.85rem;cursor:pointer;line-height:1;padding:4px">&#9197;</button>';
    document.body.appendChild(c);

    document.getElementById('hzNext').addEventListener('click', function (ev) { ev.stopPropagation(); next(); });
    document.getElementById('hzPlay').addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggle();
    });
    return c;
  }

  var spinEl, labelEl, iconEl, playing = false;

  function nameOf(i) { var t = TRACKS[i]; return t.title; }

  function setSpin(on) { if (spinEl) spinEl.style.opacity = on ? '1' : '0'; }

  function updateLabel(text, hint) {
    if (!labelEl) return;
    if (text) {
      labelEl.title = text;
      labelEl.textContent = hint ? hint + ' · ' + text : text;
    } else {
      labelEl.title = '';
      labelEl.textContent = hint || 'music off';
    }
  }

  function refreshUI() {
    if (!iconEl) return;
    iconEl.innerHTML = playing ? '&#10073;&#10073;' : '&#9654;';
    var p = document.getElementById('hzPlay');
    if (p) p.title = playing ? 'pause' : 'play';
    var c = document.getElementById('hzCover');
    if (c && cur >= 0) c.src = TRACKS[cur].cover;
    setSpin(playing);
    updateLabel(cur >= 0 ? nameOf(cur) + ' · ' + TRACKS[cur].artist : '', playing ? null : (audio && audio.paused && audioReady() ? 'paused' : null));
  }

  function audioReady() { return cur >= 0; }

  function loadTrack(i) {
    if (i < 0) return;
    cur = i;
    var t = TRACKS[i];
    audio.src = t.src;
    audio.load();
    audio.play().then(onPlay).catch(function () {
      refreshUI();
      // keep state paused; a later gesture can resume via kick
    });
  }

  function play() {
    if (cur < 0) cur = order[0];
    loadTrack(cur);
  }

  function onPlay() {
    if (!playing) { playing = true; refreshUI(); }
  }

  function next() {
    if (order.length < 2) return;
    var n = order[Math.floor(Math.random() * order.length)];
    while (n === cur) n = order[Math.floor(Math.random() * order.length)];
    loadTrack(n);
  }

  function toggle() {
    if (playing) {
      audio.pause();
      playing = false;
      refreshUI();
      return;
    }
    if (cur < 0) { play(); return; }
    loadTrack(cur);
  }

  audio.addEventListener('playing', onPlay);
  audio.addEventListener('play', onPlay);
  audio.addEventListener('pause', function () { playing = false; refreshUI(); });
  audio.addEventListener('ended', next);
  audio.addEventListener('volumechange', function () { try { localStorage.setItem('hzVol', audio.volume); } catch (e) {} });

  function save() {
    try { sessionStorage.setItem('hzPlayer', JSON.stringify({ i: cur, t: Math.floor(audio.currentTime || 0) })); } catch (e) {}
  }
  setInterval(save, 2000);
  audio.addEventListener('timeupdate', save);
  if (typeof window.pagehide !== 'undefined') window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') save(); });

  function unlockSound() {
    audio.muted = false;
    audio.play().then(onPlay).catch(function () { refreshUI(); });
  }

  function buildEnter() {
    if (document.getElementById('hzEnter')) return;
    var o = document.createElement('div');
    o.id = 'hzEnter';
    o.setAttribute('role', 'button');
    o.setAttribute('aria-label', 'enter');
    o.style.cssText =
      'position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;cursor:pointer;' +
      'background:rgba(6,8,14,0.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);transition:opacity .5s ease;' +
      'color:#e8edff;font-family:"Satoshi",sans-serif;user-select:none;text-align:center';
    o.innerHTML =
      '<div style="font-size:3rem;font-weight:700;letter-spacing:0.18em;text-transform:lowercase;color:#f4f7f8;text-shadow:0 0 24px rgba(85,115,244,0.8)">enter</div>';
    document.body.appendChild(o);
    function go() {
      o.style.opacity = '0';
      setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 520);
      unlockSound();
    }
    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(function (t) {
      o.addEventListener(t, go, { passive: true });
    });
  }

  function enterMuted() {
    audio.muted = true;
    audio.play().then(onPlay).catch(function () { refreshUI(); });
    buildEnter();
  }

  function startAuto() {
    enterMuted();
  }

  function init() {
    buildChip();
    spinEl = document.getElementById('hzSpin');
    labelEl = document.getElementById('hzLabel');
    iconEl = document.getElementById('hzPlayIcon');
    var loadFresh = function () {
      if (cur < 0) cur = order[0];
      audio.src = TRACKS[cur].src;
      audio.load();
      refreshUI();
      startAuto();
    };
    if (resume && cur >= 0 && resume.t > 0) {
      try {
        var t = TRACKS[cur];
        var cl = new Audio();
        cl.preload = 'metadata';
        cl.addEventListener('loadedmetadata', function () {
          if (resume.t < cl.duration - 5) {
            audio.src = t.src;
            audio.load();
            audio.currentTime = resume.t;
            refreshUI();
            startAuto();
          } else {
            loadFresh();
          }
        });
        cl.src = t.src;
      } catch (e) {
        loadFresh();
      }
    } else {
      loadFresh();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();