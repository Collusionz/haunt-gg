(function () {
  'use strict';
  var vaultBg = null;
  try { vaultBg = localStorage.getItem('vaultBg') || null; } catch (e) {}

  var bgVideo = document.getElementById('bgVideo');

  function findBgVideo() {
    if (document.getElementById('bgVideo')) return document.getElementById('bgVideo');
    if (document.getElementById('bg-video')) return document.getElementById('bg-video');
    var cls = document.querySelector('video.bg-video');
    if (cls) return cls;
    var wrap = document.querySelector('.pointer-events-none.fixed.inset-0 video');
    if (wrap) return wrap;
    return null;
  }

  function paintStarfield() {
    var canvas = document.getElementById('bgCanvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'bgCanvas';
      canvas.setAttribute('style', 'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none');
      document.body.insertBefore(canvas, document.body.firstChild);
    }
    var ctx = canvas.getContext('2d');
    var W, H;
    var stars = [];
    var layerCounts = [70, 50, 25]; // far, mid, near
    var speeds = [0.04, 0.12, 0.28];
    var sizes = [1, 1.6, 2.4];
    var alphas = [0.35, 0.6, 0.95];

    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      var dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function makeStars() {
      stars = [];
      for (var l = 0; l < layerCounts.length; l++) {
        for (var i = 0; i < layerCounts[l]; i++) {
          stars.push({
            x: Math.random() * W,
            y: Math.random() * H,
            layer: l,
            r: sizes[l] * (0.5 + Math.random()),
            baseA: alphas[l] * (0.6 + Math.random() * 0.4),
            tw: Math.random() * Math.PI * 2,
            tws: 0.5 + Math.random() * 1.5
          });
        }
      }
    }

    function frame() {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        s.y -= speeds[s.layer];
        if (s.y < -4) { s.y = H + 4; s.x = Math.random() * W; }
        s.tw += s.tws * 0.016;
        var a = s.baseA * (0.7 + 0.3 * Math.sin(s.tw));
        ctx.globalAlpha = a;
        ctx.fillStyle = '#cdd6ff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }

    resize();
    makeStars();
    window.addEventListener('resize', function () { resize(); makeStars(); });
    frame();
  }

  if (vaultBg) {
    var v = findBgVideo();
    if (v) {
      v.loop = true; v.muted = true; v.playsInline = true;
      var kids = v.querySelectorAll('source');
      for (var i = 0; i < kids.length; i++) kids[i].remove();
      v.src = vaultBg;
      v.style.display = '';
      v.style.opacity = '0.6';
      v.play().catch(function () {});
    } else {
      v = document.createElement('video');
      v.id = 'bgVideo';
      v.src = vaultBg;
      v.loop = true; v.muted = true; v.playsInline = true; v.autoplay = true;
      v.setAttribute('style', 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.6;z-index:-1;pointer-events:none');
      document.body.insertBefore(v, document.body.firstChild);
      v.play().catch(function () {});
    }
  } else {
    var hidden = findBgVideo();
    if (hidden) hidden.style.display = 'none';
    paintStarfield();
  }
})();