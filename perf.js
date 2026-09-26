(function () {
  'use strict';
  // Lazy-load images that don't have loading=lazy
  document.querySelectorAll('img:not([loading])').forEach(function (img) {
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
  });
  // Preload critical assets for faster navigation
  var preloadLink = document.createElement('link');
  preloadLink.rel = 'preload';
  preloadLink.href = '/audio/song-1.mp3';
  preloadLink.as = 'audio';
  document.head.appendChild(preloadLink);
  // Pause background video when tab hidden (saves CPU/GPU on low-end)
  document.addEventListener('visibilitychange', function () {
    var v = document.getElementById('bgVideo');
    if (!v) return;
    if (document.visibilityState === 'hidden') { v.pause(); } else { v.play().catch(function () {}); };
  });
})();
