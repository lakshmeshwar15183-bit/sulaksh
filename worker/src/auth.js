// Auth for Cloudflare Workers.
// - JWTs: HS256 signed/verified with WebCrypto (no external lib).
// - Passwords: PBKDF2-SHA256 via WebCrypto (runs off-thread, NOT counted
//   against the Worker CPU limit — unlike bcrypt). Stored as:
//   pbkdf2$<iterations>$<saltB64>$<hashB64>

import { run, get } from './db.js';

const te = new TextEncoder();

function b64url(input) {
  let str = btoa(String.fromCharCode(...new Uint8Array(input)));
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const b = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b.length % 4 === 0 ? '' : '='.repeat(4 - (b.length % 4));
  const bin = atob(b + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function hmacSig(secret, data) {
  return crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then((k) => crypto.subtle.sign('HMAC', k, data));
}

export async function signJwt(payload, secret, expiresInSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const h = b64url(te.encode(JSON.stringify(header)));
  const p = b64url(te.encode(JSON.stringify(body)));
  const data = te.encode(`${h}.${p}`);
  const sig = b64url(await hmacSig(secret, data));
  return `${h}.${p}.${sig}`;
}

export async function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = b64url(await hmacSig(secret, te.encode(`${h}.${p}`)));
  if (expected !== s) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

const PBKDF2_ITERATIONS = 100000;

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(bits)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('pbkdf2$')) return false;
  const [, iterStr, saltB64, hashB64] = stored.split('$');
  const iterations = parseInt(iterStr, 10) || PBKDF2_ITERATIONS;
  const salt = b64urlDecode(saltB64);
  const keyMaterial = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return b64url(bits) === hashB64;
}

function readCookieHeader(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    cookies[name] = decodeURIComponent(val);
  }
  return cookies;
}

function readTokenFromRequest(request, env) {
  const cookieName = env.ADMIN_COOKIE_NAME || 'sulaksh_admin_token';
  const cookies = readCookieHeader(request.headers.get('cookie'));
  const fromCookie = cookies[cookieName];
  const authz = request.headers.get('authorization') || '';
  const bearer = authz.replace(/^Bearer\s+/i, '').trim();
  return fromCookie || bearer || null;
}

// Full verification: signature + server-side session row + sliding expiry.
async function verifySession(request, env) {
  const token = readTokenFromRequest(request, env);
  if (!token) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || !payload.jti) return null;
  const row = await get(env, 'SELECT * FROM auth_sessions WHERE id = ?', payload.jti);
  if (!row || row.revoked) return null;
  const now = Date.now();
  const expiresMs = new Date(row.expires_at).getTime();
  if (expiresMs < now) return null;
  const idleHours = parseInt(env.AUTH_IDLE_HOURS || '12', 10);
  const half = (idleHours * 3600 * 1000) / 2;
  if (expiresMs - now < half) {
    try {
      await run(
        env,
        'UPDATE auth_sessions SET expires_at = ?, last_seen = ? WHERE id = ?',
        new Date(now + idleHours * 3600 * 1000).toISOString(), new Date(now).toISOString(), row.id
      );
    } catch (_) {}
  }
  return payload;
}

async function requireAdmin(request, env) {
  const payload = await verifySession(request, env);
  if (!payload) return null;
  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role || 'super',
    jti: payload.jti,
  };
}

async function getStaff(request, env) {
  const payload = await verifySession(request, env);
  return payload ? { id: payload.sub, email: payload.email, role: payload.role || 'super' } : null;
}

export { readTokenFromRequest, requireAdmin, getStaff };