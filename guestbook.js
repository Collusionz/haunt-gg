/* guestbook.js — shared guestbook overlay for every page.
   Boot: add data-gb to any clickable element (sidebar / mobile nav). Clicking
   opens the overlay. Works without config but retries once the owner saves
   a Supabase connection in /vault. */

(function () {
  if (window.GB) return;
  var BAKED_URL = 'https://dpjxjnqfqcodxvjvwvhr.supabase.co';
  var BAKED_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwanhqbnFmcWNvZHh2anZ3dmhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNDgxNzksImV4cCI6MjA5MzcyNDE3OX0.G7MVcOcElwNsIC-6I0zqu005X_rvdqmY4BfZRhDm2hk';
  var BAD = ['fuck','shit','bitch','cunt','nigger','nigga','faggot','retard','wtf','stfu','dick','pussy','slut','whore','asshole','bastard'];
  var PAGE = 12;
  var sv = function (k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  var ssGet = function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  var ssSet = function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} };
  var ssDel = function (k) { try { sessionStorage.removeItem(k); } catch (e) {} };

  var GB = (window.GB = { configLoaded: false });
  var client = null, scriptLoaded = false, waiters = [];
  var overlay = null, board = null, boards = [];
  var state = {
    items: [], likesBy: {}, liked: {}, loaded: 0, total: 0,
    queue: [], loading: false, hasMore: false
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function config() {
    var u = sv('supabaseUrl', BAKED_URL), k = sv('supabaseAnon', BAKED_KEY);
    return u && k ? { url: u, key: k } : null;
  }
  function liker() {
    var v = sv('gbLiker', '');
    if (!v) { v = 'g_' + Math.random().toString(36).slice(2, 12); try { localStorage.setItem('gbLiker', v); } catch (e) {} }
    return v;
  }
  function ownerPass() { return ssGet('gbOwnerPass') || ''; }
  function profanity(t) {
    var x = ' ' + String(t || '').toLowerCase() + ' ';
    for (var i = 0; i < BAD.length; i++) { if (x.indexOf(' ' + BAD[i] + ' ') !== -1) return BAD[i]; }
    return null;
  }
  function toast(msg) {
    if (typeof window.showToast === 'function') { window.showToast(msg); return; }
    var t = document.getElementById('gbToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'gbToast';
      t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(20px);padding:8px 20px;border-radius:12px;background:rgba(71,100,236,0.92);color:#fff;font-size:0.8rem;font-weight:500;backdrop-filter:blur(8px);z-index:9000;opacity:0;transition:all .3s;pointer-events:none;font-family:Satoshi,sans-serif';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(t._h); t._h = setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(20px)'; }, 2400);
  }

  /* ---------------- supabase client ---------------- */
  function loadClient(cb) {
    if (client) { cb(client); return; }
    if (scriptLoaded) { cb(client); return; }
    waiters.push(cb);
    if (scriptLoaded === true) return;
    scriptLoaded = 'loading';
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.js';
    s.onload = function () {
      var cfg = config();
      scriptLoaded = true;
      try { if (cfg && window.supabase) client = window.supabase.createClient(cfg.url, cfg.key); } catch (e) {}
      var w = waiters; waiters = [];
      for (var i = 0; i < w.length; i++) w[i](client);
    };
    s.onerror = function () { scriptLoaded = true; var w = waiters; waiters = []; for (var i = 0; i < w.length; i++) w[i](null); };
    document.head.appendChild(s);
  }
  GB.getClient = loadClient;
  GB.open = open;
  GB.close = close;
  GB.refresh = refresh;
  GB.rpc = function (name, args, cb) {
    loadClient(function (c) {
      if (!c) { if (cb) cb({ error: true }); return; }
      c.rpc(name, args).then(function (res) { if (cb) cb(res); });
    });
  };

  /* ---------------- data ---------------- */
  function signedIn() { return !!ownerPass(); }
  function myLike(id) { return !!state.liked[id]; }

  function fetchLikes(cb) {
    if (!client) { if (cb) cb(); return; }
    client.from('likes').select('comment_id,liker,is_owner').then(function (res) {
      if (res.error) { if (cb) cb(); return; }
      var by = {}, me = liker(), own = signedIn();
      (res.data || []).forEach(function (r) {
        by[r.comment_id] = (by[r.comment_id] || 0) + 1;
        if (r.liker === me || (own && r.is_owner)) state.liked[r.comment_id] = true;
      });
      state.likesBy = by;
      if (cb) cb();
    });
  }

  function fetchComments(reset, cb) {
    if (!client) { if (cb) cb(false); return; }
    var rangeFrom = reset ? 0 : state.loaded;
    client.from('comments')
      .select('id,name,message,is_anon,created_at,is_verified', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(rangeFrom, rangeFrom + PAGE - 1)
      .then(function (res) {
        if (res.error) { if (cb) cb(false); return; }
        var rows = res.data || [];
        if (reset) { state.items = []; }
        state.items = state.items.concat(rows.map(function (r) {
          return { id: r.id, name: r.name || '', message: r.message || '', is_anon: r.is_anon, created_at: r.created_at, verified: !!r.is_verified };
        }));
        state.total = res.count && res.count !== null ? res.count : state.items.length;
        state.loaded = state.items.length;
        state.hasMore = state.loaded < state.total;
        if (cb) cb(true);
      });
  }

  function refresh(cb) {
    loadClient(function (c) {
      if (!c) { if (cb) cb(); return; }
      state.liked = {}; state.loading = true;
      fetchLikes(function () {
        fetchComments(true, function () {
          state.loading = false;
          renderAll();
          if (cb) cb();
        });
      });
    });
  }

  function more() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    fetchComments(false, function () { state.loading = false; renderAll(); });
  }

  /* ---------------- server actions ---------------- */
  function addLike(id, cb) {
    loadClient(function (c) {
      if (!c) { toast('guestbook not connected'); if (cb) cb(); return; }
      var pass = ownerPass();
      var done = function (ok) { if (cb) cb(ok); };
      if (pass) {
        c.rpc('owner_toggle_like', { cid: id, passcode: pass }).then(function (r) {
          if (r.error) {
            if (String(r.error.message || r.error.details || r.error.hint || '').toLowerCase().indexOf('passcode') !== -1) {
              ssDel('gbOwnerPass'); toast('owner session expired — sign in again');
            } else { toast('could not like'); }
            done(false); return;
          }
          done(true);
        });
      } else {
        c.from('likes').insert({ comment_id: id, liker: liker(), is_owner: false }).then(function (r) {
          if (r.error) { toast('could not like'); done(false); return; }
          done(true);
        });
      }
    });
  }
  function removeLike(id, cb) {
    loadClient(function (c) {
      if (!c) { if (cb) cb(); return; }
      var pass = ownerPass();
      if (pass) {
        c.rpc('owner_toggle_like', { cid: id, passcode: pass }).then(function (r) {
          if (r.error) { toast('could not unlike'); if (cb) cb(false); return; }
          if (cb) cb(true);
        });
      } else {
        c.from('likes').delete().eq('comment_id', id).eq('liker', liker()).then(function (r) {
          if (r.error) { toast('could not unlike'); if (cb) cb(false); return; }
          if (cb) cb(true);
        });
      }
    });
  }
  function toggleLike(id) {
    var was = myLike(id);
    var flip = function () {
      loadClient(function (c) {
        if (!c) { toast('guestbook not connected'); return; }
        fetchLikes(function () { renderAll(); });
      });
    };
    if (was) { removeLike(id, function (ok) { if (ok) { state.liked[id] = false; flip(); } }); }
    else { addLike(id, function (ok) { if (ok) { state.liked[id] = true; flip(); } }); }
  }

  function post(cfg, cb) {
    loadClient(function (c) {
      if (!c) { toast('guestbook not connected'); if (cb) cb(false); return; }
      var pass = ownerPass();
      if (pass) {
        c.rpc('owner_post', { name: cfg.name, message: cfg.message, is_anon: !!cfg.is_anon, passcode: pass }).then(function (r) {
          if (r.error || !r.data) { toast('could not post'); if (cb) cb(false); return; }
          if (cb) cb(true);
        });
      } else {
        c.from('comments').insert({ name: cfg.name, message: cfg.message, is_anon: !!cfg.is_anon }).then(function (r) {
          if (r.error) { toast('could not post — try again'); if (cb) cb(false); return; }
          if (cb) cb(true);
        });
      }
    });
  }
  GB.post = post;

  function del(id) {
    var pass = ownerPass();
    if (!pass) { toast('sign in as owner first'); return; }
    loadClient(function (c) {
      if (!c) { toast('guestbook not connected'); return; }
      c.rpc('delete_comment', { cid: id, passcode: pass }).then(function (r) {
        if (r.error) {
          if (String(r.error.message || r.error.details || '').toLowerCase().indexOf('wrong') !== -1) {
            ssDel('gbOwnerPass'); toast('owner session expired — sign in again');
          } else { toast('delete failed'); }
          return;
        }
        state.items = state.items.filter(function (i) { return i.id !== id; });
        state.total = Math.max(0, state.total - 1); state.loaded = state.items.length;
        renderAll(); toast('deleted');
      });
    });
  }

  function verifyOwner(pass, cb) {
    loadClient(function (c) {
      if (!c) { toast('guestbook not connected'); if (cb) cb(false); return; }
      c.rpc('verify_owner', { passcode: pass }).then(function (r) {
        if (!r.error && r.data === true) { ssSet('gbOwnerPass', pass); if (cb) cb(true); }
        else { if (cb) cb(false); }
      });
    });
  }

  /* ---------------- view helpers ---------------- */
  function fmtDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (e) { return ''; }
  }
  function likeBtn(id, count) {
    var on = myLike(id);
    return '<button type="button" data-gb-like="' + id + '" style="' + LBTN + (on ? ';background:rgba(255,68,102,0.16);border-color:rgba(255,68,102,0.4);color:#ff7a92' : '') + '"' + (on ? ' aria-pressed="true"' : '') + '>' + (on ? '♥' : '♡') + ' <span>' + (count || 0) + '</span></button>';
  }
  function rowHtml(it) {
    var name = it.is_anon ? 'anonymous' : (it.name || 'someone');
    var badge = it.verified ? '<span style="display:inline-flex;align-items:center;gap:3px;margin-left:6px;font-size:0.65rem;font-weight:600;color:#8aa3ff;background:rgba(85,115,244,0.14);border:1px solid rgba(85,115,244,0.3);border-radius:999px;padding:1px 8px">✓ official</span>' : '';
    var delBtn = signedIn() ? '<button type="button" data-gb-del="' + it.id + '" style="' + DBTN + '">delete</button>' : '';
    return '<div class="gb-row" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:12px 14px;margin-bottom:10px">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:3px">' +
      '<div style="min-width:0"><span style="font-size:0.82rem;font-weight:600;color:#9db4ff">' + esc(name) + '</span>' + badge + '</div>' +
      '<span style="font-size:0.68rem;opacity:0.4;flex-shrink:0">' + fmtDate(it.created_at) + '</span></div>' +
      '<div style="font-size:0.88rem;line-height:1.5;word-wrap:break-word;color:rgba(255,255,255,0.9)">' + esc(it.message) + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">' + likeBtn(it.id, state.likesBy[it.id] || 0) + delBtn + '</div>' +
      '</div>';
  }
  var LBTN = 'background:transparent;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.55);border-radius:999px;padding:3px 10px;font-size:0.72rem;font-family:Satoshi,sans-serif;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:5px';
  var DBTN = 'background:transparent;border:1px solid rgba(255,70,85,0.35);color:#ff7a92;border-radius:999px;padding:3px 10px;font-size:0.72rem;font-family:Satoshi,sans-serif;cursor:pointer;transition:all .2s';

  function countsHtml() {
    if (!client) return '';
    var n = state.total;
    var likes = 0; for (var k in state.likesBy) likes += state.likesBy[k];
    return '<div style="display:flex;gap:16px;font-size:0.75rem;opacity:0.55;margin-bottom:12px">' +
      '<span>' + n + ' ' + (n === 1 ? 'message' : 'messages') + '</span>' +
      '<span>' + likes + ' ' + (likes === 1 ? 'like' : 'likes') + '</span></div>';
  }

  function renderOne(root) {
    if (!root) return;
    var counts = root.querySelector('[data-gb-counts]');
    if (counts) counts.innerHTML = countsHtml();
    var list = root.querySelector('[data-gb-list]');
    if (!list) return;
    if (!client) {
      list.innerHTML = '<p style="font-size:0.8rem;opacity:0.4;text-align:center;padding:10px 0">guestbook is disabled — the owner hasn\'t connected it yet.</p>';
      var wrap = root.querySelector('[data-gb-morewrap]'); if (wrap) wrap.style.display = 'none';
      var form = root.querySelector('[data-gb-form]'); if (form) form.style.display = 'none';
      return;
    }
    var form = root.querySelector('[data-gb-form]'); if (form) form.style.display = '';
    var wrap = root.querySelector('[data-gb-morewrap]');
    if (wrap) wrap.style.display = state.hasMore ? '' : 'none';
    if (state.loading && !state.items.length) {
      list.innerHTML = '<div style="text-align:center;padding:18px 0"><div class="gb-spin" style="width:22px;height:22px;margin:0 auto;border:2px solid rgba(255,255,255,0.15);border-top-color:#5573f4;border-radius:50%;animation:gbSpin .8s linear infinite"></div></div>';
      return;
    }
    if (!state.items.length) {
      list.innerHTML = '<p style="font-size:0.8rem;opacity:0.4;text-align:center;padding:10px 0">no messages yet — be the first!</p>';
      return;
    }
    list.innerHTML = state.items.map(rowHtml).join('');
  }
  function renderAll() { for (var i = 0; i < boards.length; i++) renderOne(boards[i]); }
  if (!document.getElementById('gbStyle')) {
    var st = document.createElement('style');
    st.id = 'gbStyle';
    st.textContent = '@keyframes gbSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }

  /* ---------------- overlay shell ---------------- */
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.setAttribute('data-gb-overlay', '1');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:8000;display:none;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:40px 16px;overflow-y:auto';
    overlay.innerHTML =
      '<div style="width:100%;max-width:560px;margin:0 auto">' +
      '<div style="background:#0b0d14;border:1px solid rgba(255,255,255,0.09);border-radius:24px;padding:24px;box-shadow:0 30px 80px rgba(0,0,0,0.6)">' +
      '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:14px">' +
      '<div style="flex:1"><div style="display:flex;align-items:center;gap:10px"><div style="width:4px;height:28px;border-radius:2px;background:linear-gradient(180deg,#5573f4,#4764ec)"></div>' +
      '<h2 style="font-size:1.3rem;font-weight:700;letter-spacing:-0.02em;color:#fff;margin:0">guestbook ✍️</h2></div>' +
      '<p style="font-size:0.78rem;opacity:0.45;margin:4px 0 0">leave a message — no account needed</p></div>' +
      '<button type="button" data-gb-close style="background:transparent;border:0;color:rgba(255,255,255,0.5);font-size:1.3rem;cursor:pointer;line-height:1;padding:4px">×</button></div>' +
      '<div data-gb-counts style="min-height:18px"></div>' +
      '<div data-gb-list></div>' +
      '<div data-gb-morewrap style="text-align:center;margin-top:4px"><button type="button" data-gb-more style="' + LBTN + '">load more</button></div>' +
      '<div data-gb-form style="margin-top:16px;border-top:1px solid rgba(255,255,255,0.07);padding-top:16px">' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px">' +
      '<input type="text" data-gb-name maxlength="24" placeholder="your name" style="flex:1;min-width:150px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:8px 12px;font-size:0.85rem;color:#fff;outline:none" />' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:0.75rem;opacity:0.65;cursor:pointer"><input type="checkbox" data-gb-anon style="accent-color:#5573f4" /> anonymous</label></div>' +
      '<textarea data-gb-msg maxlength="280" rows="3" placeholder="say something nice…" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:10px 12px;font-size:0.85rem;color:#fff;outline:none;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px">' +
      '<span data-gb-count style="font-size:0.7rem;opacity:0.35">0/280</span>' +
      '<button type="button" data-gb-post style="background:linear-gradient(90deg,#5573f4,#4764ec);color:#fff;border:0;border-radius:10px;padding:8px 20px;font-size:0.85rem;font-weight:600;cursor:pointer;font-family:Satoshi,sans-serif">Post</button></div>' +
      '</div></div></div>';
    document.body.appendChild(overlay);
    var panel = overlay.firstChild.firstChild;
    bindAnon(panel);
    if (boards.indexOf(panel) === -1) boards.push(panel);
    board = panel;
    return overlay;
  }
  function bindAnon(root) {
    if (!root) return;
    var name = root.querySelector('[data-gb-name]');
    var anon = root.querySelector('[data-gb-anon]');
    if (anon && !anon.getAttribute('data-gb-anon-bound')) {
      anon.setAttribute('data-gb-anon-bound', '1');
      anon.addEventListener('change', function () {
        if (name) name.style.display = anon.checked ? 'none' : '';
      });
    }
  }
  function registerBoards() {
    var els = document.querySelectorAll('[data-gb-board]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute('data-gb-board-bound')) continue;
      els[i].setAttribute('data-gb-board-bound', '1');
      if (boards.indexOf(els[i]) === -1) boards.push(els[i]);
      bindAnon(els[i]);
    }
  }
  function open() {
    var o = ensureOverlay();
    o.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    refresh();
  }
  function close() {
    if (!overlay) return;
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  /* ---------------- delegation ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target;
    var o = overlay && overlay.style.display !== 'none' ? overlay : document.body;
    var el, aid;
    if ((el = t.closest ? t.closest('[data-gb-like]') : null)) {
      aid = el.getAttribute('data-gb-like');
      toggleLike(parseInt(aid, 10));
      return;
    }
    if ((el = t.closest ? t.closest('[data-gb-del]') : null)) {
      aid = el.getAttribute('data-gb-del');
      del(parseInt(aid, 10));
      return;
    }
    if ((el = t.closest ? t.closest('[data-gb-more]') : null)) { more(); return; }
    if ((el = t.closest ? t.closest('[data-gb-close]') : null)) { close(); return; }
    if (overlay && e.target === overlay) { close(); return; }
    if ((el = t.closest ? t.closest('[data-gb-post]') : null)) {
      var broot = t.closest ? (t.closest('[data-gb-board]') || overlay) : overlay;
      var msgEl = broot.querySelector('[data-gb-msg]');
      var nameEl = broot.querySelector('[data-gb-name]');
      var anonEl = broot.querySelector('[data-gb-anon]');
      var msg = msgEl ? msgEl.value.trim() : '';
      if (!msg) { toast('write a message first'); return; }
      var bad = profanity(msg);
      if (bad) { toast('that word is not allowed'); return; }
      var anon = anonEl ? anonEl.checked : false;
      var name = anon ? '' : (nameEl ? nameEl.value.trim() : '');
      if (!anon && !name) { toast('add your name or check anonymous'); return; }
      post({ name: name, message: msg, is_anon: anon }, function (ok) {
        if (!ok) return;
        if (msgEl) msgEl.value = '';
        if (nameEl) nameEl.value = '';
        if (anonEl) anonEl.checked = false;
        toast('posted');
        refresh();
      });
      return;
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay && overlay.style.display !== 'none') close(); });

  /* ---------------- bootstrap ---------------- */
  function attachSidebarBoot() {
    var els = document.querySelectorAll('[data-gb]');
    for (var i = 0; i < els.length; i++) {
      if (!els[i].getAttribute('data-gb-bound')) {
        els[i].setAttribute('data-gb-bound', '1');
        els[i].style.cursor = 'pointer';
        els[i].addEventListener('click', function (ev) { ev.preventDefault(); open(); });
      }
    }
  }
  function guestbookBootstrap() {
    attachSidebarBoot();
    registerBoards();
    loadClient(function (c) { GB.configLoaded = true; refresh(); });
  }
  window.guestbookBootstrap = guestbookBootstrap;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', guestbookBootstrap);
  } else {
    guestbookBootstrap();
  }
})();