// Cloudflare Worker — proxies /api/* to the Railway backend so the admin
// session cookie is FIRST-PARTY on sulaksh.online. This removes the
// third-party-cookie (Safari ITP / Chrome phase-out) limitation: an admin is
// no longer logged out on page refresh, because the cookie is same-site.
//
// Deploy:  wrangler deploy   (after `wrangler login`)
// Route:   sulaksh.online/api/*  ->  this worker
//
// The backend must also set COOKIE_DOMAIN=.sulaksh.online (Railway env var)
// so the Set-Cookie scopes to the site, not to railway.app.

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

    const init = {
      method: request.method,
      headers,
      redirect: 'follow',
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    };

    const resp = await fetch(target.toString(), init);

    // Pass the backend response straight through, including Set-Cookie.
    const respHeaders = new Headers(resp.headers);
    respHeaders.delete('access-control-allow-origin');
    respHeaders.delete('access-control-allow-credentials');
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: respHeaders });
  },
};
