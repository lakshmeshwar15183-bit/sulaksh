/* Sulaksh shared auth — used by content pages (index, notes, pyq, ...).
 * Responsibilities ONLY:
 *  1. Attach the HttpOnly session cookie to API calls (so JS never sees the token)
 *  2. Server-verify the session once per page load and expose the truth
 *
 * It deliberately does NOT decide permissions — each page keeps its own
 * handlers. Nothing here can break a page's existing flows: it only adds
 * credentials and reports state.
 *
 * SECURITY: the session token lives ONLY in the HttpOnly cookie set by the
 * API. It is never read from or written to localStorage, and any caller-supplied
 * Authorization (Bearer) header is stripped — so an XSS bug cannot exfiltrate a
 * usable token to an attacker. (A same-browser XSS can still ride the cookie,
 * which is why output encoding + CSP matter; this just removes token theft.)
 */
(function () {
  'use strict';
  var API = localStorage.getItem('sulaksh-api') || 'https://sulaksh-backend-production.up.railway.app';

  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf(API) === 0) {
      // Authenticate with the HttpOnly session cookie. Never send a JS-readable
      // Bearer: strip any caller-supplied Authorization header so a stray one
      // can't leak either.
      init = Object.assign({}, init, { credentials: 'include' });
      if (init.headers && typeof init.headers === 'object' && !init.headers.forEach) {
        delete init.headers.Authorization;
      } else if (init.headers && init.headers.forEach) {
        init.headers.delete('Authorization');
      }
    }
    return _fetch(input, init);
  };

  window.SulakshAuth = {
    API: API,
    st: {
      email: null,
      role: null,
      token: null, // non-secret sentinel (set from server role); real token stays in the cookie
      verified: false
    },
    // Verifies the session against the server using the HttpOnly cookie only.
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
          st.token = me.role || null; // truthy sentinel for UI; not a usable credential
          st.verified = true;
          localStorage.setItem('sulaksh-email', me.email);
        } else {
          // No valid session — clear any stale display name.
          st.email = null; st.role = null; st.token = null; st.verified = true;
          localStorage.removeItem('sulaksh-email');
        }
        return st;
      }
      return go({}).then(finish);
    }
  };
})();
