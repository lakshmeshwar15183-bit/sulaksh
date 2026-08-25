/* Sulaksh Maintenance overlay — polls the API; when maintenance mode is on,
 * non-staff visitors see a full-screen notice with an integrated login form
 * so the owner can sign in and turn the site back on. */
(function () {
  'use strict';

  var API = localStorage.getItem('sulaksh-api') || 'https://sulaksh-backend-production.up.railway.app';

  var CSS = ''
    + '#sgmOverlay{position:fixed;inset:0;z-index:99999;background:linear-gradient(160deg,#0C2340,#123467);'
    + 'display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,sans-serif;}'
    + '.sgm-card{text-align:center;color:#fff;max-width:430px;width:100%;}'
    + '.sgm-ico{font-size:52px;margin-bottom:14px;}'
    + '.sgm-title{font-family:Sora,sans-serif;font-size:26px;font-weight:800;margin-bottom:10px;}'
    + '.sgm-sub{font-size:14.5px;line-height:1.7;color:#cfd9ec;margin-bottom:6px;}'
    + '.sgm-by{font-size:13px;color:#FF9A4D;font-weight:700;margin-bottom:22px;}'
    + '.sgm-form{background:#fff;border-radius:14px;padding:18px;text-align:left;}'
    + '.sgm-form input{width:100%;padding:11px 13px;border:1px solid #E4E9F1;border-radius:9px;'
    + 'font-size:14px;margin-bottom:10px;box-sizing:border-box;font-family:inherit;}'
    + '.sgm-form button{width:100%;padding:12px;background:#0C2340;color:#fff;border:none;'
    + 'border-radius:9px;font-weight:700;font-size:14.5px;cursor:pointer;}'
    + '.sgm-form button:hover{background:#1E5FFF;}'
    + '.sgm-msg{font-size:12.5px;margin-top:8px;min-height:16px;color:#d64545;text-align:center;}';

  function ready(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function isStaff() {
    // Confirm via API — cookie first, stored token as fallback (browsers
    // that block third-party cookies never send the cookie).
    var h = {};
    var t = localStorage.getItem('sulaksh-token');
    if (t) h.Authorization = 'Bearer ' + t;
    return fetch(API + '/api/auth/me', { credentials: 'include', headers: h })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; });
  }

  function showOverlay() {
    if (document.getElementById('sgmOverlay')) return;
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    var ov = document.createElement('div');
    ov.id = 'sgmOverlay';
    ov.innerHTML = ''
      + '<div class="sgm-card">'
      + '  <div class="sgm-ico">🛠️</div>'
      + '  <div class="sgm-title">Site Under Maintenance</div>'
      + '  <div class="sgm-sub">हम जल्द ही वापस आ रहे हैं!<br>We will be back shortly.</div>'
      + '  <div class="sgm-by">— Maintenance by Lakshmeshwar Pandey</div>'
      + '  <form class="sgm-form" id="sgmForm">'
      + '    <input type="email" id="sgmEmail" placeholder="Admin email" autocomplete="username">'
      + '    <input type="password" id="sgmPass" placeholder="Password" autocomplete="current-password">'
      + '    <button type="submit">🔐 Developer Login</button>'
      + '    <div class="sgm-msg" id="sgmMsg"></div>'
      + '  </form>'
      + '</div>';
    document.body.appendChild(ov);

    ov.querySelector('#sgmForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = ov.querySelector('#sgmMsg');
      msg.style.color = '#5B6B80';
      msg.textContent = 'Signing in…';
      fetch(API + '/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: ov.querySelector('#sgmEmail').value.trim(),
          password: ov.querySelector('#sgmPass').value,
        }),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.j.error || 'Login failed.');
          localStorage.setItem('sulaksh-email', res.j.email);
          if (res.j.token) localStorage.setItem('sulaksh-token', res.j.token);
          if (res.j.role) localStorage.setItem('sulaksh-role', res.j.role);
          window.location.reload();
        })
        .catch(function (err) {
          msg.style.color = '#d64545';
          msg.textContent = err.message;
        });
    });
  }

  ready(function () {
    fetch(API + '/api/maintenance-status')
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (!s || !s.enabled) return;
        // Confirm staff status against the API (cookie-based); anyone else
        // sees the login overlay.
        isStaff().then(function (staff) { if (!staff) showOverlay(); });
      })
      .catch(function () {});
  });
})();
