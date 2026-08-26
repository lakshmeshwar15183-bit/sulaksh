/* Sulaksh shared auth — used by content pages (index, notes, pyq, ...).
 * Responsibilities ONLY:
 *  1. Attach session credentials to API calls (cookie + stored Bearer token)
 *  2. Server-verify the session once per page load and expose the truth
 *
 * It deliberately does NOT decide permissions — each page keeps its own
 * ADMIN_EMAILS / MAINTENANCE_EMAILS lists and handlers. Nothing here can
 * break a page's existing flows: it only adds headers and reports state.
 */
(function () {
  'use strict';
  var API = localStorage.getItem('sulaksh-api') || 'https://sulaksh-backend-production.up.railway.app';

  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf(API) === 0) {
      init = Object.assign({}, init, { credentials: 'include' });
      var tok = localStorage.getItem('sulaksh-token');
      var hdrs = Object.assign({}, (init.headers && !init.headers.forEach) ? init.headers : {});
      if (tok && !hdrs.Authorization) hdrs.Authorization = 'Bearer ' + tok;
      init.headers = hdrs;
    }
    return _fetch(input, init);
  };

  window.SulakshAuth = {
    API: API,
    st: {
      email: null,
      role: null,
      token: localStorage.getItem('sulaksh-token') || null,
      verified: false
    },
    // Verifies the session against the server: cookie first, then the
    // stored token for browsers that block third-party cookies.
    restore: function () {
      var st = this.st;
      function go(headers) {
        return _fetch(API + '/api/auth/me', { credentials: 'include', headers: headers || {} })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      }
      function finish(me) {
        if (me && me.email) {
          st.email = me.email;
          st.role = me.role || null;
          st.verified = true;
          localStorage.setItem('sulaksh-email', me.email);
        } else {
          // No valid session — clear any stale display name.
          st.email = null; st.role = null; st.verified = true;
          localStorage.removeItem('sulaksh-email');
        }
        return st;
      }
      var bearer = st.token ? { Authorization: 'Bearer ' + st.token } : {};
      return go({}).then(function (me) {
        if (me) return finish(me);
        return go(bearer).then(finish);
      });
    }
  };
})();
