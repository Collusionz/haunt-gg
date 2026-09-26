/* fx2.js — "advanced feel" layer: Lenis smooth scroll, magnetic buttons,
   hover tilt. Loaded in <head> (defer) after Lenis CDN. Everything uses
   permanent listeners / <html>-level layers so soft navigations (which only
   swap body content) never destroy it. */
(function () {
  'use strict';
  if (window.__fx2Loaded) return;
  window.__fx2Loaded = true;

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function perm(t, type, fn, opt) {
    if (window.__navPermEventListener) return window.__navPermEventListener(t, type, fn, opt);
    return t.addEventListener(type, fn, opt);
  }

  var root = document.documentElement;

  /* ================= LENIS SMOOTH SCROLL ================= */
  var lenis = null;
  if (!reduced && typeof window.Lenis === 'function') {
    try {
      lenis = new window.Lenis({
        duration: 1.1,
        easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
        smoothWheel: true,
        touchMultiplier: 1.5
      });
      // Permanent RAF driving loop. requestAnimationFrame is not tracked by
      // nav.js cleanup, so this survives soft navigations untouched.
      function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
      }
      requestAnimationFrame(raf);
    } catch (e) { lenis = null; }
  }

  /* ================= MAGNETIC BUTTONS ================= */
  // Explicit: data-magnet="25" -> pull strength toward cursor (default 18).
  // Auto: nav links, .social-icon, and .btn / [data-gb-post] get the default.
  var MAGNET_AUTO = 'nav a, .social-icon, .btn, [data-gb-post], [data-gb-more], #usernameText';
  var magnets = [];
  function collectMagnets() {
    magnets = [];
    // explicit
    var els = root.querySelectorAll('[data-magnet]');
    for (var i = 0; i < els.length; i++) {
      var s = parseFloat(els[i].getAttribute('data-magnet')) || 18;
      if (isNaN(s) || s <= 0) s = 18;
      magnets.push({ el: els[i], str: s });
    }
    // auto (only if not already explicit and not a touch surface)
    var auto = root.querySelectorAll(MAGNET_AUTO);
    for (var j = 0; j < auto.length; j++) {
      var a = auto[j];
      if (a.hasAttribute('data-magnet')) continue;
      if (a.closest('[data-magnet]')) continue;
      // skip big grid sections so nav +/- cards don't all magnet
      var cls = a.className || '';
      magnets.push({ el: a, str: 16 });
    }
  }

  function magnetApply(m, mx, my) {
    var r = m.el.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var dx = mx - cx;
    var dy = my - cy;
    var max = Math.max(m.str, 1);
    m.el.style.transform = 'translate(' + (dx / max).toFixed(1) + 'px,' + (dy / max).toFixed(1) + 'px)';
  }
  function magnetReset(m) {
    m.el.style.transform = '';
  }

  if (!reduced && ('ontouchstart' in window) === false) {
    // Track hover state per element via pointerover/out; on pointermove update
    // only the currently-hovered magnet (cheap, no per-element getBoundingRect
    // scanning every frame).
    var hoveredMagnet = null;
    perm(document, 'pointerover', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var el = t.closest('[data-magnet]');
      if (el) hoveredMagnet = { el: el, str: parseFloat(el.getAttribute('data-magnet')) || 18 };
    });
    perm(document, 'pointerout', function (e) {
      if (!hoveredMagnet) return;
      var t = e.target;
      if (t && t.closest && t.closest('[data-magnet]') === hoveredMagnet.el) {
        magnetReset(hoveredMagnet);
        hoveredMagnet = null;
      }
    });
    perm(document, 'pointermove', function (e) {
      if (hoveredMagnet) magnetApply(hoveredMagnet, e.clientX, e.clientY);
    }, { passive: true });
  }

  /* ================= HOVER TILT ================= */
  // data-tilt="14" -> max tilt degrees (default 8). Only on fine pointers.
  // Auto: card-like surfaces (.widget-card, #profileCard, grid cards) get a
  // gentle tilt without needing hand-placed attributes.
  var TILT_AUTO = '.widget-card:not([data-fx-reveal]), #profileCard, #discordCard, #lastfmWidget, [data-tilt]:not([data-fx-reveal])';
  var tilts = [];
  function collectTilts() {
    tilts = [];
    var els = root.querySelectorAll(TILT_AUTO);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.hasAttribute('data-tilt-noauto')) continue;
      if (el.hasAttribute('data-fx-reveal')) continue;
      var d = parseFloat(el.getAttribute('data-tilt'));
      if (isNaN(d) || d <= 0) d = 8;
      try { el.style.willChange = 'transform'; } catch (e) {}
      tilts.push({ el: el, deg: d });
    }
  }

  function tiltStart(t, mx, my) {
    var r = t.el.getBoundingClientRect();
    var px = (mx - r.left) / r.width;   // 0..1
    var py = (my - r.top) / r.height;
    var rx = (py - 0.5) * -2 * t.deg;   // rotateX
    var ry = (px - 0.5) * 2 * t.deg;    // rotateY
    t.el.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) scale(1.02)';
  }
  function tiltEnd(t) {
    t.el.style.transform = '';
  }

  var activeTilt = null;
  if (!reduced && ('ontouchstart' in window) === false) {
    perm(document, 'pointerover', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var el = t.closest('[data-tilt]');
      if (!el) return;
      for (var i = 0; i < tilts.length; i++) if (tilts[i].el === el) { activeTilt = tilts[i]; break; }
    });
    perm(document, 'pointerout', function (e) {
      var t = e.target;
      if (activeTilt && t && t.closest && t.closest('[data-tilt]') === activeTilt.el) { tiltEnd(activeTilt); activeTilt = null; }
    });
    perm(document, 'pointermove', function (e) {
      if (activeTilt) tiltStart(activeTilt, e.clientX, e.clientY);
    }, { passive: true });
  }

  /* ================= FRESH SCAN AFTER SOFT NAV ================= */
  // Soft navigations swap body content, so re-collect magnetic/tilt targets.
  var pending = false;
  function rescan() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      collectMagnets();
      collectTilts();
    });
  }
  collectMagnets();
  collectTilts();
  if (typeof MutationObserver === 'function') {
    new MutationObserver(rescan).observe(document.body, { childList: true, subtree: true });
  }
})();
