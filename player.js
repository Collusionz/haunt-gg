/* Home-page entry music. Deliberately has no persistent mini-player UI. */
(function () {
  'use strict';

  // The entry gate belongs only to a direct visit to the home page. Sidebar
  // navigation must never make visitors click Enter again.
  var isHome = window.location.pathname === '/' || window.location.pathname === '/index.html';
  if (!isHome) return;

  var tracks = [
    '/audio/song-1.mp3',
    '/audio/song-2.mp3',
    '/audio/mystery-of-love.mp3'
  ];
  var audio = new Audio(tracks[Math.floor(Math.random() * tracks.length)]);
  audio.preload = 'auto';
  audio.loop = false;
  try {
    var volume = parseFloat(localStorage.getItem('hzVol'));
    if (isFinite(volume) && volume >= 0 && volume <= 1) audio.volume = volume;
  } catch (e) {}
  audio.addEventListener('volumechange', function () {
    try { localStorage.setItem('hzVol', audio.volume); } catch (e) {}
  });

  function showEntry() {
    if (document.getElementById('hzEnter')) return;
    var overlay = document.createElement('button');
    overlay.id = 'hzEnter';
    overlay.type = 'button';
    overlay.setAttribute('aria-label', 'Enter site and play music');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;' +
      'border:0;background:rgba(6,8,14,0.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
      'color:#f4f7f8;font-family:"Satoshi",sans-serif;font-size:3rem;font-weight:700;letter-spacing:0.18em;' +
      'text-transform:lowercase;text-shadow:0 0 24px rgba(85,115,244,0.8);cursor:pointer;transition:opacity .5s ease';
    overlay.textContent = 'enter';
    overlay.addEventListener('click', function () {
      overlay.style.opacity = '0';
      setTimeout(function () { overlay.remove(); }, 520);
      audio.play().catch(function () {});
    }, { once: true });
    document.body.appendChild(overlay);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showEntry);
  else showEntry();
})();
