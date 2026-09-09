/* tools.js — image compressor (client-side).
   Supports multi-file batch, target-size (KB/MB) auto-tune via binary-search
   over JPEG/WebP quality + progressive downscale, manual quality slider,
   max-dimension resize, PNG/JPEG/WebP output, per-file + batch downloads.
   Note: nav.js wipes the body on soft nav and re-runs this as a fresh script,
   so state lives in local closures for the current visit. */
(function () {
  'use strict';

  var state = {
    files: [],        // {item, blob, name, origSize, width, height, out:{blob,size,width,height}, status, done, error}
    mode: 'auto',     // 'auto' | 'manual'
    format: 'image/jpeg',
    busy: false
  };
  var idx = 0;        // for stable ids across concurrent runs

  var $ = function (id) { return document.getElementById(id); };
  var fmtExt = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };

  function dropExt(name, newext) {
    var base = String(name).replace(/\.[^.]+$/, '');
    return base + '.' + (newext || 'jpg');
  }
  function fmtBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function pct(a, b) { return b > 0 ? Math.round(((b - a) / b) * 100) : 0; }

  /* ---------- image loading ---------- */
  function loadBitmap(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('not an image')); };
      img.src = url;
    });
  }

  /* ---------- single-image compression ----------
     options: { format, quality (nullable), maxDim (nullable), targetBytes (nullable) } */
  function compressOne(img, w, h, opts) {
    function render(w2, h2, q, fmt) {
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w2));
      c.height = Math.max(1, Math.round(h2));
      var ctx = c.getContext('2d');
      if (fmt === 'image/jpeg' || fmt === 'image/webp') ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // preserve transparency only for png; jpeg/webp flatten to white
      return new Promise(function (resolve) {
        c.toBlob(function (b) { resolve(b); }, fmt, q);
      });
    }

    // apply max-dim resize
    if (opts.maxDim && opts.maxDim >= 16) {
      var max = Math.max(w, h);
      if (max > opts.maxDim) {
        var r = opts.maxDim / max;
        w = w * r; h = h * r;
      }
    }

    if (opts.quality != null) {
      return render(w, h, opts.quality, opts.format).then(function (b) {
        return { blob: b, width: Math.round(w), height: Math.round(h) };
      });
    }

    // auto target-size: binary search quality; if even 100% is too big, downscale
    var target = opts.targetBytes || Infinity;
    var lo = 5, hi = 100, best = null;

    function tryQ(q) {
      return render(w, h, q, opts.format).then(function (b) {
        return { blob: b, size: b.size };
      });
    }

    function binarySearch() {
      if (lo > hi) return Promise.resolve(best);
      var mid = Math.round((lo + hi) / 2);
      return tryQ(mid).then(function (r) {
        if (r.size <= target) { best = { blob: r.blob, size: r.size }; lo = mid + 1; }
        else { hi = mid - 1; }
        return binarySearch();
      });
    }

    function downscale() {
      // quality search gave nothing under target -> shrink and retry at 100%
      if (w < 16 || h < 16) {
        if (best) return Promise.resolve(resolveOut(best.blob));
        return render(w, h, 60, opts.format).then(resolveOut);
      }
      w = w * 0.85; h = h * 0.85;
      lo = 25; hi = 100; best = null;
      return binarySearch().then(function (r) {
        if (r && r.blob && r.size <= target) return resolveOut(r.blob);
        return downscale();
      });
    }

    function resolveOut(blob) {
      // recompute final dims for status (blob may be from a shrunk render)
      return { blob: blob, width: Math.round(w), height: Math.round(h) };
    }

    return binarySearch().then(function (r) {
      if (r && r.blob && r.size <= target) return resolveOut(r.blob);
      return downscale();
    });
  }

  /* ---------- queue handling ---------- */
  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList);
    files.forEach(function (f) {
      if (!f || f.type.indexOf('image') !== 0 && !/\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(f.name)) return;
      state.files.push({ id: 'f' + (idx++), blob: f, name: f.name, origSize: f.size, status: 'queued', done: false });
    });
    renderAll();
  }

  async function processAll() {
    if (state.busy) return;
    state.busy = true;
    setBusyUI(true);

    var targetUnit = parseInt($('sizeUnit').value, 10) || 1024;
    var targetNum = (parseFloat($('sizeNum').value) || 0) * targetUnit;

    for (var i = 0; i < state.files.length; i++) {
      var it = state.files[i];
      if (it.done) continue;
      it.status = 'processing';
      updateRow(it);
      try {
        var bm = await loadBitmap(it.blob);
        var opts = {
          format: state.format,
          maxDim: state.mode === 'auto' ? (parseFloat($('maxDim').value) || 0) : (parseFloat($('maxDim').value) || 0),
          targetBytes: state.mode === 'auto' ? targetNum : null,
          quality: state.mode === 'manual' ? parseInt($('quality').value, 10) : null
        };
        var out = await compressOne(bm.img, bm.img.naturalWidth, bm.img.naturalHeight, opts);
        URL.revokeObjectURL(bm.url);
        it.width = bm.img.naturalWidth; it.height = bm.img.naturalHeight;
        it.out = out;
        it.done = true; it.status = 'done'; it.error = null;
      } catch (e) {
        it.status = 'error'; it.error = 'failed to process';
      }
      updateRow(it);
      updateStats();
    }
    state.busy = false;
    setBusyUI(false);
    updateStats();
  }

  /* ---------- rendering ---------- */
  function makeThumb(it) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(it.blob);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  async function renderRow(it) {
    var list = $('resultList');
    var card = document.createElement('div');
    card.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px;border-radius:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07)';
    card.id = 'row-' + it.id;

    var thumb = document.createElement('div');
    thumb.style.cssText = 'width:52px;height:52px;border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.06);flex-shrink:0;display:flex;align-items:center;justify-content:center';
    card.appendChild(thumb);

    var meta = document.createElement('div');
    meta.style.cssText = 'flex:1;min-width:0';
    meta.innerHTML = '<div style="font-size:0.85rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(it.name) + '</div>'
      + '<div id="meta-' + it.id + '" style="font-size:0.72rem;color:#9CA3AF;margin-top:2px">' + fmtBytes(it.origSize) + ' → …</div>';
    card.appendChild(meta);

    var act = document.createElement('div');
    act.style.cssText = 'display:flex;gap:6px;align-items:center;flex-shrink:0';
    act.innerHTML =
      '<button data-dl style="padding:6px 12px;border-radius:9px;border:none;background:#5573f4;color:#fff;font-size:0.72rem;font-weight:600;cursor:pointer;font-family:inherit;display:none">Download</button>'
      + '<button data-x style="padding:6px 10px;border-radius:9px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#9CA3AF;font-size:0.72rem;cursor:pointer;font-family:inherit">✕</button>';
    card.appendChild(act);

    act.querySelector('[data-x]').addEventListener('click', function () {
      state.files = state.files.filter(function (x) { return x.id !== it.id; });
      if (card.parentNode) card.parentNode.removeChild(card);
      updateStats();
    });
    act.querySelector('[data-dl]').addEventListener('click', function () { downloadOne(it); });

    list.appendChild(card);

    var im = await makeThumb(it);
    if (im) { im.style.cssText = 'width:100%;height:100%;object-fit:cover'; thumb.appendChild(im); }
    else thumb.innerHTML = '<span style="font-size:0.6rem;opacity:0.4">img</span>';

    // store refs for fast update
    card.__meta = $('meta-' + it.id);
    card.__dl = act.querySelector('[data-dl]');
    card.__thumb = thumb;
    it.__card = card;
    updateRow(it);
  }

  async function renderAll() {
    var list = $('resultList');
    var pending = state.files.filter(function (f) { return !f.__card; });
    for (var i = 0; i < pending.length; i++) {
      await renderRow(pending[i]);
    }
    $('results').style.display = state.files.length ? 'block' : 'none';
    updateStats();
  }

  function updateRow(it) {
    var card = it.__card;
    if (!card) return;
    var meta = card.__meta;
    var dl = card.__dl;
    card.__thumb.style.opacity = it.status === 'processing' ? '0.5' : '1';
    if (it.status === 'processing') {
      meta.innerHTML = '<span style="color:#5573f4">compressing…</span>';
      if (dl) dl.style.display = 'none';
    } else if (it.status === 'error') {
      meta.innerHTML = '<span style="color:#ff4466">' + escapeHtml(it.error || 'error') + '</span>';
      if (dl) dl.style.display = 'none';
    } else if (it.done) {
      var red = pct(it.out.blob.size, it.origSize);
      var saved = it.out.blob.size < it.origSize;
      meta.innerHTML = fmtBytes(it.origSize) + ' → <span style="font-weight:600;color:' + (saved ? '#4ade80' : '#f0b232') + '">' + fmtBytes(it.out.blob.size) + '</span>'
        + ' <span style="opacity:0.55">(' + (saved ? '−' : '+') + Math.abs(red) + '%)</span>'
        + ' <span style="opacity:0.5">· ' + it.out.width + '×' + it.out.height + '</span>';
      if (dl) { dl.style.display = 'inline-block'; dl.disabled = false; }
    }
  }

  function updateStats() {
    var total = state.files.length;
    var done = 0, orig = 0, out = 0;
    state.files.forEach(function (f) { if (f.done) { done++; orig += f.origSize; out += f.out.blob.size; } });
    $('statTotal').textContent = total;
    $('statDone').textContent = done;
    var saved = orig > 0 ? Math.round(((orig - out) / orig) * 100) : 0;
    $('statSaved').textContent = 'saved ' + (saved > 0 ? '−' : '') + Math.abs(saved) + '%';
  }

  function setBusyUI(b) {
    var btns = document.querySelectorAll('#results button');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = b;
  }

  function downloadOne(it) {
    if (!it.done || !it.out) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(it.out.blob);
    a.download = dropExt(it.name, fmtExt[state.format]);
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
  }

  function downloadAll() {
    (function next(i) {
      if (i >= state.files.length) return;
      var it = state.files[i];
      if (it.done) {
        downloadOne(it);
        setTimeout(function () { next(i + 1); }, 220);
      } else next(i + 1);
    })(0);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- youtube downloader (savenow v2 via serverless proxy) ---------- */
  var YT_API = '/api/yt';
  var yt = { mode: 'audio', fmt: 'mp3', res: '360', kbps: 128, busy: false };
  var ytTimer = null;

  function ytId(url) {
    var m = String(url).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function ytSetState(msg, percent) {
    $('ytState').textContent = msg;
    if (percent != null) $('ytBar').style.width = percent + '%';
  }

  function ytSetInfo(d) {
    var title = d.title || (d.info && d.info.title) || 'YouTube download';
    $('ytTitle').textContent = title;
    var img = d.thumbnail_url || (d.info && d.info.image);
    if (img) {
      var t = $('ytThumb');
      t.src = img;
      t.style.display = 'block';
    }
  }

  function ytReady(dl, d) {
    $('ytBar').style.width = '100%';
    ytSetInfo(d);
    ytSetState(d && d.text === 'Finished' ? 'Finished — download ready' : 'Done — download ready');
    var a = $('ytDl');
    a.href = dl;
    a.style.display = 'inline-block';
    yt.busy = false;
    setYtBusy(false);
  }

  function ytPoll(progressUrl, attempts) {
    attempts = attempts || 0;
    clearTimeout(ytTimer);
    if (!progressUrl) { ytFail('No progress url returned'); return; }
    if (attempts > 90) {
      ytSetState('Timed out after ~3 min — try again');
      yt.busy = false;
      setYtBusy(false);
      return;
    }
    fetch(progressUrl, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      var dl = d && (d.download_url || d.url || d.downloadUrl || d.file_url || d.file || d.link);
      if (dl) { ytReady(dl, d); return; }
      var p = d && typeof d.progress === 'number' ? Math.min(Math.round(d.progress / 10), 95) : Math.min(2 + attempts * 2, 95);
      ytSetState(d && d.text || 'Processing…', p);
      ytTimer = setTimeout(function () { ytPoll(progressUrl, attempts + 1); }, 2000);
    }).catch(function () {
      ytTimer = setTimeout(function () { ytPoll(progressUrl, attempts + 1); }, 2000);
    });
  }

  function ytFail(msg) {
    ytSetState(msg);
    $('ytBar').style.width = '0%';
    yt.busy = false;
    setYtBusy(false);
  }

  async function ytConvert() {
    if (yt.busy) return;
    var url = $('ytUrl').value.trim();
    $('ytStatus').style.display = 'block';
    $('ytDl').style.display = 'none';
    $('ytThumb').style.display = 'none';
    $('ytBar').style.width = '0%';
    if (!ytId(url)) {
      ytSetState('Paste a valid YouTube link (watch, shorts or youtu.be)');
      return;
    }
    yt.busy = true;
    setYtBusy(true);
    var fmt = yt.mode === 'audio' ? yt.fmt : yt.res;
    var api = YT_API + '?url=' + encodeURIComponent(url) + '&format=' + fmt;
    if (yt.mode === 'audio') api += '&quality=' + yt.kbps;
    try {
      var resp = await fetch(api, { cache: 'no-store' });
      var d = await resp.json();
      if (!d || !d.success) { ytFail((d && (d.message || d.error)) || 'Download failed'); return; }
      ytSetInfo(d);
      var dl = d.download_url || d.url || d.downloadUrl || d.file_url || d.file || d.link;
      if (dl) { ytReady(dl, d); return; }
      if (d.progress_url) {
        var m = String(d.progress_url).match(/[?&]id=([^&]+)/);
        var proxied = m ? '/api/yt?id=' + decodeURIComponent(m[1]) : null;
        ytSetState(d.text || 'Preparing streaming download…', 4);
        ytPoll(proxied, 0);
      } else {
        ytFail((d && d.text) || 'No download url returned');
      }
    } catch (e) {
      ytFail('Network error — try again');
    }
  }

  function setYtBusy(b) {
    var btn = $('ytConvert');
    btn.disabled = b;
    $('ytUrl').disabled = b;
    btn.style.opacity = b ? '0.6' : '1';
    btn.style.cursor = b ? 'default' : 'pointer';
  }

  function wireYt() {
    $('ytConvert').addEventListener('click', ytConvert);
    $('ytUrl').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') ytConvert(); });
    $('ytKbps').addEventListener('input', function () {
      yt.kbps = parseInt(this.value, 10);
      $('ytKbpsVal').textContent = yt.kbps;
    });

    function setYtMode(m) {
      yt.mode = m;
      $('ytTypeAudio').classList.toggle('active', m === 'audio');
      $('ytTypeVideo').classList.toggle('active', m === 'video');
      $('ytAudioFields').style.display = m === 'audio' ? 'block' : 'none';
      $('ytVideoFields').style.display = m === 'video' ? 'block' : 'none';
    }
    $('ytTypeAudio').addEventListener('click', function () { setYtMode('audio'); });
    $('ytTypeVideo').addEventListener('click', function () { setYtMode('video'); });

    document.querySelectorAll('[data-ytfmt]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('[data-ytfmt]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        yt.fmt = b.getAttribute('data-ytfmt');
      });
    });
    document.querySelectorAll('[data-ytres]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('[data-ytres]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        yt.res = b.getAttribute('data-ytres');
      });
    });
  }

  /* ---------- events ---------- */
  /* ---------- discord timestamp generator ---------- */
  var DC_FLAGS = [
    { flag: 't', name: 'Short Time', opts: { hour: '2-digit', minute: '2-digit' } },
    { flag: 'T', name: 'Long Time', opts: { hour: '2-digit', minute: '2-digit', second: '2-digit' } },
    { flag: 'd', name: 'Short Date', opts: { day: '2-digit', month: '2-digit', year: 'numeric' } },
    { flag: 'D', name: 'Long Date', opts: { day: 'numeric', month: 'long', year: 'numeric' } },
    { flag: 'f', name: 'Short Date/Time', opts: { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' } },
    { flag: 'F', name: 'Long Date/Time', opts: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' } },
    { flag: 'R', name: 'Relative Time', rel: true }
  ];

  function dcPad(n) { return String(n).padStart(2, '0'); }

  function dcFmtTs(d) {
    var mn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return wd[d.getDay()] + ', ' + d.getDate() + ' ' + mn[d.getMonth()] + ' ' + d.getFullYear() + ' ' + dcPad(d.getHours()) + ':' + dcPad(d.getMinutes());
  }

  function dcToLocalInput(d) {
    return d.getFullYear() + '-' + dcPad(d.getMonth() + 1) + '-' + dcPad(d.getDate())
      + 'T' + dcPad(d.getHours()) + ':' + dcPad(d.getMinutes()) + ':' + dcPad(d.getSeconds());
  }

  function dcRelative(unix) {
    var diff = unix - Math.floor(Date.now() / 1000);
    var abs = Math.abs(diff);
    var units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']];
    var v = 0, unit = 'second';
    for (var i = 0; i < units.length; i++) {
      v = Math.round(abs / units[i][0]);
      if (v >= 1) { unit = units[i][1]; break; }
    }
    var s = v + ' ' + unit + (v === 1 ? '' : 's');
    if (abs < 2) return 'just now';
    return diff > 0 ? 'in ' + s : s + ' ago';
  }

  function dcRender() {
    var d = new Date($('dcDt').value);
    if (isNaN(d.getTime())) return;
    var unix = Math.floor(d.getTime() / 1000);
    $('dcUnix').textContent = unix;
    var html = '';
    DC_FLAGS.forEach(function (f) {
      var preview = f.rel ? dcRelative(unix) : new Intl.DateTimeFormat(undefined, f.opts).format(d);
      html += '<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid rgba(255,255,255,0.06)">'
        + '<div style="width:46px;height:30px;border-radius:9px;background:rgba(85,115,244,0.18);border:1px solid rgba(85,115,244,0.5);display:flex;align-items:center;justify-content:center;font-family:monospace;font-weight:700;color:#fff;flex-shrink:0">' + f.flag + '</div>'
        + '<div style="flex:1;min-width:0"><div style="font-size:0.78rem;color:#9CA3AF">' + f.name + '</div>'
        + '<div style="font-size:0.95rem;color:#fff;font-weight:500;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(preview) + '</div></div>'
        + '<div style="flex-shrink:0;display:flex;align-items:center;gap:8px;max-width:46%">'
        + '<code style="font-family:monospace;font-size:0.76rem;color:#9CA3AF;background:rgba(255,255,255,0.05);padding:6px 10px;border-radius:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">&lt;t:' + unix + ':' + f.flag + '&gt;</code>'
        + '<button class="scheme dc-copy" data-code="&lt;t:' + unix + ':' + f.flag + '&gt;" style="border-radius:9px;font-size:0.72rem">Copy</button></div></div>';
    });
    $('dcRows').innerHTML = html;
  }

  function dcCopy(text, btn) {
    function done() {
      var old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = old; }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
  }

  function wireDiscord() {
    var dt = $('dcDt');
    dt.value = dcToLocalInput(new Date());
    dt.addEventListener('input', dcRender);
    document.querySelectorAll('[data-jump]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = new Date(dt.value);
        if (isNaN(d.getTime())) d = new Date();
        d.setSeconds(d.getSeconds() + parseInt(b.getAttribute('data-jump'), 10));
        dt.value = dcToLocalInput(d);
        dcRender();
      });
    });
    $('dcCopyUnix').addEventListener('click', function () { dcCopy($('dcUnix').textContent || '', this); });
    $('dcRows').addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('.dc-copy') : null;
      if (b) dcCopy(b.getAttribute('data-code') || '', b);
    });
    dcRender();
  }

  /* ============================================================
     EXTRA DISCORD TOOLS: markdown preview · webhook sender ·
     embed builder · announcement generator · role gradients
     ============================================================ */

  function copyPlain(text, done) {
    var ok = false;
    function fin() { if (done) done(ok); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text)).then(function () { ok = true; fin(); }, fin);
    } else {
      var ta = document.createElement('textarea');
      ta.value = String(text);
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      fin();
    }
  }

  /* ---------------- WEBHOOK SENDER ---------------- */
  function wsSendTo(url, payload, statusEl, btn) {
    url = String(url || '').trim();
    if (!/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/[\w-]+\/[\w-]+/i.test(url)) {
      if (statusEl) { statusEl.textContent = 'Enter a valid Discord webhook URL'; statusEl.style.color = '#f87171'; }
      return false;
    }
    if (btn) btn.disabled = true;
    if (statusEl) { statusEl.textContent = 'Sending…'; statusEl.style.color = '#9CA3AF'; }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (r.ok) {
        if (statusEl) { statusEl.textContent = 'Sent (HTTP ' + r.status + ')'; statusEl.style.color = '#4ade80'; }
      } else {
        return r.text().then(function (t) {
          var msg = (t || '').slice(0, 240) || r.statusText;
          if (statusEl) { statusEl.textContent = 'Failed ' + r.status + ': ' + msg; statusEl.style.color = '#f87171'; }
        });
      }
    }).catch(function (err) {
      if (statusEl) { statusEl.textContent = 'Network error: ' + (err && err.message ? err.message : err); statusEl.style.color = '#f87171'; }
    }).finally(function () { if (btn) btn.disabled = false; });
    return true;
  }

  function wireWs() {
    var urlEl = $('wsUrl'), st = $('wsStatus');
    if (!urlEl) return;
    if (st) { st.textContent = 'Ready'; st.style.color = '#9CA3AF'; }
    var sendBtn = $('wsSend');
    if (sendBtn) sendBtn.addEventListener('click', function () {
      var payload = {};
      var content = ($('wsContent').value || '').trim();
      if (content) payload.content = content;
      var nm = ($('wsName').value || '').trim();
      if (nm) payload.username = nm.slice(0, 80);
      var av = ($('wsAvatar').value || '').trim();
      if (av) payload.avatar_url = av;
      var ej = ($('wsEmbed').value || '').trim();
      if (ej) {
        var parsed;
        try { parsed = JSON.parse(ej); } catch (e) {
          if (st) { st.textContent = 'Embed JSON invalid: ' + e.message; st.style.color = '#f87171'; }
          return;
        }
        if (Array.isArray(parsed)) {
          payload.embeds = parsed;
        } else if (parsed && typeof parsed === 'object') {
          var base = parsed;
          if ('embeds' in base && Array.isArray(base.embeds)) {
            if (!content && base.content) payload.content = base.content;
            payload.embeds = base.embeds;
            if (Array.isArray(base.components)) payload.components = base.components;
          } else {
            payload.embeds = [base];
          }
        } else {
          if (st) { st.textContent = 'Embed JSON must be an object or array'; st.style.color = '#f87171'; }
          return;
        }
      }
      wsSendTo(urlEl.value, payload, st, sendBtn);
    });
  }

  /* ---------------- EMBED BUILDER ---------------- */
  function ebHex2int() {
    var h = ($('ebHex').value || '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map(function (c) { return c + c; }).join('');
    return /^[0-9a-fA-F]{6}$/.test(h) ? parseInt(h, 16) : null;
  }
  function ebFieldsArr() {
    var arr = [];
    document.querySelectorAll('#ebFields .eb-frow').forEach(function (r) {
      var name = (r.querySelector('.eb-fname').value || '').trim();
      var val = (r.querySelector('.eb-fval').value || '').trim();
      if (!name && !val) return;
      arr.push({ name: name || ' ', value: val || ' ', inline: !!r.querySelector('.eb-finline').checked });
    });
    return arr;
  }
  function ebRows() {
    var rows = [], cur = [];
    document.querySelectorAll('#ebBtns > *').forEach(function (el) {
      if (el.classList && el.classList.contains('eb-bdiv')) {
        if (cur.length) { rows.push({ type: 1, components: cur }); cur = []; }
        return;
      }
      var lbl = (el.querySelector('.eb-blabel').value || '').trim().slice(0, 80);
      if (!lbl) return;
      var sel = el.querySelector('.eb-bstyle');
      var val = (el.querySelector('.eb-bval').value || '').trim();
      if (sel.value === 'link') {
        if (!val) return;
        cur.push({ type: 2, style: 5, label: lbl, url: val });
      } else {
        cur.push({ type: 2, style: parseInt(sel.value, 10) || 1, label: lbl, custom_id: (val || 'btn_' + Math.random().toString(36).slice(2, 8)).slice(0, 100) });
      }
      if (cur.length >= 5) { rows.push({ type: 1, components: cur }); cur = []; }
    });
    if (cur.length) rows.push({ type: 1, components: cur });
    return rows;
  }
  function ebBuild() {
    var e = {};
    var author = ($('ebAuthor').value || '').trim();
    var authorIcon = ($('ebAuthorIcon').value || '').trim();
    if (author) {
      e.author = {};
      e.author.name = author;
      if (authorIcon) e.author.icon_url = authorIcon;
    }
    var t = ($('ebTitle').value || '').trim(), tu = ($('ebTitleUrl').value || '').trim();
    if (t) {
      e.title = t;
      if (tu) e.url = tu;
    }
    var d = ($('ebDesc').value || '').trim();
    if (d) e.description = d;
    var col = ebHex2int();
    if (col != null) e.color = col;
    var th = ($('ebThumb').value || '').trim();
    if (th) e.thumbnail = { url: th };
    var im = ($('ebImg').value || '').trim();
    if (im) e.image = { url: im };
    var ft = ($('ebFoot').value || '').trim(), fi = ($('ebFootIcon').value || '').trim();
    if (ft || fi) {
      e.footer = {};
      if (ft) e.footer.text = ft;
      if (fi) e.footer.icon_url = fi;
    }
    if ($('ebTsOn').checked && $('ebTs').value) {
      var dd = new Date($('ebTs').value);
      if (!isNaN(dd.getTime())) e.timestamp = dd.toISOString();
    }
    var fields = ebFieldsArr();
    if (fields.length) e.fields = fields;
    var payload = {};
    var content = ($('ebContent').value || '').trim();
    if (content) payload.content = content;
    if (Object.keys(e).length) payload.embeds = [e];
    var rows = ebRows();
    if (rows.length) payload.components = rows;
    return payload;
  }
  function ebSync() {
    var el = $('ebJson');
    if (el) el.textContent = JSON.stringify(ebBuild(), null, 2);
    ebPreview();
    var st = $('ebStatus');
    if (st) st.textContent = '';
  }
  function ebFmt(s) {
    s = escapeHtml(String(s || ''));
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/__([^_]+)__/g, '<u>$1</u>');
    s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    s = s.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.07);border-radius:3px;padding:1px 4px;font-family:monospace;font-size:0.85em">$1</code>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#00a8fc;text-decoration:underline" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\n/g, '<br/>');
    return s;
  }
  function ebInt2Hex(n) {
    if (n == null) return '#5573f4';
    return '#' + ('000000' + (n >>> 0).toString(16)).slice(-6);
  }
  function ebPreview() {
    var box = $('ebPreview');
    if (!box) return;
    var p = ebBuild();
    var H = [];
    if (p.content) H.push('<div style="color:#dbdee1;font-size:0.9rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-width:520px">' + ebFmt(p.content) + '</div>');
    var e = p.embeds && p.embeds[0];
    if (!e) { box.innerHTML = H.join('') || '<span style="color:#9CA3AF;font-size:0.85rem">Nothing to preview.</span>'; return; }
    var col = ebInt2Hex(e.color);
    H.push('<div style="background:#2b2d31;border-radius:6px;border-left:4px solid ' + col + ';padding:12px 16px;max-width:520px;display:flex;gap:14px">');
    H.push('<div style="min-width:0;flex:1;display:flex;flex-direction:column;gap:6px">');
    if (e.author) {
      H.push('<div style="display:flex;align-items:center;gap:8px;font-size:0.85rem;color:#dbdee1">');
      if (e.author.icon_url) H.push('<img src="' + escapeHtml(e.author.icon_url) + '" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover" />');
      H.push('<span>' + ebFmt(e.author.name) + '</span></div>');
    }
    if (e.title) {
      var tHref = e.url ? 'style="color:#00a8fc;text-decoration:none" href="' + escapeHtml(e.url) + '" target="_blank" rel="noopener"' : '';
      H.push('<div style="font-size:1rem;font-weight:600;color:#f2f3f5;line-height:1.3;word-break:break-word">' + (e.url ? '<a ' + tHref + '>' : '') + ebFmt(e.title) + (e.url ? '</a>' : '') + '</div>');
    }
    if (e.description) H.push('<div style="color:#dbdee1;font-size:0.9rem;line-height:1.5;white-space:normal;word-break:break-word">' + ebFmt(e.description) + '</div>');
    if (e.fields && e.fields.length) {
      H.push('<div style="display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:4px">');
      for (var i = 0; i < e.fields.length; i++) {
        var f = e.fields[i];
        H.push('<div style="' + (f.inline ? 'flex:1 1 30%;min-width:120px;' : 'flex:1 1 100%;') + '"><div style="font-size:0.85rem;font-weight:600;color:' + col + ';margin-bottom:2px">' + ebFmt(f.name) + '</div><div style="font-size:0.9rem;color:#dbdee1;line-height:1.45;word-break:break-word">' + ebFmt(f.value) + '</div></div>');
      }
      H.push('</div>');
    }
    if (e.image && e.image.url) H.push('<img src="' + escapeHtml(e.image.url) + '" alt="" style="max-width:100%;max-height:180px;border-radius:6px;object-fit:cover;margin-top:6px" />');
    if (e.footer || e.timestamp) {
      H.push('<div style="display:flex;align-items:center;gap:8px;font-size:0.75rem;color:#9CA3AF;margin-top:6px">');
      if (e.footer && e.footer.icon_url) H.push('<img src="' + escapeHtml(e.footer.icon_url) + '" alt="" style="width:20px;height:20px;border-radius:50%;object-fit:cover" />');
      if (e.footer && e.footer.text) H.push('<span>' + ebFmt(e.footer.text) + '</span>');
      var ne = [];
      if (e.timestamp) {
        var dt = new Date(e.timestamp);
        if (!isNaN(dt.getTime())) ne.push(dcFmtTs(dt));
      }
      if (ne.length) H.push('<span style="opacity:0.8">· ' + ne.join(' ') + '</span>');
      H.push('</div>');
    }
    H.push('</div>');
    if (e.thumbnail && e.thumbnail.url) H.push('<img src="' + escapeHtml(e.thumbnail.url) + '" alt="" style="width:64px;height:64px;border-radius:6px;object-fit:cover;flex-shrink:0" />');
    H.push('</div>');
    box.innerHTML = H.join('');
  }
  function ebAddField(name, value, inline) {
    var box = $('ebFields'), row = document.createElement('div');
    row.className = 'eb-frow';
    row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;flex-wrap:wrap';
    row.innerHTML =
      '<input class="inp eb-fname" placeholder="Field name" style="min-width:0;width:200px" />' +
      '<input class="inp eb-fval" placeholder="Field value — supports markdown" style="min-width:0;flex:1" />' +
      '<label style="display:flex;gap:6px;align-items:center;font-size:0.75rem;color:#9CA3AF;cursor:pointer"><input class="eb-finline" type="checkbox" style="accent-color:#5573f4" /> inline</label>' +
      '<button class="scheme eb-del-f" style="border-radius:8px;font-size:0.72rem;padding:6px 10px">×</button>';
    if (name != null) row.querySelector('.eb-fname').value = name;
    if (value != null) row.querySelector('.eb-fval').value = value;
    if (inline) row.querySelector('.eb-finline').checked = true;
    box.appendChild(row);
    ebSync();
  }
  function ebAddButton(label, style, val) {
    var box = $('ebBtns'), row = document.createElement('div');
    row.className = 'eb-brow';
    row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap';
    row.innerHTML =
      '<input class="inp eb-blabel" placeholder="Button label" style="min-width:0;flex:1" />' +
      '<select class="inp eb-bstyle" style="width:112px;background:#1a1c2c">' +
      '<option value="1">Blurple</option><option value="2">Grey</option><option value="3">Green</option><option value="4">Red</option><option value="link">Link</option>' +
      '</select>' +
      '<input class="inp eb-bval" placeholder="URL (link) or custom id (button)" style="min-width:0;flex:1" />' +
      '<button class="scheme eb-del-b" style="border-radius:8px;font-size:0.72rem;padding:6px 10px">×</button>';
    if (label != null) row.querySelector('.eb-blabel').value = label;
    if (style != null) row.querySelector('.eb-bstyle').value = style;
    if (val != null) row.querySelector('.eb-bval').value = val;
    box.appendChild(row);
    ebSync();
  }
  function ebNewRowMark() {
    var box = $('ebBtns'), d = document.createElement('div');
    d.className = 'eb-bdiv';
    d.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0;color:#9CA3AF;font-size:0.72rem;letter-spacing:0.05em';
    d.innerHTML = '<span style="flex:1;border-top:1px dashed rgba(255,255,255,0.15)"></span>new row<span style="flex:1;border-top:1px dashed rgba(255,255,255,0.15)"></span>' +
      '<button class="scheme eb-del-f" style="border-radius:8px;font-size:0.72rem;padding:4px 9px">×</button>';
    box.appendChild(d);
    ebSync();
  }
  function ebLoadSample() {
    $('ebContent').value = 'Some content goes above the embed.';
    $('ebAuthor').value = 'cz-navy';
    $('ebAuthorIcon').value = '';
    $('ebTitle').value = 'Server Update 2.0';
    $('ebTitleUrl').value = '';
    $('ebDesc').value = 'What changed:\n\n• faster page loads\n• a cleaner tools page\n• fixed guestbook likes\n\nFull changelog below.';
    $('ebColor').value = '#5573f4';
    $('ebHex').value = '#5573F4';
    $('ebThumb').value = '';
    $('ebImg').value = '';
    $('ebFoot').value = 'posted by the team';
    $('ebFootIcon').value = '';
    $('ebTsOn').checked = true;
    $('ebTs').style.display = '';
    $('ebTs').value = dcToLocalInput(new Date(Date.now() + 3600000));
    $('ebFields').innerHTML = '';
    ebAddField('Rolled out', 'Save the date', false);
    ebAddField('More to come', 'Soon', false);
    $('ebBtns').innerHTML = '';
    ebAddButton('Changelog', 'link', 'https://example.com');
    ebAddButton('Claim reward', '3', 'claim_upd_2');
    ebNewRowMark();
    ebAddButton('Join', 'link', 'https://discord.gg/');
  }
  function wireEb() {
    if (!$('ebContent')) return;
    ebAddField('', '', false);
    ebAddButton('', '1', '');
    var root = $('tab-eb');
    function colorSync(src) {
      var hexEl = $('ebHex');
      if (sourceIs(src, 'ebColor') && hexEl) hexEl.value = src.value.toUpperCase();
      else if (sourceIs(src, 'ebHex')) { var h = ebHex2int(); if (h != null) $('ebColor').value = '#' + (src.value.replace(/^#/, '').toLowerCase()); }
    }
    function sourceIs(el, id) { return el && el.id === id; }
    root.addEventListener('input', function (ev) {
      var t = ev.target;
      if (sourceIs(t, 'ebHex') || sourceIs(t, 'ebColor')) { colorSync(t); return; }
      ebSync();
    });
    root.addEventListener('change', function (ev) {
      var t = ev.target;
      if (sourceIs(t, 'ebHex') || sourceIs(t, 'ebColor')) { colorSync(t); return; }
      if (sourceIs(t, 'ebTsOn')) $('ebTs').style.display = t.checked ? '' : 'none';
      ebSync();
    });
    root.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('.eb-del-f, .eb-del-b') : null;
      if (!b) { ebSync(); return; }
      var row = b.parentNode;
      if (row && row.parentNode) row.parentNode.removeChild(row);
      ebSync();
    });
    var addF = $('ebAddField');
    if (addF) addF.addEventListener('click', function () { ebAddField('', '', false); });
    var addB = $('ebAddBtn');
    if (addB) addB.addEventListener('click', function () { ebAddButton('', '1', ''); });
    var newR = $('ebNewRow');
    if (newR) newR.addEventListener('click', ebNewRowMark);
    var sample = $('ebSample');
    if (sample) sample.addEventListener('click', ebLoadSample);
    var copyBtn = $('ebCopy');
    if (copyBtn) copyBtn.addEventListener('click', function () { dcCopy($('ebJson').textContent || '', this); });
    var sendBtn = $('ebSend');
    if (sendBtn) sendBtn.addEventListener('click', function () {
      wsSendTo($('ebHook').value, ebBuild(), $('ebStatus'), this);
    });
    ebSync();
  }

  /* ---------------- ROLE GRADIENTS ---------------- */
  function grHex(s) {
    s = String(s || '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split('').map(function (c) { return c + c; }).join('');
    return /^[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
  }
  function grRgb(h) {
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function grHexOf(rgb) {
    return '#' + rgb.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
  }
  function grLerp(a, b, t) { return a + (b - a) * t; }
  function grRender() {
    var A = grHex($('grA').value) || grHex($('grAHex').value) || '5573f4';
    var B = grHex($('grB').value) || grHex($('grBHex').value) || 'ff5f9e';
    var steps = 2;
    var bar = $('grBar');
    if (bar) bar.style.background = 'linear-gradient(90deg, #' + A + ', #' + B + ')';
    var ra = grRgb(A), rb = grRgb(B);
    var box = $('grChips'); if (!box) return;
    box.innerHTML = '';
    for (var i = 0; i < steps; i++) {
      var t = steps === 1 ? 0 : i / (steps - 1);
      var hex = grHexOf([grLerp(ra[0], rb[0], t), grLerp(ra[1], rb[1], t), grLerp(ra[2], rb[2], t)]);
      var chip = document.createElement('button');
      chip.className = 'gr-chip';
      chip.style.cssText = 'display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:10px;padding:6px 10px;cursor:pointer;font-family:monospace;font-size:0.8rem;transition:border-color .15s';
      chip.setAttribute('data-hex', hex);
      chip.innerHTML = '<span style="width:22px;height:22px;border-radius:6px;background:' + hex + ';border:1px solid rgba(255,255,255,0.25);flex-shrink:0"></span><span>' + hex + '</span>';
      chip.addEventListener('click', function (hx, chipEl) {
        return function () {
          copyPlain(hx, function () {
            chipEl.style.borderColor = '#4ade80';
            setTimeout(function () { chipEl.style.borderColor = 'rgba(255,255,255,0.1)'; }, 500);
          });
        };
      }(hex, chip));
      box.appendChild(chip);
    }
  }
  function wireGr() {
    if (!$('grA')) return;
    function colorSync(cInput, hexInput) {
      cInput.addEventListener('input', function () { hexInput.value = cInput.value.toUpperCase(); grRender(); });
      cInput.addEventListener('change', grRender);
      hexInput.addEventListener('input', function () {
        var h = grHex(hexInput.value);
        if (h) cInput.value = '#' + h;
        grRender();
      });
      hexInput.addEventListener('change', function () {
        var h = grHex(hexInput.value);
        hexInput.value = h ? '#' + h.toUpperCase() : hexInput.value;
        if (h) cInput.value = '#' + h;
      });
    }
    colorSync($('grA'), $('grAHex'));
    colorSync($('grB'), $('grBHex'));
    grRender();
  }

  /* ---------------- DISCORD COLORED TEXT GENERATOR ---------------- */
  var CT_FG = [
    ['30', 'Black', '#7b7f8c'],
    ['31', 'Red', '#f1848c'],
    ['32', 'Green', '#6fcf9a'],
    ['33', 'Brown', '#e3b95e'],
    ['34', 'Light Blue', '#5fa8f2'],
    ['35', 'Pink', '#e59ae6'],
    ['36', 'Teal', '#57c7d4'],
    ['37', 'Light Gray', '#d8dbe5']
  ];
  var CT_BG = [
    ['40', 'Black', '#4e5058'],
    ['41', 'Red', '#d2464f'],
    ['42', 'Green', '#2f9d5b'],
    ['43', 'Brown', '#b8872e'],
    ['44', 'Light Blue', '#3f7ac0'],
    ['45', 'Pink', '#9a52a6'],
    ['46', 'Teal', '#2c8f99'],
    ['47', 'Light Gray', '#a8abb3']
  ];
  function ctSwatch(meta, box) {
    var b = document.createElement('button');
    b.style.background = meta[2];
    b.className = 'ct-swat' + (meta[0] >= 40 ? ' ct-ol' : '');
    b.title = meta[1];
    b.setAttribute('data-ct', meta[0]);
    b.addEventListener('click', function () { ctApply(meta[0]); });
    box.appendChild(b);
  }
  function ctApply(code) {
    var area = $('ctArea');
    if (!area) return;
    var sel = window.getSelection();
    var text = sel.toString();
    if (!text || sel.rangeCount === 0) return;
    var span = document.createElement('span');
    span.innerText = text;
    span.className = 'ansi-' + code;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(span);
    range.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function ctReset() {
    var area = $('ctArea');
    if (!area) return;
    area.innerHTML = area.innerText.replace(/\n/g, '<br>');
    area.focus();
  }
  function ctNodesToANSI(nodes, states) {
    var text = '';
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeType === 3) { text += node.textContent; continue; }
      if (node.nodeName === 'BR') { text += '\n'; continue; }
      var m = node.className && String(node.className).match(/ansi\-(\d+)/);
      var ansiCode = m ? Number(m[1]) : 0;
      var newState = { st: states[states.length - 1].st, fg: states[states.length - 1].fg, bg: states[states.length - 1].bg };
      if (ansiCode && ansiCode < 30) newState.st = ansiCode;
      else if (ansiCode >= 30 && ansiCode < 40) newState.fg = ansiCode;
      else if (ansiCode >= 40) newState.bg = ansiCode;
      states.push(newState);
      text += '\x1b[' + newState.st + ';' + ((ansiCode >= 40 && ansiCode < 50) || ansiCode >= 100 ? newState.bg : newState.fg) + 'm';
      text += ctNodesToANSI(node.childNodes, states);
      states.pop();
      text += '\x1b[0m';
      var top = states[states.length - 1];
      if (top.fg !== 2) text += '\x1b[' + top.st + ';' + top.fg + 'm';
      if (top.bg !== 2) text += '\x1b[' + top.st + ';' + top.bg + 'm';
    }
    return text;
  }
  function wireCt() {
    var area = $('ctArea');
    if (!area) return;
    var fg = $('ctFg'), bg = $('ctBg');
    CT_FG.forEach(function (m) { ctSwatch(m, fg); });
    CT_BG.forEach(function (m) { ctSwatch(m, bg); });
    Array.prototype.forEach.call(document.querySelectorAll('.ct-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var code = btn.getAttribute('data-ct');
        if (code === '0') { ctReset(); return; }
        ctApply(code);
      });
    });
    area.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.execCommand('insertLineBreak', false, null);
      }
    });
    var cp = $('ctCopy');
    if (cp) cp.addEventListener('click', function () {
      var me = this;
      var toCopy = '```ansi\n' + ctNodesToANSI(area.childNodes, [{ fg: 2, bg: 2, st: 2 }]) + '\n```';
      copyPlain(toCopy, function () {
        var old = me.textContent;
        me.textContent = 'Copied';
        setTimeout(function () { me.textContent = old; }, 1200);
      });
    });
  }

  function wire() {
    var dz = $('dropzone');
    var fi = $('fileInput');

    $('pickBtn').addEventListener('click', function () { fi.click(); });
    fi.addEventListener('change', function () { addFiles(fi.files); fi.value = ''; });
    ['dragover'].forEach(function (e) {
      dz.addEventListener(e, function (ev) { ev.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (e) {
      dz.addEventListener(e, function (ev) { ev.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (ev) {
      if (ev.dataTransfer && ev.dataTransfer.files) addFiles(ev.dataTransfer.files);
    });

    // tabs
    var tabBtns = document.querySelectorAll('.tab-btn:not([disabled])');
    tabBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.tab-btn').forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.tool-tab').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        var t = $('tab-' + b.getAttribute('data-tab'));
        if (t) t.classList.add('active');
      });
    });

    // mode switch
    function setMode(m) {
      state.mode = m;
      $('mode-auto').classList.toggle('active', m === 'auto');
      $('mode-manual').classList.toggle('active', m === 'manual');
      $('autoFields').style.display = m === 'auto' ? 'grid' : 'none';
      $('manualFields').style.display = m === 'manual' ? 'block' : 'none';
    }
    $('mode-auto').addEventListener('click', function () { setMode('auto'); });
    $('mode-manual').addEventListener('click', function () { setMode('manual'); });

    // format switch
    document.querySelectorAll('[data-fmt]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('[data-fmt]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        state.format = b.getAttribute('data-fmt');
      });
    });

    // quality slider label
    $('quality').addEventListener('input', function () { $('qVal').textContent = this.value; });

    // process / download / clear
    var runBtn = document.createElement('button');
    runBtn.id = 'runBtn';
    runBtn.textContent = 'Compress all';
    runBtn.style.cssText = 'width:100%;margin-top:16px;padding:12px;border-radius:12px;border:none;background:#5573f4;color:#fff;font-size:0.9rem;font-weight:600;cursor:pointer;font-family:inherit';
    runBtn.addEventListener('click', processAll);
    $('results').insertBefore(runBtn, $('results').firstChild);

    $('dlAll').addEventListener('click', downloadAll);

    $('clearAll').addEventListener('click', function () {
      state.files = [];
      $('resultList').innerHTML = '';
      $('results').style.display = 'none';
    });

    wireYt();
    wireDiscord();
    wireCt();
    wireWs();
    wireEb();
    wireGr();
  }

  wire();
})();
