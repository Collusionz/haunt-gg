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

  /* ---------- events ---------- */
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

    // tabs (only activator required on this page; yt stays disabled)
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
  }

  wire();
})();
