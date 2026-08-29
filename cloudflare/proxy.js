// Cloudflare Worker — proxies /api/* to the Railway backend so the admin
// session cookie is FIRST-PARTY on sulaksh.online. This removes the
// third-party-cookie (Safari ITP) logout-on-refresh.
//
// Deploy:  wrangler login   (browser auth)
//          wrangler deploy  (route sulaksh.online/api/* is in wrangler.toml)
//
// The backend sets a Secure; SameSite=None; HttpOnly cookie scoped to
// railway.app. Because the browser is on sulaksh.online, that cookie would be
// rejected as cross-site, so we rewrite its Domain to .sulaksh.online and add
// the Partitioned attribute. No backend redeploy is required.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api')) {
      return new Response('Not found', { status: 404 });
    }

    const backend = (env.BACKEND_URL || 'https://sulaksh-backend-production.up.railway.app').replace(/\/$/, '');
    const target = new URL(backend + url.pathname + url.search);

    // Forward the request verbatim (cookies, auth, body). The browser's Origin
    // stays sulaksh.online, which is already in the backend's CORS_ORIGINS, so
    // the backend CSRF guard is satisfied.
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.set('x-forwarded-host', url.host);
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

    const init = {
      method: request.method,
      headers,
      redirect: 'follow',
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    };

    const resp = await fetch(target.toString(), init);

    // Pass the backend response through, but rewrite the session cookie so it
    // is first-party on sulaksh.online (Safari/ITP safe).
    const out = new Headers(resp.headers);
    out.delete('access-control-allow-origin');
    out.delete('access-control-allow-credentials');

    const setCookies = typeof resp.headers.getSetCookie === 'function'
      ? resp.headers.getSetCookie()
      : [resp.headers.get('set-cookie')].filter(Boolean);
    out.delete('set-cookie');

    for (const sc of setCookies) {
      let c = sc.replace(/;\s*domain=[^;]+/i, '');
      c = c.replace(/domain=[^;]+/i, '');
      c += '; Domain=.sulaksh.online';
      if (!/;\s*secure/i.test(c)) c += '; Secure';
      if (!/;\s*samesite=/i.test(c)) c += '; SameSite=None';
      if (!/;\s*partitioned/i.test(c)) c += '; Partitioned';
      out.append('Set-Cookie', c);
    }

    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: out });
  },
};
