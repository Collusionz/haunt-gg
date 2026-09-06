/* sync.js — cross-browser site-content sync through Supabase.
   Owner-curated content (gallery / links / projects / friends / phrases)
   and the global view counter live in the site_data table.
   Reads are public (RLS); writes require the vault passcode (security-definer
   RPC site_upsert). Falls back to plain localStorage when offline or when the
   SQL hasn't been run yet, so everything keeps working without the backend. */

(function () {
  if (window.Syn) return;
  var BAKED_URL = 'https://dpjxjnqfqcodxvjvwvhr.supabase.co';
  var BAKED_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwanhqbnFmcWNvZHh2anZ3dmhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNDgxNzksImV4cCI6MjA5MzcyNDE3OX0.G7MVcOcElwNsIC-6I0zqu005X_rvdqmY4BfZRhDm2hk';
  var STORE = { gallery: 'vaultGallery', links: 'vaultLinks', projects: 'vaultProjects', friends: 'vaultFriends', phrases: 'vaultPhrases' };
  var META = 'syn:';

  var client = null, loaded = false, waiters = [];
  function cfg() { var u = localStorage.getItem('supabaseUrl') || BAKED_URL, k = localStorage.getItem('supabaseAnon') || BAKED_KEY; return u && k ? { url: u, key: k } : null; }
  function ensure(cb) {
    if (client) { cb(client); return; }
    if (loaded === true) { cb(null); return; }
    waiters.push(cb);
    if (loaded === 'loading') return;
    loaded = 'loading';
    var c = cfg();
    if (!c) { loaded = true; var w0 = waiters; waiters = []; for (var i0 = 0; i0 < w0.length; i0++) w0[i0](null); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.js';
    s.onload = function () { loaded = true; try { client = window.supabase.createClient(c.url, c.key); } catch (e) {} var w = waiters; waiters = []; for (var i = 0; i < w.length; i++) w[i](client); };
    s.onerror = function () { loaded = true; var w = waiters; waiters = []; for (var i = 0; i < w.length; i++) w[i](null); };
    document.head.appendChild(s);
  }
  function touch(stk) { try { localStorage.setItem(META + stk, String(Date.now())); } catch (e) {} }
  function apply(stk, v) {
    var raw;
    try { raw = JSON.stringify(v); } catch (e) { return false; }
    if (raw === undefined) return false;
    try {
      if (localStorage.getItem(stk) === raw) return false;
      localStorage.setItem(stk, raw); touch(stk);
      return true;
    } catch (e) { return false; }
  }
  function pull(siteKey, cb) {
    ensure(function (c) {
      if (!c) { cb(null); return; }
      c.from('site_data').select('value').eq('key', siteKey).limit(1).then(function (r) {
        if (r.error || !r.data || !r.data.length) { cb(null); return; }
        var row = r.data[0];
        if (row && row.value !== undefined && row.value !== null) cb(row.value);
        else cb(null);
      });
    });
  }
  function pullAll(cb) {
    ensure(function (c) {
      if (!c) { cb({}); return; }
      c.from('site_data').select('key,value').then(function (r) {
        if (r.error) { cb({}); return; }
        var o = {};
        (r.data || []).forEach(function (d) { o[d.key] = d.value; });
        cb(o);
      });
    });
  }
  function push(siteKey, value, pass, cb) {
    ensure(function (c) {
      if (!c) { if (cb) cb(false); return; }
      c.rpc('site_upsert', { dkey: siteKey, dvalue: value, passcode: String(pass || '') }).then(function (r) {
        if (cb) cb(!r.error);
      });
    });
  }
  function reconcileAll(cb) {
    pullAll(function (docs) {
      var any = false;
      for (var siteKey in STORE) {
        if (Object.prototype.hasOwnProperty.call(STORE, siteKey) && docs[siteKey] !== undefined && docs[siteKey] !== null) {
          if (apply(STORE[siteKey], docs[siteKey])) any = true;
        }
      }
      if (cb) cb(any);
    });
  }
  function uploadMissing(pass, cb) {
    ensure(function (c) {
      if (!c) { if (cb) cb(null); return; }
      c.from('site_data').select('key').then(function (r) {
        if (r.error) { if (cb) cb(null); return; }
        var have = {};
        (r.data || []).forEach(function (d) { have[d.key] = true; });
        var pending = [];
        for (var sk in STORE) {
          if (Object.prototype.hasOwnProperty.call(STORE, sk) && !have[sk]) pending.push(sk);
        }
        var i = 0, pushed = false;
        function next() {
          if (i >= pending.length) { if (cb) cb(pushed); return; }
          var siteKey = pending[i++];
          var raw;
          try { raw = localStorage.getItem(STORE[siteKey]); } catch (e) { next(); return; }
          if (!raw || raw === '[]' || raw === '{}') { next(); return; }
          var val;
          try { val = JSON.parse(raw); } catch (e) { next(); return; }
          push(siteKey, val, pass, function (ok) { if (ok) pushed = true; next(); });
        }
        next();
      });
    });
  }
  function addVisit(cb) {
    ensure(function (c) {
      if (!c) { if (cb) cb(null); return; }
      c.rpc('add_visit').then(function (r) {
        if (r.error) { if (cb) cb(null); return; }
        var n = Number(r.data);
        if (isNaN(n)) { if (cb) cb(null); return; }
        try { localStorage.setItem('hauntVisits', String(n)); } catch (e) {}
        if (cb) cb(n);
      });
    });
  }

  // Gallery videos must not be converted to data URLs: localStorage has a
  // roughly 5 MB quota. Uploading to Storage keeps gallery records small and
  // permits files up to the bucket's configured size limit.
  function uploadGalleryMedia(file, cb) {
    ensure(function (c) {
      if (!c || !c.storage || !file) { if (cb) cb('', 'Storage is unavailable'); return; }
      var ext = ((file.name || '').split('.').pop() || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase();
      var name = 'gallery/' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext;
      c.storage.from('gallery-media').upload(name, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
        cacheControl: '31536000'
      }).then(function (r) {
        if (r.error) { if (cb) cb('', r.error.message || 'Upload failed'); return; }
        var publicUrl = c.storage.from('gallery-media').getPublicUrl(name);
        var url = publicUrl && publicUrl.data && publicUrl.data.publicUrl;
        if (cb) cb(url || '', url ? '' : 'Could not create media URL');
      });
    });
  }

  window.Syn = {
    BAKED_URL: BAKED_URL, BAKED_KEY: BAKED_KEY, STORE: STORE,
    pull: pull, pullAll: pullAll, push: push, reconcileAll: reconcileAll,
    uploadMissing: uploadMissing,
    apply: apply, touch: touch, addVisit: addVisit, uploadGalleryMedia: uploadGalleryMedia
  };
})();
