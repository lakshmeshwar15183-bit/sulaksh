// sulaksh-cdn — serves /file/<key> from Backblaze B2 with Cloudflare edge
// caching (Cache API) and graceful error handling.
//
// Replace the code of the `sulaksh-cdn` Worker in the Cloudflare dashboard
// (Workers & Pages → sulaksh-cdn → Edit code) with this file, then Save.
// The B2 secrets (STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY) and the
// vars (STORAGE_BUCKET / CLIENT_ENDPOINT / CLIENT_REGION) stay bound to the
// Worker — only the code changes.
//
// Why this fixes "contact the site owner":
//   - Successful PDFs are cached at the Cloudflare edge for 1 day, so B2 is
//     rarely hit (no more throttling / 5xx from B2).
//   - When B2 does fail, we return a clean 502 instead of letting Cloudflare
//     surface B2's error page inside the <iframe>.

const CACHE_TTL = 86400; // 1 day

// ---------- AWS SigV4 (B2 S3) ----------
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function sha256Hex(data) {
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const uriEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encodePath = (p) => p.split('/').map(uriEncode).join('/');
async function deriveSigningKey(secret, d, region, service) {
  const kDate = await hmac(new TextEncoder().encode('AWS4' + secret), new TextEncoder().encode(d));
  const kRegion = await hmac(kDate, new TextEncoder().encode(region));
  const kService = await hmac(kRegion, new TextEncoder().encode(service));
  return hmac(kService, new TextEncoder().encode('aws4_request'));
}

// Exact SigV4 from the backend's b2.js (proven to work with B2 for GET/HEAD).
async function signedRequest(env, method, key, body = null) {
  const s3Host = (env.B2_S3_HOST || '').replace(/^https?:\/\//, '').split('/')[0];
  const host = s3Host;
  const pathname = `/${env.B2_BUCKET}/${encodePath(key)}`;
  const now = new Date();
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const region = env.B2_REGION || 'us-east-006';
  const service = 's3';
  const scope = `${d}/${region}/${service}/aws4_request`;
  const payloadHash = body ? await sha256Hex(body) : await sha256Hex(new Uint8Array(0));

  const amzHeaders = { 'x-amz-date': amz, 'x-amz-content-sha256': payloadHash };
  const allHeaders = { host, ...amzHeaders };
  const sortedNames = Object.keys(allHeaders).sort();
  const canonicalHeaders = sortedNames.map((k) => `${k}:${allHeaders[k]}`).join('\n') + '\n';
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [method, pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, await sha256Hex(new TextEncoder().encode(canonicalRequest))].join('\n');

  const signingKey = await deriveSigningKey(env.B2_SECRET_KEY, d, region, service);
  const signature = toHex(await hmac(signingKey, new TextEncoder().encode(stringToSign)));
  const auth = `AWS4-HMAC-SHA256 Credential=${env.B2_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `https://${host}${pathname}`, headers: { ...allHeaders, Authorization: auth } };
}

function cleanError(msg) {
  return new Response(msg, {
    status: 502,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*', 'x-sulaksh-cache': 'ERROR' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/file/')) {
      const key = decodeURIComponent(url.pathname.slice('/file/'.length));
      if (!key) return new Response('Not found', { status: 404 });

      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);

      if (request.method === 'GET' || request.method === 'HEAD') {
        const cached = await cache.match(cacheKey);
        if (cached) {
          const h = new Headers(cached.headers);
          h.set('x-sulaksh-cache', 'HIT');
          return new Response(cached.body, { status: cached.status, headers: h });
        }
      }

      let upstream = null;
      const backoff = [0, 500, 1500, 3500];
      for (let attempt = 0; attempt < backoff.length; attempt++) {
        if (backoff[attempt]) await new Promise((r) => setTimeout(r, backoff[attempt]));
        const signed = await signedRequest(env, request.method, key);
        try {
          upstream = await fetch(signed.url, { method: request.method, headers: signed.headers });
        } catch (e) {
          upstream = null;
        }
        if (upstream && upstream.ok) break;
        // Retry on origin throttling/5xx; don't retry hard client errors (e.g. 404).
        if (upstream && upstream.status < 500 && upstream.status !== 429) break;
      }

      if (!upstream || !upstream.ok) {
        return cleanError('The document could not be loaded right now. Please try again shortly.');
      }

      const headers = new Headers(upstream.headers);
      headers.set('access-control-allow-origin', '*');
      headers.set('cache-control', 'public, max-age=' + CACHE_TTL);
      headers.set('x-sulaksh-cache', 'MISS');
      const disp = (new URL(request.url).searchParams.get('disposition') === 'attachment') ? 'attachment' : 'inline';
      const fname = key.split('/').pop();
      headers.set('content-disposition', disp + '; filename="' + fname + '"');

      const response = new Response(upstream.body, { status: upstream.status, headers });
      if (request.method === 'GET' && ctx && ctx.waitUntil) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
      return response;
    }

    return new Response('Not found', { status: 404 });
  },
};
