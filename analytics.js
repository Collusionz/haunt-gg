/* analytics.js — lightweight, privacy-minded visitor analytics.
   Logs one view per page load (deduped per tab, ~5 min) and external link /
   project clicks into Supabase (analytics_events) via Syn.logEvent. Country is
   resolved client-side through ipapi.co (best-effort, never blocks the view).
   The /vault Analytics section aggregates everything via Syn.queryStats. */
(function () {
  'use strict';
  if (window.__analyticsLoaded) return;
  window.__analyticsLoaded = true;

  function deviceType() {
    var ua = navigator.userAgent || '';
    if (/(ipad|tablet|playbook|silk)|(android(?!.*mobile))/i.test(ua)) return 'tablet';
    if (/mobi|iphone|ipod|android|opera mini|iemobile|blackberry/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  function fire(kind, extra, cb) {
    if (!window.Syn || !Syn.logEvent) { if (cb) cb(false); return; }
    Syn.logEvent(kind, {
      page: (extra && extra.page) || location.pathname,
      host: (extra && extra.host) || location.hostname,
      ref: (extra && extra.ref) || (document.referrer || '').slice(0, 180),
      device: deviceType(),
      country: (extra && extra.country) || '',
      target: (extra && extra.target) || ''
    }, cb);
  }

  var viewDone = false;
  function recordView(country) {
    if (viewDone) return;
    viewDone = true;
    var key = 'ana:' + location.pathname + ':' + Math.floor(Date.now() / 300000);
    var seen = false;
    try { seen = sessionStorage.getItem(key) === '1'; } catch (e) {}
    if (seen) return;
    try { sessionStorage.setItem(key, '1'); } catch (e) {}
    fire('view', { country: country || '' });
  }

  function viewWithGeo() {
    var timedOut = false;
    var t = window.setTimeout(function () { timedOut = true; recordView(''); }, 1200);
    try {
      fetch('https://ipapi.co/json/', { redirect: 'follow' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (timedOut) return;
          window.clearTimeout(t);
          recordView(j && j.country_code ? String(j.country_code).slice(0, 8) : '');
        })
        .catch(function () {
          if (!timedOut) { window.clearTimeout(t); recordView(''); }
        });
    } catch (e) {
      if (!timedOut) { window.clearTimeout(t); recordView(''); }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', viewWithGeo);
  else viewWithGeo();

  // Click tracking (permanent so it survives soft-navigation body swaps):
  // internal hrefs are page moves (already counted as views); external links
  // log a click with the card's data-ana name (links/projects) or link text.
  function onDocClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;
    var host = '';
    try { host = new URL(href, location.href).hostname; } catch (err) {}
    if (host === location.hostname) return;
    var target = a.getAttribute('data-ana');
    if (!target) {
      var box = a.closest('[data-ana]');
      target = box ? box.getAttribute('data-ana') : '';
    }
    if (!target) target = (a.textContent || href).trim().replace(/\s+/g, ' ').slice(0, 120) || href;
    fire('click', { target: target, ref: '' });
  }
  if (window.__navPermEventListener) window.__navPermEventListener(document, 'click', onDocClick, true);
  else document.addEventListener('click', onDocClick, true);
})();