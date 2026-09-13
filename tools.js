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

  /* ---------- plain-english time parser ---------- */
  var DC_WD = { sun: 0, sunday: 0, sundays: 0, mon: 1, monday: 1, mondays: 1, tue: 2, tues: 2, tuesday: 2, tuesdays: 2, wed: 3, wednesday: 3, wednesdays: 3, thu: 4, thur: 4, thursday: 4, thursdays: 4, fri: 5, friday: 5, fridays: 5, sat: 6, saturday: 6, saturdays: 6 };
  var DC_MO = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
  var DC_MUL = { sec: 1000, secs: 1000, second: 1000, seconds: 1000, min: 60000, mins: 60000, minute: 60000, minutes: 60000, hr: 3600000, hrs: 3600000, hour: 3600000, hours: 3600000, day: 86400000, days: 86400000, week: 604800000, weeks: 604800000, month: 2592000000, months: 2592000000, year: 31536000000, years: 31536000000 };

  function dcExtractTime(s) {
    s = s.replace(/(\d)\s+(am|pm)\b/g, '$1$2');
    if (/\bmidnight\b/.test(s)) return { t: { h: 0, m: 0 }, rest: s.replace(/\bmidnight\b/g, ' ') };
    if (/\bnoon\b/.test(s)) return { t: { h: 12, m: 0 }, rest: s.replace(/\bnoon\b/g, ' ') };
    var m = s.match(/(?:^|\s)(\d{1,2})(?:(?::|\.)(\d{2}))?(am|pm)?(?=$|\s)/);
    if (!m || (!m[3] && !m[2])) return { t: null, rest: s };
    var hr = parseInt(m[1], 10), min = parseInt(m[2] || '0', 10);
    if (m[3] === 'pm' && hr < 12) hr += 12;
    if (m[3] === 'am' && hr === 12) hr = 0;
    if (hr > 23 || min > 59) return { t: null, rest: s };
    return { t: { h: hr, m: min }, rest: s.replace(m[0], ' ') };
  }

  function dcParseNatural(input) {
    var s = String(input || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\bat\b/g, ' ');
    s = s.replace(/\s*(est|edt|cst|cdt|pst|pdt|mst|mdt|utc|gmt)\b/g, '');
    if (!s) return null;
    var now = new Date();

    var m = s.match(/^(?:in\s+)?([+-]?\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)(?:\s+from now)?$/);
    if (m) return new Date(now.getTime() + parseFloat(m[1]) * DC_MUL[String(m[2]).toLowerCase()]);
    if (s === 'now') return now;

    var ex = dcExtractTime(s);
    var t = ex.t;
    var rest = ex.rest.trim().replace(/\s+/g, ' ');

    var wdm = rest.match(/^((?:next|last|this|coming)\s+)?(sundays|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|thursday|wednesday|tuesday|monday|sunday|saturday|friday|thu|thur|wed|tue|tues|mon|tue|sun|sat|fri|mon)$/);
    if (wdm) {
      var d = new Date(now); d.setHours(0, 0, 0, 0);
      var off = (DC_WD[wdm[2]] - d.getDay() + 7) % 7;
      if (wdm[1] === 'next ') off += 7;
      if (wdm[1] === 'last ') off -= 7;
      d.setDate(d.getDate() + off);
      if (t) d.setHours(t.h, t.m, 0, 0);
      return d;
    }

    var tom = rest.match(/^(day after tomorrow|tomorrow|tmr|tonight|today)$/);
    if (tom) {
      var d2 = new Date(now); d2.setHours(0, 0, 0, 0);
      if (tom[1] === 'tomorrow' || tom[1] === 'tmr') d2.setDate(d2.getDate() + 1);
      else if (tom[1] === 'day after tomorrow') d2.setDate(d2.getDate() + 2);
      if (t) d2.setHours(t.h, t.m, 0, 0);
      return d2;
    }

    var wmon = rest.match(/^((?:january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec))\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/);
    var dmon = wmon ? null : rest.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+((?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec))\.?(?:,?\s+(\d{4}))?$/);
    var mon = wmon || dmon;
    if (mon) {
      var mm, md, my;
      if (wmon) { mm = DC_MO[wmon[1]] || 0; md = parseInt(wmon[2], 10); my = wmon[3] ? parseInt(wmon[3], 10) : now.getFullYear(); }
      else { mm = DC_MO[dmon[2]] || 0; md = parseInt(dmon[1], 10); my = dmon[3] ? parseInt(dmon[3], 10) : now.getFullYear(); }
      var d3 = new Date(my, mm, md, t ? t.h : 0, t ? t.m : 0, 0, 0);
      if (!isNaN(d3.getTime()) && md >= 1 && md <= 31) return d3;
    }

    var nm = rest.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (nm) return new Date(+nm[1], +nm[2] - 1, +nm[3], t ? t.h : 0, t ? t.m : 0, 0, 0);
    var sm = rest.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/);
    if (sm) {
      var y = sm[3] ? (+sm[3] < 100 ? 2000 + +sm[3] : +sm[3]) : now.getFullYear();
      return new Date(y, +sm[1] - 1, +sm[2], t ? t.h : 0, t ? t.m : 0, 0, 0);
    }

    if (rest === '' && t) {
      var d5 = new Date(now); d5.setHours(t.h, t.m, 0, 0);
      return d5;
    }

    var dd = new Date(input);
    return isNaN(dd.getTime()) ? null : dd;
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

    var nat = $('dcNat');
    if (nat) {
      function dcUseNat() {
        var parsed = dcParseNatural(nat.value);
        var err = $('dcNatErr');
        if (!parsed || isNaN(parsed.getTime())) {
          if (err) err.style.display = 'block';
          return;
        }
        if (err) err.style.display = 'none';
        dt.value = dcToLocalInput(parsed);
        dcRender();
      }
      var useBtn = $('dcUse');
      if (useBtn) useBtn.addEventListener('click', dcUseNat);
      nat.addEventListener('keydown', function (e) { if (e.key === 'Enter') dcUseNat(); });
    }

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

  /* ---------------- MESSAGE SPLITTER ---------------- */
  var ms = { parts: [] };

  function msSplitText(text, limit) {
    var chars = Array.from(text);
    var out = [], i = 0;
    while (i < chars.length) {
      var end = Math.min(i + limit, chars.length);
      var cut = end;
      for (var j = end - 1; j > i; j--) {
        if (end - j > 48) break;
        var c = chars[j];
        if (c === '\n' || c === '\r' || c === ' ') { cut = j + 1; break; }
      }
      out.push(chars.slice(i, cut).join(''));
      i = cut;
    }
    return out;
  }

  function msCount() {
    var ta = $('msText');
    if (!ta) return;
    var n = Array.from(ta.value).length;
    var lim = parseInt(ta.getAttribute('data-limit') || '2000', 10);
    var msgs = Math.max(1, Math.ceil(n / lim));
    var c = $('msCount');
    if (c) c.textContent = n.toLocaleString() + ' chars - ' + msgs + ' message' + (msgs === 1 ? '' : 's');
  }

  function msRender() {
    var ta = $('msText'), out = $('msOut');
    if (!out) return;
    out.innerHTML = '';
    if (!ta.value) { ms.parts = []; return; }
    var limit = parseInt(ta.getAttribute('data-limit') || '2000', 10);
    ms.parts = msSplitText(ta.value, limit);

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap';
    head.innerHTML = '<div style="font-size:0.75rem;letter-spacing:0.05em;color:#9CA3AF;text-transform:uppercase">' + ms.parts.length + ' part' + (ms.parts.length === 1 ? '' : 's') + '</div>'
      + '<button id="msCopyAll" class="scheme" style="border-radius:9px;font-size:0.72rem">Copy all</button>';
    out.appendChild(head);

    for (var i = 0; i < ms.parts.length; i++) {
      (function (idx) {
        var card = document.createElement('div');
        card.style.cssText = 'border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.03);overflow:hidden;margin-bottom:12px';
        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06)';
        bar.innerHTML = '<span style="font-size:0.72rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.05em">Part ' + (idx + 1) + ' / ' + ms.parts.length + '</span>'
          + '<span style="font-size:0.72rem;color:#9CA3AF">' + Array.from(ms.parts[idx]).length.toLocaleString() + ' chars</span>';
        card.appendChild(bar);
        var body = document.createElement('div');
        body.style.cssText = 'padding:12px 14px;font-family:Consolas,"Andale Mono","Courier New",monospace;font-size:0.78rem;line-height:1.55;color:#dbe2ff;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto';
        body.textContent = ms.parts[idx];
        card.appendChild(body);
        var foot = document.createElement('div');
        foot.style.cssText = 'padding:10px 14px;border-top:1px solid rgba(255,255,255,0.06)';
        var b = document.createElement('button');
        b.className = 'scheme';
        b.style.cssText = 'border-radius:9px;font-size:0.72rem';
        b.textContent = 'Copy part';
        b.addEventListener('click', function () {
          if (ms.parts[idx] == null) return;
          copyPlain(ms.parts[idx], function () {
            var old = b.textContent;
            b.textContent = 'Copied';
            setTimeout(function () { b.textContent = old; }, 1200);
          });
        });
        foot.appendChild(b);
        card.appendChild(foot);
        out.appendChild(card);
      })(i);
    }

    var ca = $('msCopyAll');
    if (ca) ca.addEventListener('click', function () {
      copyPlain(ms.parts.join('\n\n'), function () {
        var old = ca.textContent;
        ca.textContent = 'Copied all';
        setTimeout(function () { ca.textContent = old; }, 1200);
      });
    });
  }

  function wireMs() {
    var ta = $('msText');
    if (!ta) return;
    var sel = $('msLimit');
    if (sel) sel.addEventListener('change', function () {
      ta.setAttribute('data-limit', sel.value);
      var lab = $('msLimitLabel');
      if (lab) lab.textContent = 'Limit: ' + Number(sel.value).toLocaleString();
      msCount();
      msRender();
    });
    ta.addEventListener('input', function () { msCount(); msRender(); });
    var cl = $('msClear');
    if (cl) cl.addEventListener('click', function () { ta.value = ''; msCount(); msRender(); });
    msCount();
    msRender();
  }

  /* ---------------- IMAGE HEX COLOR PICKER ---------------- */
  var cpData = null;            // cached ImageData of the loaded image
  var cpHexCur = '#000000';
  var cpHistoryArr = [];
  function cpHex(r, g, b) { return '#' + [r, g, b].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('').toUpperCase(); }
  function cpClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function cpShowErr(msg) { var e = $('cpErr'); if (!e) return; e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; }

  function cpRenderImg(img) {
    var MAX = 2600;
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) return;
    var scale = Math.min(1, MAX / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    var c = $('cpCanvas');
    c.width = cw; c.height = ch;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    try {
      cpData = ctx.getImageData(0, 0, cw, ch); // throws when the canvas is tainted
      cpShowErr('');
    } catch (err) {
      cpData = null;
      cpShowErr('That image can\'t be pixel-read (its host blocks cross-origin access). Save it and use "Choose image" instead.');
    }
    $('cpEmpty').style.display = 'none';
    $('cpStage').style.display = 'block';
    $('cpLoupe').style.display = 'none';
    var crect = c.getBoundingClientRect();
    cpPick(crect.left + crect.width * 0.5, crect.top + crect.height * 0.5, false);
  }
  function cpLoadFromUrl(url) {
    url = (url || '').trim();
    if (!url) return;
    cpShowErr('');
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () { cpRenderImg(this); };
    img.onerror = function () { cpShowErr('Couldn\'t load that image link. Check the URL, or upload the file instead.'); };
    img.src = url;
  }
  function cpLoadFile(file) {
    if (!file) return;
    if (file.type.indexOf('image') !== 0 && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) return;
    cpShowErr('');
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () { cpRenderImg(img); URL.revokeObjectURL(url); };
    img.onerror = function () { URL.revokeObjectURL(url); cpShowErr('Couldn\'t read that image file.'); };
    img.src = url;
  }
  function cpSampleAt(clientX, clientY) {
    var c = $('cpCanvas');
    var rect = c.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    var sx = cpClamp(Math.floor((clientX - rect.left) / rect.width * c.width), 0, c.width - 1);
    var sy = cpClamp(Math.floor((clientY - rect.top) / rect.height * c.height), 0, c.height - 1);
    return { sx: sx, sy: sy, c: c };
  }
  function cpPick(clientX, clientY, doCopy) {
    var p = cpSampleAt(clientX, clientY);
    if (!p) return;
    var hex = '#000000', r = 0, g = 0, b = 0;
    if (cpData) {
      var i = (p.sy * p.c.width + p.sx) * 4;
      r = cpData.data[i]; g = cpData.data[i + 1]; b = cpData.data[i + 2];
      hex = cpHex(r, g, b);
    }
    cpHexCur = hex;
    $('cpSwatch').style.background = hex;
    $('cpHex').textContent = hex;
    $('cpRgb').textContent = cpData ? ('rgb(' + r + ', ' + g + ', ' + b + ')') : 'pixel read blocked for this image';
    cpDrawLoupe(p);
    if (doCopy && cpData) {
      copyPlain(hex, function () {
        var el = $('cpHex');
        var old = el.style.color;
        el.style.color = '#4ade80';
        setTimeout(function () { el.style.color = old || '#fff'; }, 600);
      });
      cpAddHistory(hex);
    }
  }
  function cpDrawLoupe(p) {
    var l = $('cpLoupe');
    var lctx = l.getContext('2d');
    var Z = 8, N = Math.floor(l.width / Z);
    var half = N >> 1;
    lctx.imageSmoothingEnabled = false;
    lctx.fillStyle = '#000';
    lctx.fillRect(0, 0, l.width, l.height);
    lctx.drawImage(p.c, p.sx - half, p.sy - half, N, N, 0, 0, l.width, l.height);
    var cell = l.width / N;
    lctx.strokeStyle = 'rgba(255,255,255,0.85)';
    lctx.lineWidth = 1;
    lctx.strokeRect(half * cell + 0.5, half * cell + 0.5, cell, cell);
    var wrap = $('cpWrap');
    var wr = wrap.getBoundingClientRect();
    var lx = cpClamp(clientX0 - wr.left + 18, 0, Math.max(0, wr.width - l.width));
    var ly = cpClamp(clientY0 - wr.top + 18, 0, Math.max(0, wr.height - l.height));
    l.style.left = lx + 'px'; l.style.top = ly + 'px';
    l.style.display = 'block';
  }
  var clientX0 = 0, clientY0 = 0;
  function cpAddHistory(hex) {
    if (cpHistoryArr[0] === hex) return;
    cpHistoryArr.unshift(hex);
    cpHistoryArr = cpHistoryArr.slice(0, 12);
    var wrap = $('cpHistory');
    if (!wrap) return;
    wrap.innerHTML = '';
    cpHistoryArr.forEach(function (hx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.title = 'Copy ' + hx;
      b.style.cssText = 'width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);cursor:pointer;background:' + hx;
      b.addEventListener('click', function () { copyPlain(hx, function () {}); });
      wrap.appendChild(b);
    });
  }
  function wireCp() {
    var d = $('cpDrop');
    if (!d) return;
    $('cpPick').addEventListener('click', function () { $('cpFile').click(); });
    $('cpFile').addEventListener('change', function () { cpLoadFile(this.files && this.files[0]); this.value = ''; });
    $('cpLoad').addEventListener('click', function () { cpLoadFromUrl($('cpUrl').value); });
    $('cpUrl').addEventListener('keydown', function (e) { if (e.key === 'Enter') cpLoadFromUrl(this.value); });
    ['dragover'].forEach(function (e) { d.addEventListener(e, function (ev) { ev.preventDefault(); d.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (e) { d.addEventListener(e, function (ev) { ev.preventDefault(); d.classList.remove('drag'); }); });
    d.addEventListener('drop', function (ev) {
      if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]) {
        cpLoadFile(ev.dataTransfer.files[0]);
      } else if (ev.dataTransfer && ev.dataTransfer.getData) {
        var u = ev.dataTransfer.getData('text/uri-list') || ev.dataTransfer.getData('text/plain');
        if (u) cpLoadFromUrl(u);
      }
    });
    var c = $('cpCanvas');
    c.addEventListener('pointermove', function (e) {
      clientX0 = e.clientX; clientY0 = e.clientY;
      cpPick(e.clientX, e.clientY, false);
    });
    c.addEventListener('pointerleave', function () { $('cpLoupe').style.display = 'none'; });
    c.addEventListener('pointerdown', function (e) {
      clientX0 = e.clientX; clientY0 = e.clientY;
      cpPick(e.clientX, e.clientY, true);
    });
    $('cpHex').addEventListener('click', function () { if (cpData) copyPlain(cpHexCur, function () {}); });
    if (!window.__cpPasteBound) {
      window.__cpPasteBound = true;
      document.addEventListener('paste', function (e) {
        var tab = $('tab-ce');
        if (!tab || !tab.classList.contains('active')) return;
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type && items[i].type.indexOf('image') === 0) { cpLoadFile(items[i].getAsFile()); break; }
        }
      });
    }
  }

  /* ---------------- DISCORD AUTOMOD REGEX MAKER ---------------- */
  var DM_ACC = {
    a: ['áÁ', 'àÀ', 'âÂ', 'äÄ', 'ãÃ', 'åÅ'],
    e: ['éÉ', 'èÈ', 'êÊ', 'ëË'],
    i: ['íÍ', 'ìÌ', 'îÎ', 'ïÏ'],
    o: ['óÓ', 'òÒ', 'ôÔ', 'öÖ', 'õÕ', 'øØ'],
    u: ['úÚ', 'ùÙ', 'ûÛ', 'üÜ'],
    n: ['ñÑ'],
    y: ['ýÝ', 'ÿ']
  };
  var DM_LEET = {
    a: ['4', '@'], e: ['3'], i: ['1', '!'], o: ['0'],
    s: ['5', '$'], t: ['7', '+'], l: ['|'], g: ['9'], z: ['2'], b: ['8']
  };
  function dmCl(ch, leet, acc) {
    var set = [ch];
    if (acc) set = set.concat(DM_ACC[ch] || []);
    if (leet) set = set.concat(DM_LEET[ch] || []);
    set.push('\\*');
    return '[' + set.join('') + ']';
  }
  function dmBuild(word, opts) {
    var w = String(word || '').trim().toLowerCase();
    if (!w) return '';
    if (w === 'links' || /^https?:/.test(w)) return '\\bhttps?://.+\\..+';
    var letters = [];
    for (var i = 0; i < w.length; i++) if (/[a-z]/.test(w[i])) letters.push(w[i]);
    if (!letters.length) return '';
    var out = opts.bnd ? '\\b' : '';
    for (var j = 0; j < letters.length; j++) {
      out += dmCl(letters[j], opts.leet, opts.acc) + '+';
      if (opts.space && j < letters.length - 1) out += '\\s?';
    }
    if (opts.plural && letters[letters.length - 1] !== 's') out += '([s5]|\\b)';
    else if (opts.bnd) out += '\\b';
    return out;
  }
  function dmGen() {
    var opts = {
      space: $('dmSpace').checked,
      leet: $('dmLeet').checked,
      acc: $('dmAcc').checked,
      bnd: $('dmBnd').checked,
      plural: $('dmPlural').checked
    };
    var tokens = String($('dmWords').value || '').split(/[\s,/]+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var r = dmBuild(tokens[i], opts);
      if (r) out.push(r);
    }
    $('dmOut').value = out.join('\n');
    $('dmTestRes').textContent = '';
    if (!out.length) $('dmOut').value = '';
  }
  function dmTest() {
    var res = $('dmTestRes');
    var pat = String($('dmOut').value || '').trim().split('\n')[0];
    var val = $('dmTestInput').value;
    if (!pat) { res.textContent = 'generate a regex first.'; res.style.color = '#9CA3AF'; return; }
    try {
      var re = new RegExp(pat, 'i');
      var m = re.exec(val);
      if (m) { res.textContent = 'MATCH — "' + m[0] + '"'; res.style.color = '#ff6b6b'; }
      else { res.textContent = 'clean — nothing matched'; res.style.color = '#4ade80'; }
    } catch (e) {
      res.textContent = 'invalid regex: ' + e.message; res.style.color = '#ff6b6b';
    }
  }
  function wireDm() {
    var chips = document.querySelectorAll('[data-dmp]');
    chips.forEach(function (b) {
      b.addEventListener('click', function () {
        $('dmWords').value = b.getAttribute('data-w');
        $('dmExc').value = b.getAttribute('data-exc') || '';
        $('dmTestInput').value = '';
        dmGen();
      });
    });
    $('dmWords').addEventListener('input', dmGen);
    $('dmSpace').addEventListener('change', dmGen);
    $('dmLeet').addEventListener('change', dmGen);
    $('dmAcc').addEventListener('change', dmGen);
    $('dmBnd').addEventListener('change', dmGen);
    $('dmPlural').addEventListener('change', dmGen);
    $('dmGen').addEventListener('click', dmGen);
    $('dmCopy').addEventListener('click', function () {
      var v = $('dmOut').value;
      if (!v) return;
      copyPlain(v, function () {});
    });
    $('dmTestRun').addEventListener('click', dmTest);
    $('dmTestInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); dmTest(); }
    });
    if (chips.length) chips[0].click();
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
    wireMs();
    wireCp();
    wireDm();
  }

  wire();
})();
