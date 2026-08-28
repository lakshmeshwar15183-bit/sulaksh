// Sulaksh — material-delete visibility flag.
// The site owner (super account) can disable the "Delete" option for the
// regular admins site-wide. When disabled we hide every delete control with
// class `del-btn` (material rows), `del-subject-btn` (subject folders) or
// `del-material-btn` (admin dashboard). The super/owner account always keeps
// the delete option regardless of this setting. The backend also enforces the
// gate (403), so this is purely the UX layer.
(function () {
  var API = 'https://sulaksh-backend-production.up.railway.app';
  window.__deletesEnabled = true; // fail-open default
  window.__isSuper = false;

  function apply() {
    // Super account is never affected by the toggle.
    var hide = window.__deletesEnabled === false && !window.__isSuper;
    var nodes = document.querySelectorAll('.del-btn, .del-subject-btn, .del-material-btn');
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
    // Determine whether the current user is the super/owner account by hitting
    // the super-only endpoint. It returns 200 (+ enabled state) for the owner,
    // 403 for a regular admin, 401 if not logged in. Cookie auth is sent
    // automatically; token-auth pages attach the Bearer header.
    var headers = {};
    var token = localStorage.getItem('sulaksh-token');
    if (token) headers.Authorization = 'Bearer ' + token;
    fetch(API + '/api/admin/deletes', { credentials: 'include', headers: headers })
      .then(function (r) {
        if (r.ok) {
          window.__isSuper = true;
          return r.json().then(function (d) { window.__deletesEnabled = !!d.enabled; apply(); });
        }
        // Not the owner (or not logged in): fall back to the public config flag.
        window.__isSuper = false;
        return fetch(API + '/api/config').then(function (c) { return c.json(); }).then(function (c) {
          window.__deletesEnabled = !!(c && c.deletes_enabled);
          apply();
        });
      })
      .catch(function () {
        window.__isSuper = false;
        window.__deletesEnabled = true; // fail-open
        apply();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
