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
    // Probe the super-only endpoint ONLY when we already know the visitor is the
    // owner (role populated earlier by sulaksh-auth restore). For everyone else
    // we skip it entirely, so anonymous visitors never hit a 401 and regular
    // admins never hit a 403 — both would log console errors (hurts PageSpeed).
    // The public /api/config (always 200) drives the toggle for non-owner users.
    var auth = window.SulakshAuth;
    var isSuper = !!(auth && auth.st && (auth.st.role === 'super' || auth.st.role === 'owner'));
    window.__isSuper = isSuper;

    function applyConfig() {
      fetch(API + '/api/config', { credentials: 'include' })
        .then(function (c) { return c.json(); })
        .then(function (c) { window.__deletesEnabled = !!(c && c.deletes_enabled); })
        .catch(function () { window.__deletesEnabled = true; }) // fail-open
        .then(apply);
    }

    if (!isSuper) { applyConfig(); return; }

    fetch(API + '/api/admin/deletes', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d) { window.__deletesEnabled = !!d.enabled; apply(); }
        else applyConfig();
      })
      .catch(applyConfig);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
