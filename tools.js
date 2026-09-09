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

  /* ---------------- MARKDOWN PREVIEW ---------------- */
  function mdRender(text) {
    text = String(text || '');
    var esc = escapeHtml(text);
    var blocks = [], inl = [];
    esc = esc.replace(/```([\s\S]*?)```/g, function (_, c) { blocks.push(c); return '\u0000' + blocks.length + '\u0000'; });
    esc = esc.replace(/`([^`\n]+)`/g, function (_, c) { inl.push(c); return '\u0001' + inl.length + '\u0001'; });
    esc = esc.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_, t, u) {
      return '<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>';
    });
    esc = esc.replace(/(^|[^\w\\])(https?:\/\/[^\s<]+)/g, function (_, p, u) {
      return p + '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>';
    });
    esc = esc.replace(/\|\|([\s\S]*?)\|\|/g, '<span class="mm-spoil">$1</span>');
    esc = esc.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    esc = esc.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    esc = esc.replace(/__([^_\n]+)__/g, '<u>$1</u>');
    esc = esc.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    esc = esc.split('\n').map(function (l) {
      var m = l.match(/^(&gt; &gt; &gt;|&gt; &gt;|&gt;)( ?)(.*)$/);
      if (m) return '<span class="mm-quote' + (m[1].indexOf('&gt; &gt;') === 0 ? ' mm-quote2' : '') + '">' + m[3] + '</span>';
      return l;
    }).join('\n');
    esc = esc.replace(/\u0001(\d+)\u0001/g, function (_, i) {
      return '<code class="mm-code">' + inl[Number(i) - 1] + '</code>';
    });
    esc = esc.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return '<pre class="mm-codeblock">' + blocks[Number(i) - 1] + '</pre>';
    });
    return esc;
  }

  function wireMm() {
    var inp = $('mmInput');
    if (!inp) return;
    inp.value = ['**bold** *italic* _underline_ ~~strike~~ `inline code`',
      '||spoiler text (hover)||',
      '> quoted line',
      '```js',
      'code block',
      '```',
      '[linked text](https://example.com) and a bare link https://example.com'
    ].join('\n');
    function show() {
      var out = $('mmOut');
      if (out) out.innerHTML = mdRender(inp.value) || '<span style="opacity:0.5">preview appears here…</span>';
    }
    inp.addEventListener('input', show);
    var copyBtn = $('mmCopy');
    if (copyBtn) copyBtn.addEventListener('click', function () { dcCopy(inp.value, this); });
    show();
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
        try { payload.embeds = JSON.parse(ej); } catch (e) {
          if (st) { st.textContent = 'Embed JSON invalid: ' + e.message; st.style.color = '#f87171'; }
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

  /* ---------------- BANNER / ICON GENERATOR ---------------- */
  function cParse(h) {
    h = String(h).replace(/^#/, '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function crgba(h, a) {
    var c = cParse(h);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  var BN_T = [
    { id: 'aurora', label: 'Aurora', fn: function (c, W, H, A, B) {
        var g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
        g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      } },
    { id: 'cyclone', label: 'Cyclone', fn: function (c, W, H, A, B) {
        var cx = W / 2, cy = H / 2, m = Math.max(W, H);
        for (var a = 0; a < 3; a++) {
          c.strokeStyle = crgba(B, 0.8); c.lineWidth = m * 0.018; c.lineCap = 'round';
          c.beginPath();
          for (var t = 0; t <= 1; t += 0.015) {
            var ang = a * (Math.PI * 2 / 3) + t * 3.4 * Math.PI * 2;
            var x = cx + Math.cos(ang) * t * m * 0.42, y = cy + Math.sin(ang) * t * m * 0.42;
            if (t === 0) c.moveTo(x, y); else c.lineTo(x, y);
          }
          c.stroke();
        }
      } },
    { id: 'vortex', label: 'Vortex', fn: function (c, W, H, A, B) {
        var cx = W / 2, cy = H / 2, m = Math.max(W, H);
        c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = m * 0.015; c.lineCap = 'round';
        for (var i = 0; i < 5; i++) {
          c.beginPath();
          for (var t = 0; t <= 1; t += 0.02) {
            var ang = t * Math.PI * 5;
            var r = m * (0.08 + t * 0.42);
            var x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
            if (t === 0) c.moveTo(x, y); else c.lineTo(x, y);
          }
          c.stroke();
        }
      } },
    { id: 'orbit', label: 'Orbit', fn: function (c, W, H, A, B) {
        var cx = W / 2, cy = H / 2, m = Math.max(W, H);
        var rings = [[0.3, 0.4], [0.46, 1.3], [0.6, 0.8]];
        for (var i = 0; i < rings.length; i++) {
          c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = m * 0.012;
          c.beginPath(); c.ellipse(cx, cy, m * rings[i][0], m * rings[i][0] * 0.36, rings[i][1], 0, 7); c.stroke();
          var px = cx + Math.cos(rings[i][1]) * m * rings[i][0];
          c.fillStyle = crgba(B, 0.95);
          c.beginPath(); c.arc(px, cy + Math.sin(rings[i][1]) * m * rings[i][0] * 0.36, m * 0.05, 0, 7); c.fill();
          c.fillStyle = 'rgba(255,255,255,0.9)';
          c.beginPath(); c.arc(cx - m * rings[i][0] * 0.5, cy + m * rings[i][0] * 0.15, m * 0.022, 0, 7); c.fill();
        }
      } },
    { id: 'bursts', label: 'Bursts', fn: function (c, W, H, A, B) {
        var cx = W / 2, cy = H / 2, m = Math.max(W, H);
        for (var i = 0; i < 36; i++) {
          var ang = (i / 36) * Math.PI * 2;
          var len = m * (i % 3 === 2 ? 0.38 : 0.28);
          c.strokeStyle = i % 2 ? 'rgba(255,255,255,0.35)' : crgba(B, 0.9);
          c.lineCap = 'round'; c.lineWidth = m * (i % 4 === 0 ? 0.02 : 0.012);
          c.beginPath(); c.moveTo(cx + Math.cos(ang) * m * 0.06, cy + Math.sin(ang) * m * 0.06);
          c.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len); c.stroke();
        }
      } },
    { id: 'nexus', label: 'Nexus', fn: function (c, W, H, A, B) {
        var m = Math.max(W, H), gap = m * 0.14, r = m * 0.045;
        for (var y = -1; y * gap < H + gap; y++) {
          var off = (y % 2) ? gap / 2 : 0;
          for (var x = -1; x * gap < W + gap; x++) {
            var cx = off + x * gap, cy = y * gap;
            if (cx < -r || cx > W + r || cy < -r || cy > H + r) continue;
            c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = m * 0.008;
            c.beginPath(); c.arc(cx, cy, r, 0, 7); c.stroke();
            c.fillStyle = crgba(B, 0.9);
            c.beginPath(); c.arc(cx, cy, m * 0.011, 0, 7); c.fill();
          }
        }
      } },
    { id: 'mesh', label: 'Mesh', fn: function (c, W, H, A, B) {
        var pts = [[0.5, 0.1], [0.1, 0.5], [0.9, 0.5], [0.35, 0.78], [0.65, 0.78], [0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.85], [0.8, 0.85], [0.5, 0.95]];
        var m = Math.max(W, H);
        for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
          var d = Math.sqrt(Math.pow(pts[i][0] - pts[j][0], 2) + Math.pow(pts[i][1] - pts[j][1], 2));
          if (d < 0.62) {
            c.strokeStyle = 'rgba(255,255,255,' + (0.30 * (1 - d)).toFixed(2) + ')';
            c.lineWidth = m * 0.006;
            c.beginPath(); c.moveTo(pts[i][0] * W, pts[i][1] * H); c.lineTo(pts[j][0] * W, pts[j][1] * H); c.stroke();
          }
        }
        for (var k = 0; k < pts.length; k++) {
          c.fillStyle = crgba('#ffffff', 0.85);
          c.beginPath(); c.arc(pts[k][0] * W, pts[k][1] * H, m * 0.022, 0, 7); c.fill();
        }
      } },
    { id: 'circuits', label: 'Circuit', fn: function (c, W, H, A, B) {
        var m = Math.max(W, H), lw = m * 0.012;
        var paths = [[0.05, 0.2, 0.95, 0.2], [0.3, 0.8, 0.3, 0.15], [0.1, 0.7, 0.8, 0.7], [0.7, 0.9, 0.7, 0.35], [0.06, 0.5, 0.6, 0.5], [0.4, 0.05, 0.4, 0.6]];
        for (var i = 0; i < paths.length; i++) {
          c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = lw; c.lineCap = 'round';
          c.beginPath(); c.moveTo(paths[i][0] * W, paths[i][1] * H); c.lineTo(paths[i][2] * W, paths[i][3] * H); c.stroke();
          c.fillStyle = crgba(B, 0.95);
          c.beginPath(); c.arc(paths[i][2] * W, paths[i][3] * H, lw * 0.9, 0, 7); c.fill();
          c.fillStyle = crgba(B, 0.8);
          c.beginPath(); c.arc(paths[i][0] * W, paths[i][1] * H, lw * 1.5, 0, 7); c.fill();
        }
      } },
    { id: 'bloom', label: 'Bloom', fn: function (c, W, H, A, B) {
        var cx = W / 2, cy = H / 2, m = Math.max(W, H), n = 8;
        for (var i = 0; i < n; i++) {
          var ang = (i / n) * Math.PI * 2;
          c.save(); c.translate(cx, cy); c.rotate(ang);
          var gr = c.createLinearGradient(0, -m * 0.42, 0, 0);
          gr.addColorStop(0, crgba(B, 0)); gr.addColorStop(1, crgba(B, 0.85));
          c.fillStyle = gr;
          c.beginPath(); c.ellipse(0, -m * 0.2, m * 0.10, m * 0.30, 0, 0, 7); c.fill();
          c.restore();
        }
        c.fillStyle = crgba(A, 0.95);
        c.beginPath(); c.arc(cx, cy, m * 0.11, 0, 7); c.fill();
      } },
    { id: 'magma', label: 'Magma', fn: function (c, W, H, A, B) {
        var bands = 4;
        for (var i = 0; i < bands; i++) {
          c.strokeStyle = crgba(i % 2 ? A : B, 0.85); c.lineWidth = Math.max(W, H) * 0.09; c.lineCap = 'round';
          c.beginPath();
          for (var x = -H * 0.5; x <= W + H * 0.5; x += W / 40) {
            var y = H * (0.32 + 0.36 * i / (bands - 1)) + Math.sin(x * 0.02 - i * 1.2) * H * 0.08;
            if (x === -H * 0.5) c.moveTo(x, y); else c.lineTo(x, y);
          }
          c.stroke();
        }
      } },
    { id: 'comets', label: 'Comets', fn: function (c, W, H, A, B) {
        var m = Math.max(W, H);
        var coms = [[0.2, 0.32, 1.1], [0.8, 0.75, 0.6], [0.5, 0.12, 1.6], [0.9, 0.2, 0.9], [0.28, 0.9, 0.55]];
        for (var i = 0; i < coms.length; i++) {
          var cx = coms[i][0] * W, cy = coms[i][1] * H, len = coms[i][2] * m * 0.28;
          var gr = c.createLinearGradient(cx, cy, cx - len, cy - len);
          gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.3, crgba(B, 0.6)); gr.addColorStop(1, 'rgba(255,255,255,0)');
          c.strokeStyle = gr; c.lineWidth = m * 0.02; c.lineCap = 'round';
          c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx - len, cy - len); c.stroke();
          c.fillStyle = '#fff'; c.beginPath(); c.arc(cx, cy, m * 0.028, 0, 7); c.fill();
        }
      } },
    { id: 'sparkles', label: 'Sparkles', fn: function (c, W, H, A, B) {
        var m = Math.max(W, H);
        var sp = [[0.15, 0.2, 1], [0.85, 0.15, 0.8], [0.75, 0.85, 1.1], [0.2, 0.8, 0.7], [0.5, 0.06, 0.6], [0.95, 0.5, 0.9], [0.45, 0.92, 0.7], [0.62, 0.3, 0.5]];
        for (var i = 0; i < sp.length; i++) {
          var sx = sp[i][0] * W, sy = sp[i][1] * H, sz = m * 0.032 * sp[i][2];
          c.fillStyle = 'rgba(255,255,255,0.9)';
          c.beginPath(); c.moveTo(sx - sz, sy); c.quadraticCurveTo(sx - sz * 0.3, sy, sx, sy - sz); c.quadraticCurveTo(sx + sz * 0.3, sy, sx + sz, sy); c.quadraticCurveTo(sx, sy, sx, sy + sz); c.quadraticCurveTo(sx, sy, sx - sz, sy); c.fill();
        }
        for (var j = 0; j < 14; j++) {
          var px = ((j * 37) % 97) / 97 * W, py = ((j * 19) % 89) / 89 * H;
          c.fillStyle = crgba(B, 0.7);
          c.beginPath(); c.arc(px, py, m * 0.007, 0, 7); c.fill();
        }
      } },
    { id: 'binary', label: 'Binary', fn: function (c, W, H, A, B) {
        var m = Math.max(W, H);
        c.font = '700 ' + Math.round(m * 0.055) + 'px monospace';
        c.textAlign = 'left';
        var rowH = m * 0.1;
        for (var y = 0; y < H; y += rowH) {
          var row = '';
          var cols = Math.max(4, Math.round(W / (m * 0.09)));
          for (var x = 0; x < cols; x++) row += Math.random() > 0.5 ? '1' : '0';
          c.fillStyle = 'rgba(255,255,255,0.35)';
          c.fillText(row + ' ', m * 0.12, y + rowH * 0.7);
        }
      } },
    { id: 'prism', label: 'Prism', fn: function (c, W, H, A, B) {
        var m = Math.max(W, H);
        var bars = 7;
        for (var i = 0; i < bars; i++) {
          var x0 = (i / bars) * W * 1.1 - m * 0.08;
          c.fillStyle = i % 2 ? crgba(A, 0.5) : crgba(B, 0.55);
          c.beginPath();
          c.moveTo(x0, 0); c.lineTo(x0 + W * 0.14, 0); c.lineTo(x0 + W * 0.06, H); c.lineTo(x0 - W * 0.08, H);
          c.closePath(); c.fill();
        }
        c.save(); c.translate(W / 2, H / 2); c.rotate(Math.PI / 4);
        var g = c.createLinearGradient(0, -m * 0.3, 0, m * 0.3);
        g.addColorStop(0, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0.05)');
        c.fillStyle = g;
        c.beginPath(); c.moveTo(0, -m * 0.28); c.lineTo(m * 0.26, m * 0.2); c.lineTo(-m * 0.26, m * 0.2); c.closePath(); c.fill();
        c.restore();
      } },
    { id: 'aperture', label: 'Aperture', fn: function (c, W, H, A, B) {
        var cx = W / 2, cy = H / 2, m = Math.max(W, H), n = 6;
        c.save(); c.translate(cx, cy); c.rotate(Math.PI / n);
        for (var i = 0; i < n; i++) {
          c.rotate(Math.PI * 2 / n);
          c.fillStyle = i % 2 ? crgba(A, 0.6) : crgba(B, 0.65);
          c.beginPath(); c.moveTo(0, 0); c.lineTo(m * 0.5, -m * 0.12); c.lineTo(m * 0.5, m * 0.12); c.closePath(); c.fill();
        }
        c.beginPath(); c.arc(0, 0, m * 0.09, 0, 7); c.fillStyle = 'rgba(255,255,255,0.9)'; c.fill();
        c.beginPath(); c.arc(0, 0, m * 0.3, 0, 7); c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = m * 0.02; c.stroke();
        c.restore();
      } },
    { id: 'horizon', label: 'Horizon', fn: function (c, W, H, A, B) {
        var cx = W / 2, hy = H * 0.62;
        c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = Math.max(W, H) * 0.01;
        for (var i = 0; i < 9; i++) {
          c.beginPath();
          for (var t = 0; t <= 1; t += 0.04) {
            var y = H + (hy - H) * t;
            var z = 1 - t * 0.9;
            var x = cx + (i - 4) * Math.max(W, H) * 0.16 * z;
            if (t === 0) c.moveTo(x, W / 2 > W ? y : y); else c.lineTo(x, y);
          }
          c.stroke();
        }
        c.fillStyle = 'rgba(255,255,255,0.8)';
        c.beginPath(); c.moveTo(cx + Math.max(W, H) * 0.5, hy); c.lineTo(cx - Math.max(W, H) * 0.5, hy); c.lineTo(cx, H + Math.max(W, H) * 0.1); c.closePath(); c.fill();
      } },
    { id: 'glitch', label: 'Glitch', fn: function (c, W, H, A, B) {
        var m = Math.max(W, H);
        var rows = 16;
        c.globalCompositeOperation = 'lighter';
        for (var i = 0; i < rows; i++) {
          var y0 = (i / rows) * H;
          var rh = H / rows * (0.5 + 0.6 * Math.abs(Math.sin(i * 1.3)));
          var shift = (Math.random() - 0.5) * m * 0.05;
          if (i % 3 === 0) {
            c.fillStyle = crgba(A, 0.5); c.fillRect(shift, y0, W, rh);
          } else if (i % 3 === 1) {
            c.fillStyle = crgba(B, 0.5); c.fillRect(-shift, y0, W, rh);
          }
        }
        c.globalCompositeOperation = 'source-over';
        c.fillStyle = 'rgba(255,255,255,0.18)';
        for (var j = 0; j < 24; j++) c.fillRect(Math.random() * W, Math.random() * H, W * 0.06, Math.max(1, m * 0.006));
      } }
  ];
  var bnSel = 'aurora';
  var bnFmt = 'banner';
  function bnHexOf(v) {
    var m = String(v || '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(m)) m = m.split('').map(function (c) { return c + c; }).join('');
    return /^[0-9a-fA-F]{6}$/.test(m) ? '#' + m : '#ffffff';
  }
  function bnRender() {
    var isBanner = bnFmt === 'banner';
    var W = isBanner ? 600 : 512, H = isBanner ? 240 : 512;
    var ca = document.createElement('canvas');
    ca.width = W; ca.height = H;
    var c = ca.getContext('2d');
    var A = bnHexOf($('bnA').value), B = bnHexOf($('bnB').value);
    var ang = (parseInt($('bnAngle').value, 10) || 0) * Math.PI / 180;
    var cx = W / 2, cy = H / 2, diag = Math.sqrt(W * W + H * H) / 2;
    var g = c.createLinearGradient(cx - Math.cos(ang) * diag, cy - Math.sin(ang) * diag, cx + Math.cos(ang) * diag, cy + Math.sin(ang) * diag);
    g.addColorStop(0, A); g.addColorStop(1, B);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    var tpl = null;
    for (var i = 0; i < BN_T.length; i++) if (BN_T[i].id === bnSel) { tpl = BN_T[i]; break; }
    if (!tpl) tpl = BN_T[0];
    tpl.fn(c, W, H, A, B);
    if (isBanner) bnText(c, W, H);
    var prev = $('bnPrev');
    if (prev) {
      prev.innerHTML = '';
      ca.style.cssText = 'max-width:100%;max-height:280px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.45);display:block;';
      prev.appendChild(ca);
    }
    return ca;
  }
  function bnText(c, W, H) {
    var title = ($('bnTitle').value || '').trim();
    var sub = ($('bnSub').value || '').trim();
    var grad = $('bnTextGrad').checked, glow = $('bnTextGlow').checked;
    if (title) {
      c.save();
      var fs = H * 0.26;
      c.font = '800 ' + Math.round(fs) + 'px system-ui, -apple-system, Segoe UI, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      while (c.measureText(title).width > W * 0.88 && fs > 8) { fs -= 1; c.font = '800 ' + Math.round(fs) + 'px system-ui, -apple-system, Segoe UI, sans-serif'; }
      if (glow) { c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = H * 0.10; }
      if (grad) { var tg = c.createLinearGradient(0, H * 0.3, 0, H * 0.6); tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, 'rgba(255,255,255,0.45)'); c.fillStyle = tg; }
      else c.fillStyle = '#ffffff';
      c.fillText(title, W / 2, H * 0.42, W * 0.88);
      c.restore();
    }
    if (sub) {
      c.save();
      c.font = '600 ' + Math.round(H * 0.12) + 'px system-ui, -apple-system, Segoe UI, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (glow) { c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = H * 0.05; }
      c.fillStyle = grad ? 'rgba(255,255,255,0.8)' : '#ffffff';
      c.fillText(sub.toUpperCase(), W / 2, H * 0.63, W * 0.88);
      c.restore();
    }
  }
  function bnGrid() {
    var box = $('bnTpl'); if (!box) return;
    box.innerHTML = '';
    var A = bnHexOf($('bnA').value), B = bnHexOf($('bnB').value);
    BN_T.forEach(function (t) {
      var b = document.createElement('button');
      var on = t.id === bnSel;
      b.style.cssText = 'background:rgba(255,255,255,0.03);border:2px solid ' + (on ? '#5573f4' : 'rgba(255,255,255,0.1)') + ';border-radius:10px;padding:6px;cursor:pointer;color:#fff;display:flex;flex-direction:column;gap:6px;align-items:center;transition:border-color .15s';
      var cv = document.createElement('canvas');
      cv.width = 120; cv.height = 120;
      var c = cv.getContext('2d');
      var g = c.createLinearGradient(0, 0, 120, 120); g.addColorStop(0, A); g.addColorStop(1, B);
      c.fillStyle = g; c.fillRect(0, 0, 120, 120);
      t.fn(c, 120, 120, A, B);
      cv.style.cssText = 'width:100%;aspect-ratio:1;border-radius:6px;display:block';
      var lb = document.createElement('span');
      lb.textContent = t.label;
      lb.style.cssText = 'font-size:0.65rem;color:#c7d2fe';
      b.appendChild(cv); b.appendChild(lb);
      b.addEventListener('click', function () { bnSel = this.children.length ? this.getAttribute('data-id') : bnSel; assignSel(this); });
      b.setAttribute('data-id', t.id);
      box.appendChild(b);
    });
  }
  function assignSel(btn) {
    var id = btn.getAttribute('data-id');
    if (id) bnSel = id;
    Array.prototype.forEach.call(document.querySelectorAll('#bnTpl .bn-tpl-sel-init'), function () {});
    var all = document.querySelectorAll('#bnTpl button');
    for (var i = 0; i < all.length; i++) {
      all[i].style.borderColor = all[i].getAttribute('data-id') === bnSel ? '#5573f4' : 'rgba(255,255,255,0.1)';
    }
    bnRender();
  }
  function bnSetFmt(f) {
    bnFmt = f;
    var iBtn = $('bnFmtIcon'), bBtn = $('bnFmtBanner');
    if (iBtn) iBtn.style.outline = f === 'icon' ? '2px solid #5573f4' : 'none';
    if (bBtn) bBtn.style.outline = f === 'banner' ? '2px solid #5573f4' : 'none';
    var tw = $('bnTextWrap'); if (tw) tw.style.display = f === 'banner' ? 'grid' : 'none';
    var hint = $('bnHint'); if (hint) hint.textContent = f === 'icon' ? 'Icons: 512×512, transparent corners. ' + BN_T.length + ' templates — click to swap.' : 'Profile banners: exactly 600×240, no cropping. ' + BN_T.length + ' templates — click to swap.';
    bnRender();
  }
  function bnDl() {
    var ca = bnRender();
    ca.toBlob(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = (bnFmt === 'banner' ? 'cz-banner-' : 'cz-icon-') + Date.now() + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }, 'image/png');
  }
  function wireBn() {
    if (!$('bnA')) return;
    var root = $('tab-bn');
    function sync(el, hex) {
      el.addEventListener('input', function () { hex.value = el.value.toUpperCase(); bnGrid(); bnRender(); });
      el.addEventListener('change', bnRender);
      hex.addEventListener('input', function () {
        var v = bnHexOf(hex.value);
        if (v) el.value = v;
        bnGrid(); bnRender();
      });
    }
    sync($('bnA'), $('bnAHex'));
    sync($('bnB'), $('bnBHex'));
    root.addEventListener('input', function (ev) { var t = ev.target; if (t === $('bnA') || t === $('bnB') || t === $('bnAHex') || t === $('bnBHex')) return; bnRender(); });
    root.addEventListener('change', function (ev) { var t = ev.target; if (t === $('bnA') || t === $('bnB') || t === $('bnAHex') || t === $('bnBHex')) return; bnRender(); });
    var iBtn = $('bnFmtIcon'), bBtn = $('bnFmtBanner');
    if (iBtn) iBtn.addEventListener('click', function () { bnSetFmt('icon'); });
    if (bBtn) bBtn.addEventListener('click', function () { bnSetFmt('banner'); });
    var dl = $('bnDl');
    if (dl) dl.addEventListener('click', bnDl);
    bnGrid();
    bnSetFmt('banner');
  }

  /* ---------------- ROLE EMOJI / BADGE MAKER ---------------- */
  var EM_Q = ['⭐', '🔥', '⚡', '💎', '🎮', '👑', '🌟', '🎧', '🛡️', '🌙', '💜', '🤍', '🖤', '☠️', '⚔️', '💥', '✨', '🐉', '💚', '❤️', '🫧', '🧠'];
  function emExt(shape) {
    if (shape === 'shield') return 0.78; else if (shape === 'hexagon') return 0.96; else return 1;
  }
  function emPath(c, cx, cy, r, shape) {
    c.beginPath();
    if (shape === 'circle') { c.arc(cx, cy, r, 0, 7); return; }
    if (shape === 'hexagon') {
      for (var i = 0; i < 6; i++) {
        var a = Math.PI / 6 + i * Math.PI / 3;
        var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.closePath(); return;
    }
    if (shape === 'diamond') {
      c.moveTo(cx, cy - r); c.lineTo(cx + r, cy); c.lineTo(cx, cy + r); c.lineTo(cx - r, cy);
      c.closePath(); return;
    }
    if (shape === 'shield') {
      var h = r * 1.15;
      c.moveTo(cx - r, cy - h * 0.6);
      c.quadraticCurveTo(cx - r, cy - h, cx - r * 0.45, cy - h);
      c.lineTo(cx + r * 0.45, cy - h);
      c.quadraticCurveTo(cx + r, cy - h, cx + r, cy - h * 0.6);
      c.quadraticCurveTo(cx + r, cy - h * 0.1, cx + r * 0.55, cy + h * 0.55);
      c.quadraticCurveTo(cx, cy + h, cx - r * 0.55, cy + h * 0.55);
      c.quadraticCurveTo(cx - r, cy - h * 0.1, cx - r, cy - h * 0.6);
      c.closePath(); return;
    }
    var rr = r * 0.28;
    c.moveTo(cx - r + rr, cy - r);
    c.arcTo(cx + r, cy - r, cx + r, cy + r, rr);
    c.arcTo(cx + r, cy + r, cx - r, cy + r, rr);
    c.arcTo(cx - r, cy + r, cx - r, cy - r, rr);
    c.arcTo(cx - r, cy - r, cx + r, cy - r, rr);
    c.closePath();
  }
  function emFont(c, ch, px) {
    c.font = Math.round(px) + 'px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif';
  }
  function emText(c, ch, px, cx, cy, maxW, style) {
    c.save();
    emFont(c, ch, px);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    while (c.measureText(ch).width > maxW && px > 8) { px -= 1; emFont(c, ch, px); }
    c.fillStyle = style;
    c.fillText(ch, cx, cy, maxW);
    c.restore();
  }
  function emRender() {
    var size = parseInt($('emSize').value, 10) || 128;
    var shape = $('emShape').value || 'rounded';
    var A = bnHexOf($('emA').value), B = bnHexOf($('emB').value);
    var ss = Math.max(40, Math.min(120, parseFloat($('emShapeSize').value) || 100)) / 100;
    var sy = Math.max(-40, Math.min(40, parseFloat($('emShapeY').value) || 0)) / 100 * size;
    var cx = size / 2, cy = size / 2 + sy;
    var r = size * 0.5 * ss * emExt(shape);
    var ca = document.createElement('canvas');
    ca.width = size; ca.height = size;
    var c = ca.getContext('2d');
    if ($('emShapeGlow').checked) {
      c.save();
      emPath(c, cx, cy, r, shape);
      c.shadowColor = crgba(B, 0.8);
      c.shadowBlur = Math.max(8, r * 0.34);
      c.fillStyle = crgba(A, 0.4);
      c.fill();
      c.restore();
    }
    c.save();
    emPath(c, cx, cy, r, shape);
    var g = c.createLinearGradient(cx - r, cy - r, cx + r * 0.7, cy + r * 0.9);
    g.addColorStop(0, A); g.addColorStop(1, B);
    c.fillStyle = g;
    c.fill();
    c.restore();
    c.save();
    emPath(c, cx, cy, r, shape);
    c.clip();
    var sh = c.createLinearGradient(0, cy - r, 0, cy);
    sh.addColorStop(0, 'rgba(255,255,255,0.38)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sh;
    c.fillRect(cx - r, cy - r, r * 2, r * 2);
    c.restore();
    if ($('emShapeGlitch').checked) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      var gdx = Math.max(3, r * 0.09);
      c.save(); emPath(c, cx - gdx, cy, r, shape); c.clip(); c.fillStyle = 'rgba(255,61,96,0.45)'; c.fillRect(0, 0, size, size); c.restore();
      c.save(); emPath(c, cx + gdx, cy, r, shape); c.clip(); c.fillStyle = 'rgba(38,226,255,0.45)'; c.fillRect(0, 0, size, size); c.restore();
      c.restore();
    }
    var ch = ($('emChar').value || '').trim() || '🔥';
    var is = Math.max(20, Math.min(100, parseFloat($('emIconSize').value) || 62)) / 100 * size;
    var iy = Math.max(-40, Math.min(40, parseFloat($('emIconY').value) || 0)) / 100 * size;
    var px = is, icx = size / 2, icy = size / 2 + iy;
    c.save();
    emPath(c, cx, cy, r, shape);
    c.clip();
    if ($('emIconGlitch').checked) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      var idx = Math.max(3, is * 0.07);
      emText(c, ch, px, icx - idx, icy, size * 0.8, 'rgba(255,61,96,0.9)');
      emText(c, ch, px, icx + idx, icy, size * 0.8, 'rgba(38,226,255,0.9)');
      c.restore();
    }
    c.save();
    if ($('emIconGlow').checked) { c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = is * 0.12; }
    emText(c, ch, px, icx, icy, size * 0.8, 'rgba(255,255,255,0.96)');
    c.restore();
    c.restore();
    var prev = $('emPrev');
    if (prev) {
      prev.innerHTML = '';
      ca.style.cssText = 'width:128px;height:128px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,0.45);display:block;background:#0b0c16;';
      prev.appendChild(ca);
      var tag = document.createElement('span');
      tag.textContent = size + '×' + size;
      tag.style.cssText = 'font-size:0.75rem;color:#9CA3AF';
      prev.appendChild(tag);
    }
    return ca;
  }
  function emClick(ch) {
    $('emChar').value = ch;
    emRender();
  }
  function emQuick() {
    var box = $('emQuick'); if (!box) return;
    box.innerHTML = '';
    EM_Q.forEach(function (e) {
      var b = document.createElement('button');
      b.textContent = e;
      b.style.cssText = 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:8px;font-size:0.95rem;padding:4px 8px;cursor:pointer';
      b.addEventListener('click', function () { emClick(e); });
      box.appendChild(b);
    });
  }
  function emDl() {
    var ca = emRender();
    var size = ca.width;
    ca.toBlob(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'cz-emoji-' + size + 'px-' + Date.now() + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }, 'image/png');
  }
  function wireEm() {
    if (!$('emA')) return;
    var root = $('tab-em');
    $('emA').addEventListener('input', emRender);
    $('emB').addEventListener('input', emRender);
    root.addEventListener('input', function (ev) { var t = ev.target; if (t === $('emA') || t === $('emB')) return; emRender(); });
    root.addEventListener('change', function (ev) { var t = ev.target; if (t === $('emA') || t === $('emB')) return; emRender(); });
    var dl = $('emDl');
    if (dl) dl.addEventListener('click', emDl);
    var cp = $('emCopy');
    if (cp) cp.addEventListener('click', function () {
      var me = this;
      copyPlain(($('emChar').value || '').trim() || '🔥', function () { dcCopy('icon copied', me); });
    });
    emQuick();
    emRender();
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
    wireMm();
    wireWs();
    wireEb();
    wireGr();
    wireBn();
    wireEm();
  }

  wire();
})();
