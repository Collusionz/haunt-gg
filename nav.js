/* nav.js — soft (SPA-style) navigation loader.
   Loaded synchronously in <head> so it patches listener/timer tracking before
   any page script runs. On an internal link click it fetches the target page,
   swaps the whole <body> (plus per-page <style> and the tailwind.config), and
   re-runs the page's scripts in isolated scopes so the audio player keeps
   playing uninterrupted. Falls back to a hard navigation whenever anything
   looks wrong. */
(function () {
  'use strict';
  if (window.__navLoaded) return;
  window.__navLoaded = true;

  /* ---------- per-visit listener / timer tracking ---------- */
  var visit = 1;          // visit token; tag 0 = permanent (never cleaned)
  var listeners = [];     // {v,t,type,fn,cap}
  var intervals = [];     // {v,id}
  var timeouts = [];      // {v,id}

  var origAdd = EventTarget.prototype.addEventListener;
  var origRem = EventTarget.prototype.removeEventListener;
  var origSi = window.setInterval;
  var origCi = window.clearInterval;
  var origSt = window.setTimeout;
  var origCt = window.clearTimeout;

  EventTarget.prototype.addEventListener = function (type, fn, opt) {
    var cap = typeof opt === 'boolean' ? opt : (opt && opt.capture) || false;
    listeners.push({ v: visit, t: this, type: type, fn: fn, cap: cap });
    return origAdd.call(this, type, fn, opt);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opt) {
    var cap = typeof opt === 'boolean' ? opt : (opt && opt.capture) || false;
    for (var i = listeners.length - 1; i >= 0; i--) {
      var l = listeners[i];
      if (l.t === this && l.type === type && l.fn === fn && l.cap === cap) { listeners.splice(i, 1); break; }
    }
    return origRem.call(this, type, fn, opt);
  };
  window.setInterval = function (fn, ms) {
    var id = origSi(fn, ms);
    intervals.push({ v: visit, id: id });
    return id;
  };
  window.clearInterval = function (id) {
    for (var i = intervals.length - 1; i >= 0; i--) { if (intervals[i].id === id) { intervals.splice(i, 1); break; } }
    return origCi(id);
  };
  window.setTimeout = function (fn, ms) {
    var id = origSt(fn, ms);
    timeouts.push({ v: visit, id: id });
    return id;
  };
  window.clearTimeout = function (id) {
    for (var i = timeouts.length - 1; i >= 0; i--) { if (timeouts[i].id === id) { timeouts.splice(i, 1); break; } }
    return origCt(id);
  };

  // Permanent listeners (player.js save hooks, guestbook delegation) survive swaps.
  window.__navPermEventListener = function (t, type, fn, opt) {
    var cap = typeof opt === 'boolean' ? opt : (opt && opt.capture) || false;
    listeners.push({ v: 0, t: t, type: type, fn: fn, cap: cap });
    return origAdd.call(t, type, fn, opt);
  };

  /* ---------- visit lifecycle ---------- */
  function cleanupOld() {
    var old = visit;
    for (var i = listeners.length - 1; i >= 0; i--) {
      var l = listeners[i];
      if (l.v !== 0 && l.v === old) {
        try { origRem.call(l.t, l.type, l.fn, l.cap); } catch (e) {}
        listeners.splice(i, 1);
      }
    }
    for (var j = intervals.length - 1; j >= 0; j--) {
      if (intervals[j].v !== 0 && intervals[j].v === old) { try { origCi(intervals[j].id); } catch (e) {} intervals.splice(j, 1); }
    }
    for (var k = timeouts.length - 1; k >= 0; k--) {
      if (timeouts[k].v !== 0 && timeouts[k].v === old) { try { origCt(timeouts[k].id); } catch (e) {} timeouts.splice(k, 1); }
    }
  }
  function beginVisit() { cleanupOld(); visit++; }

  /* ---------- page mount ---------- */
  function runInline(code) {
    try { new Function(code).call(window); }
    catch (e) { if (window.console && console.error) console.error('nav.js script error:', e); }
  }
  function runCfg(code) {
    var old = document.getElementById('navCfgScript');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var s = document.createElement('script');
    s.id = 'navCfgScript';
    s.textContent = code;
    document.head.appendChild(s);
  }

  function mount(doc, y) {
    beginVisit();

    // tailwind.config must be in place before the new DOM enters so classes
    // like `font-satoshi` resolve correctly.
    var headScripts = doc.querySelectorAll('head script');
    var cfgCode = null;
    for (var i = 0; i < headScripts.length; i++) {
      if (!headScripts[i].src && /tailwind\s*\.\s*config\s*=/.test(headScripts[i].textContent || '')) { cfgCode = headScripts[i].textContent; break; }
    }
    if (cfgCode) runCfg(cfgCode);

    // per-page css
    var fetchedStyle = doc.querySelector('style');
    var liveStyle = document.getElementById('navPageStyle');
    if (!liveStyle) {
      liveStyle = document.createElement('style');
      liveStyle.id = 'navPageStyle';
      document.head.appendChild(liveStyle);
    }
    liveStyle.textContent = fetchedStyle ? fetchedStyle.textContent : '';

    // title + body classes
    document.title = doc.title || document.title;
    document.body.className = doc.body.className || '';

    // preserve guestbook overlay + toast across the body swap
    var gbOv = document.querySelector('[data-gb-overlay]');
    var gbToast = document.getElementById('gbToast');
    if (gbOv) gbOv.parentNode.removeChild(gbOv);
    if (gbToast && gbToast.parentNode) gbToast.parentNode.removeChild(gbToast);

    document.body.innerHTML = doc.body.innerHTML;

    if (gbToast) document.body.appendChild(gbToast);
    if (gbOv) document.body.appendChild(gbOv);

    // re-run fetched scripts in document order: inline scripts get isolated
    // scopes (fresh let/const every visit); src scripts reload as normal tags.
    var fetched = doc.querySelectorAll('body script');
    for (var j = 0; j < fetched.length; j++) {
      var s = fetched[j];
      if (s.src) {
        var cl = document.createElement('script');
        cl.src = s.src;
        document.body.appendChild(cl);
      } else if (s.textContent) {
        runInline(s.textContent);
      }
    }

    // re-attach guestbook boards / refresh (idempotent, survives swaps)
    if (typeof window.guestbookBootstrap === 'function') {
      try { window.guestbookBootstrap(); } catch (e) {}
    }

    window.scrollTo(0, y || 0);
  }

  /* ---------- navigation ---------- */
  var pending = 0;
  function go(path, push) {
    var token = ++pending;
    fetch(path, { headers: { Accept: 'text/html' }, credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.text(); })
      .then(function (html) {
        if (token !== pending) return;
        var doc;
        try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { throw e; }
        if (!doc || !doc.querySelector('main')) throw new Error('no main');
        if (push) history.pushState({ path: path, y: window.scrollY || 0 }, '', path);
        var sy = push ? 0 : ((history.state && history.state.y) || 0);
        mount(doc, sy);
      })
      .catch(function () {
        if (token !== pending) return;
        location.assign(path);
      });
  }

  /* ---------- interception ---------- */
  function shouldRoute(a) {
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return false;
    var url;
    try { url = new URL(href, location.href); } catch (e) { return false; }
    if (url.origin !== location.origin) return false;
    return true;
  }

  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}

  window.__navPermEventListener(document, 'click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !shouldRoute(a)) return;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (url.pathname + url.search === location.pathname) {
      e.preventDefault();
      window.scrollTo(0, 0);
      return;
    }
    e.preventDefault();
    go(url.pathname + url.search, true);
  });

  window.__navPermEventListener(window, 'popstate', function () {
    var p = location.pathname + location.search;
    if (pending) pending++;
    fetch(p, { headers: { Accept: 'text/html' }, credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.text(); })
      .then(function (html) {
        var doc;
        try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { throw e; }
        if (!doc || !doc.querySelector('main')) throw new Error('no main');
        mount(doc, (history.state && history.state.y) || 0);
      })
      .catch(function () { location.reload(); });
  });
})();