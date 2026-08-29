/* Sulaksh shared auth — used by content pages (index, notes, pyq, du, ...).
 *
 * The site is served from sulaksh.online while the API lives on railway.app,
 * so the session cookie is THIRD-PARTY. Many browsers (and all Safari/Firefox
 * without CHIPS support) drop or refuse to send that cookie, which is exactly
 * why a refresh/back used to log users out.
 *
 * To make auth reliable cross-site we use the Bearer token the backend already
 * returns in the login response: it is persisted in localStorage and sent as
 * `Authorization: Bearer` on every API call. The HttpOnly cookie is kept as a
 * harmless same-credentials fallback (the backend accepts either), but the
 * token in localStorage is what actually keeps the session alive across
 * reloads, back/forward, and across browsers that block third-party cookies.
 *
 * Trade-off: a token in localStorage is readable by JS, so a same-origin XSS
 * could steal it. The login response already exposes the token to JS, and the
 * backend requires it for admin actions, so this matches the existing trust
 * boundary; pair it with strict output encoding + a CSP (see notes). The
 * alternative — a first-party proxy for /api — would let us go back to a
 * pure HttpOnly cookie, which is more XSS-resistant.
 */
(function () {
  'use strict';
  var API = localStorage.getItem('sulaksh-api') ||
    'https://sulaksh-backend-production.up.railway.app';
  var TOKEN_KEY = 'sulaksh-token';

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  // Original fetch, captured before we patch it.
  var _fetch = window.fetch ? window.fetch.bind(window) : null;

  function injectHeaders(init) {
    init = init || {};
    var headers = new Headers(init.headers || {});
    var t = getToken();
    if (t) headers.set('Authorization', 'Bearer ' + t);
    return Object.assign({}, init, { credentials: 'include', headers: headers });
  }

  function endsWith(haystack, needle) {
    return haystack.indexOf(needle, haystack.length - needle.length) !== -1;
  }

  window.fetch = function (input, init) {
    if (!_fetch) return fetch(input, init);
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var useAuth = url.indexOf(API) === 0;
    var finalInit = useAuth ? injectHeaders(init) : init;

    return _fetch(input, finalInit).then(function (resp) {
      var isLogin = endsWith(url, '/api/auth/login');
      var isLogout = endsWith(url, '/api/auth/logout');
      var isMe = endsWith(url, '/api/auth/me');

      // Capture the token from a successful login BEFORE the caller's
      // res.json() continues, so the very next /api/auth/me carries it.
      if (useAuth && isLogin && resp.ok) {
        return resp.clone().json().then(function (d) {
          if (d && d.token) setToken(d.token);
          return resp;
        }).catch(function () { return resp; });
      }

      if (useAuth && isLogout && resp.ok) setToken(null);

      // ONLY a failed session check (/api/auth/me -> 401) means the session is
      // truly dead. A 401 from any other endpoint (rate-limit, missing
      // permission, transient network blip) must NEVER drop the session — doing
      // so was logging users out on navigation / section changes for no reason.
      if (useAuth && isMe && resp.status === 401) {
        setToken(null);
        try { window.dispatchEvent(new Event('sulaksh:unauthenticated')); } catch (e) {}
      }
      return resp;
    });
  };

  window.SulakshAuth = {
    API: API,
    getToken: getToken,
    setToken: setToken,
    clear: function () { setToken(null); },
    st: { email: null, role: null, token: null, verified: false },
    // Server-verify the session using the persisted Bearer token.
    restore: function () {
      var st = this.st;
      var t = getToken();
      st.verified = false;
      if (!_fetch) { st.verified = true; return Promise.resolve(st); }
      // Anonymous visitors have no token: don't hit /api/auth/me (it 401s and
      // logs a console error). Treat as logged-out without a network request.
      if (!t) { st.verified = true; return Promise.resolve(st); }
      var headers = { Authorization: 'Bearer ' + t };
      return _fetch(API + '/api/auth/me', { credentials: 'include', headers: headers })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (me) {
          if (me && me.email) {
            st.email = me.email;
            st.role = me.role || null;
            st.token = me.role || null; // truthy sentinel for UI
            st.verified = true;
            try { localStorage.setItem('sulaksh-email', me.email); } catch (e) {}
          } else {
            st.email = null; st.role = null; st.token = null; st.verified = true;
            setToken(null);
            try { localStorage.removeItem('sulaksh-email'); } catch (e) {}
          }
          return st;
        })
        .catch(function () { st.verified = true; return st; });
    }
  };
})();
