/* toggles.js — handles page visibility toggles from the vault */
(function() {
  'use strict';

  var ACQ_TOGGLE_KEY = 'vaultAcquaintancesEnabled';

  function updateNavVisibility() {
    var acqEnabled = localStorage.getItem(ACQ_TOGGLE_KEY);
    // Default to true if not set
    var showAcq = acqEnabled !== 'false';

    // Update both desktop and mobile nav
    var navLinks = document.querySelectorAll('a[href="/acquaintances"]');
    navLinks.forEach(function(link) {
      if (showAcq) {
        link.style.display = '';
      } else {
        link.style.display = 'none';
      }
    });
  }

  // Run on load
  updateNavVisibility();

  // Listen for changes from other tabs/windows
  window.addEventListener('storage', function(e) {
    if (e.key === ACQ_TOGGLE_KEY || e.key === 'vaultSyncTrigger') {
      updateNavVisibility();
    }
  });

  // Also run after soft navigation (nav.js body swap)
  if (window.__navPermEventListener) {
    window.__navPermEventListener(document, 'nav:mounted', updateNavVisibility);
  }

  // Expose for manual refresh
  window.__updateNavVisibility = updateNavVisibility;
})();
