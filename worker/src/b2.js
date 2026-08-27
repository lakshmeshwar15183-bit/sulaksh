// Minimal S3-compatible (Backblaze B2) client for Cloudflare Workers.
// Implements AWS Signature Version 4 directly with WebCrypto so no external
// SDK is needed. Used for upload, delete, head, and presigned GET.

async function hmac(key, data) {
  const k = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, data);
  return new Uint8Array(sig);
}

async function sha256Hex(data) {
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function dateStamp(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}
function amzDateTime(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}
function uriEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function encodePath(pathname) {
  return pathname.split('/').map(uriEncode).join('/');
}

async function deriveSigningKey(secret, dateStamp, region, service) {
  const kDate = await hmac(new TextEncoder().encode('AWS4' + secret), new TextEncoder().encode(dateStamp));
  const kRegion = await hmac(kDate, new TextEncoder().encode(region));
  const kService = await hmac(kRegion, new TextEncoder().encode(service));
  return hmac(kService, new TextEncoder().encode('aws4_request'));
}

function objectPath(env, key) {
  return `/${env.STORAGE_BUCKET}/${encodePath(key)}`;
}

/**
 * Build a fully SigV4-signed fetch request for an object operation.
 * Returns { url, headers } ready for fetch().
 */
async function signedOp(env, method, key, body = null, extraHeaders = {}) {
  const host = new URL(env.CLIENT_ENDPOINT).host;
  const pathname = objectPath(env, key);
  const now = new Date();
  const d = dateStamp(now);
  const amz = amzDateTime(now);
  const region = env.CLIENT_REGION || 'us-east-1';
  const service = 's3';
  const scope = `${d}/${region}/${service}/aws4_request`;
  const payloadHash = body ? await sha256Hex(body) : await sha256Hex(new Uint8Array(0));

  const amzHeaders = { 'x-amz-date': amz, 'x-amz-content-sha256': payloadHash };
  const allHeaders = { host, ...extraHeaders, ...amzHeaders };
  const sortedNames = Object.keys(allHeaders).sort();
  const canonicalHeaders = sortedNames.map((k) => `${k}:${allHeaders[k]}`).join('\n') + '\n';
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [method, pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256', amz, scope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join('\n');

  const signingKey = await deriveSigningKey(env.STORAGE_SECRET_ACCESS_KEY, d, region, service);
  const signature = toHex(await hmac(signingKey, new TextEncoder().encode(stringToSign)));
  const auth = `AWS4-HMAC-SHA256 Credential=${env.STORAGE_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}${pathname}`,
    headers: { ...allHeaders, Authorization: auth },
  };
}

export async function uploadObject(env, key, buffer, contentType) {
  const { url, headers } = await signedOp(env, 'PUT', key, buffer, { 'content-type': contentType });
  const res = await fetch(url, { method: 'PUT', headers, body: buffer });
  if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
}

export async function deleteObject(env, key) {
  const { url, headers } = await signedOp(env, 'DELETE', key);
  const res = await fetch(url, { method: 'DELETE', headers });
  if (res.status === 404 || res.status === 204 || res.ok) {
    return { deleted: true, alreadyGone: res.status === 404 };
  }
  throw new Error(`S3 delete failed (${res.status})`);
}

export async function objectExists(env, key) {
  const { url, headers } = await signedOp(env, 'HEAD', key);
  const res = await fetch(url, { method: 'HEAD', headers });
  if (res.ok) return true;
  if (res.status === 404) return false;
  throw new Error(`S3 head failed (${res.status})`);
}

export async function getPresignedDownloadUrl(env, key, { fileName = 'document.pdf', disposition = 'inline', contentType = 'application/pdf', expiresIn = 300 } = {}) {
  const safeName = fileName.replace(/"/g, '');
  const pathname = objectPath(env, key);
  const host = new URL(env.CLIENT_ENDPOINT).host;
  const now = new Date();
  const d = dateStamp(now);
  const amz = amzDateTime(now);
  const region = env.CLIENT_REGION || 'us-east-1';
  const service = 's3';
  const scope = `${d}/${region}/${service}/aws4_request`;

  const pm = new Map([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${env.STORAGE_ACCESS_KEY_ID}/${scope}`],
    ['X-Amz-Date', amz],
    ['X-Amz-Expires', String(Math.floor(expiresIn))],
    ['X-Amz-SignedHeaders', 'host'],
    ['response-content-disposition', `${disposition}; filename="${safeName}"`],
    ['response-content-type', contentType],
  ]);
  const sortedKeys = [...pm.keys()].sort();
  const canonicalQuery = sortedKeys.map((k) => `${uriEncode(k)}=${uriEncode(pm.get(k))}`).join('&');

  const canonicalRequest = ['GET', pathname, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, await sha256Hex(new TextEncoder().encode(canonicalRequest))].join('\n');

  const signingKey = await deriveSigningKey(env.STORAGE_SECRET_ACCESS_KEY, d, region, service);
  const signature = toHex(await hmac(signingKey, new TextEncoder().encode(stringToSign)));

  const sp = new URLSearchParams(pm);
  sp.set('X-Amz-Signature', signature);
  return `${host}${pathname}?${sp.toString()}`;
}