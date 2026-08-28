// Sulaksh — download-button visibility flag.
// The admin can disable the "Download / Save" buttons site-wide from the
// admin panel. When disabled we hide every element with class `dl-btn`.
// Viewing a file always stays enabled (only the button is hidden).
(function () {
  var API = (location.hostname === 'sulaksh.online' || location.hostname.endsWith('.sulaksh.online') ? location.origin + '/api' : 'https://sulaksh-backend-production.up.railway.app');
  // Default to visible until we know the real setting (fail-open).
  window.__downloadsEnabled = true;

  function apply() {
    var hide = window.__downloadsEnabled === false;
    var nodes = document.querySelectorAll('.dl-btn');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].style.display = hide ? 'none' : '';
    }
  }

  // Watch for material rows being (re)rendered dynamically.
  if (window.MutationObserver) {
    var obs = new MutationObserver(apply);
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  function load() {
    fetch(API + '/api/config')
      .then(function (r) { return r.json(); })
      .then(function (c) {
        window.__downloadsEnabled = !!(c && c.downloads_enabled);
        apply();
      })
      .catch(function () { /* keep default (visible) on error */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
