/* Site-wide music player — no visible UI. One song keeps playing across all
   pages via soft navigation (nav.js). A fresh Audio element is only created on
   a real page load (window.__hz is missing); soft navigations reuse the same
   element so audio never restarts. Per-visit hooks are re-registered on every
   run so nav.js's visit cleanup stays correct.
   Enter overlay appears on the first direct (hard) load of any page when the
   visitor arrives from outside the site — so direct links like /gallery gate
   behind it too. Soft navigation never re-shows it. */
(function () {
  'use strict';

  var TRACKS = [
    { src: '/audio/song-1.mp3', title: 'untitled', artist: 'song 1' },
    { src: '/audio/song-2.mp3', title: 'untitled', artist: 'song 2' },
    { src: '/audio/mystery-of-love.mp3', title: 'Mystery of Love', artist: 'Sufjan Stevens' },
    { src: '/audio/you-are-the-sun.mp3', title: 'You Are the Sun in My Life' }
  ];

  var core = window.__hz;
  var first = !core;

  if (first) {
    core = window.__hz = {};

    // Enter overlay shows on the first real (hard) page load of any page when
    // arriving from outside the site — home or any direct link like /gallery.
    // Soft navigation must never show it again, so it is decided once here and
    // never rebuilt on soft visits.
    var fromSite = false;
    try { fromSite = new URL(document.referrer).origin === location.origin; } catch (e) {}
    core.showEnter = !fromSite;

    core.entered = false;
    try { core.entered = sessionStorage.getItem('hzUnlocked') === '1'; } catch (e) {}

    core.order = TRACKS.map(function (_, i) { return i; });
    (function shuffle(a) {
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
    })(core.order);

    core.cur = -1;
    core.resumeT = 0;
    var resume = null;
    try { resume = JSON.parse(sessionStorage.getItem('hzPlayer') || 'null'); } catch (e) {}
    if (resume && typeof resume.i === 'number' && resume.i >= 0 && resume.i < TRACKS.length) {
      core.cur = resume.i;
      if (typeof resume.t === 'number' && resume.t > 0) core.resumeT = resume.t;
    }

    var audio = new Audio();
    audio.preload = 'auto';
    audio.loop = false;
    try {
      var v = parseFloat(localStorage.getItem('hzVol'));
      if (isFinite(v) && v >= 0 && v <= 1) audio.volume = v;
    } catch (e) {}
    core.audio = audio;

    core.markUnlocked = function () {
      core.entered = true;
      try { sessionStorage.setItem('hzUnlocked', '1'); } catch (e) {}
    };

    core.save = function () {
      try { sessionStorage.setItem('hzPlayer', JSON.stringify({ i: core.cur, t: Math.floor(core.audio.currentTime || 0) })); } catch (e) {}
    };

    core.next = function () {
      if (core.order.length < 2) return;
      if (core.cur < 0) core.cur = core.order[0];
      var n = core.order[Math.floor(Math.random() * core.order.length)];
      while (n === core.cur) n = core.order[Math.floor(Math.random() * core.order.length)];
      core.cur = n;
      var t = TRACKS[n];
      audio.src = t.src;
      audio.load();
      audio.play().catch(function () {});
    };

    core.unlockSound = function () {
      core.audio.muted = false;
      core.audio.play().then(function () {}).catch(function () {});
    };

    // First real user gesture on a page lets audio unmute when autoplay was blocked.
    core.kick = function () {
      if (!core.audio.muted) return;
      var go = function () {
        core.audio.muted = false;
        core.audio.play().then(function () {}).catch(function () {});
        core.markUnlocked();
        ['pointerdown', 'keydown', 'touchstart'].forEach(function (t) {
          document.removeEventListener(t, go, { passive: true });
        });
      };
      ['pointerdown', 'keydown', 'touchstart'].forEach(function (t) {
        document.addEventListener(t, go, { passive: true });
      });
    };

    core.startAuto = function () {
      if (core.entered) {
        audio.muted = false;
        audio.play().then(function () {}).catch(function () {
          // Audible autoplay blocked on this page — fall back to muted + kick.
          audio.muted = true;
          audio.play().catch(function () {});
          core.kick();
        });
      } else {
        audio.muted = true;
        audio.play().catch(function () {});
        core.kick();
      }
    };

    core.buildEnter = function () {
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
        core.markUnlocked();
        core.unlockSound();
      }
      ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(function (t) {
        o.addEventListener(t, go, { passive: true });
      });
    };

    core.enterMuted = function () {
      core.audio.muted = true;
      core.audio.play().then(function () {}).catch(function () {});
      core.buildEnter();
    };

    function startHere() {
      if (core.showEnter) {
        core.enterMuted();
        return;
      }
      core.startAuto();
    }

    function loadFresh() {
      if (core.cur < 0) core.cur = core.order[0];
      audio.src = TRACKS[core.cur].src;
      audio.load();
      startHere();
    }

    // Resume mid-track unless we're near the end of it.
    if (core.cur >= 0 && core.resumeT > 0) {
      var rt = TRACKS[core.cur];
      var cl = new Audio();
      cl.preload = 'metadata';
      cl.addEventListener('loadedmetadata', function () {
        if (core.resumeT < cl.duration - 5) {
          audio.src = rt.src;
          audio.load();
          audio.currentTime = core.resumeT;
          startHere();
        } else {
          loadFresh();
        }
      });
      cl.src = rt.src;
    } else {
      loadFresh();
    }
  }

  /* ---------- per-visit hooks (nav.js cleans before each swap, this runs
  again after every soft mount so they stay registered and unique) ---------- */
  var audio = core.audio;

  audio.addEventListener('ended', core.next);
  audio.addEventListener('timeupdate', core.save);
  audio.addEventListener('volumechange', function () {
    try { localStorage.setItem('hzVol', audio.volume); } catch (e) {}
  });
  window.addEventListener('pagehide', core.save);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') core.save();
  });
  setInterval(core.save, 2000);

  // Soft re-run: audio element + track are already live, just keep it going.
  // The enter gate is never rebuilt — it only exists on the first hard load.
  if (!first) {
    core.startAuto();
  }
})();