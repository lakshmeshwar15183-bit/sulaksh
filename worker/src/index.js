// SULAKSH backend for Cloudflare Workers + D1 + Backblaze B2.
// Single entrypoint; routes are matched manually to stay dependency-light.

import { all, get, raw, run, getSetting, setSetting, logAuthEvent } from './db.js';
import { requireAdmin, getStaff, signJwt, verifyJwt, hashPassword, verifyPassword, readTokenFromRequest } from './auth.js';
import {
  uploadObject, deleteObject, getPresignedDownloadUrl,
} from './b2.js';
import { parseMultipart } from './multipart.js';
import { stampPdf } from './stamp.js';
import {
  maxFileSizeBytes, randomUuid, sanitizeFileName, buildObjectKey, detectFileType, validateUpload,
} from './validate.js';

// ---- helpers ----
const enc = new TextEncoder();
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}
function nowIso() { return new Date().toISOString(); }
function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || 'unknown';
}
function cookieHeader(name, value, isSecure) {
  const secureFlag = isSecure ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=None${secureFlag}; Max-Age=${30 * 24 * 60 * 60}`;
}
function clearCookieHeader(name) {
  return `${name}=; Path=/; HttpOnly; SameSite=None; Max-Age=0`;
}

// ---- In-memory rate limiting (per-isolate). Cloudflare's own rate-limiting
// rules are the durable layer; these are a defense-in-depth for login abuse
// and general API ceilings on a single edge.
const loginIp = new Map(); // ip -> {count, resetAt}
const loginEmail = new Map(); // email -> {count, resetAt}
function addLocked(map, key, limit) {
  const now = Date.now();
  const rec = map.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  rec.count++;
  map.set(key, rec);
  if (map.size > 20000) { // bounded
    for (const [k, v] of map) if (v.resetAt < now) map.delete(k);
  }
  return rec.count >= limit;
}
function isLocked(map, key) {
  const rec = map.get(key);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) { map.delete(key); return false; }
  return true;
}
function clearKey(map, key) { map.delete(key); }

function escapeLike(s) {
  return `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

const PUBLIC_FIELDS = [
  'id', 'title', 'exam', 'category', 'subject', 'track', 'semester', 'material_category',
  'year', 'description', 'file_name', 'file_size', 'content_type',
  'is_imp', 'is_syllabus', 'is_pyq', 'created_at', 'updated_at',
].join(', ');

function maintenanceEnabled(env) {
  return getSetting(env, 'maintenance_mode').then((v) => v === '1');
}

// ============================= ROUTES =============================
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  // ---- CORS preflight ----
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  // ---- CORS enforcement ----
  const allowedOrigins = (env.CORS_ORIGINS || '')
    .split(',').map((o) => o.trim()).filter(Boolean);
  const origin = request.headers.get('origin');
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    return json({ error: 'Origin not allowed.' }, 403);
  }

  let response;
  try {
    response = await dispatch(request, env, method, path, url);
  } catch (err) {
    console.error('[worker] error:', err && err.stack ? err.stack : err);
    response = json({ error: 'Something went wrong.' }, 500);
  }
  for (const [k, v] of Object.entries(corsHeaders(request))) {
    response.headers.set(k, v);
  }
  return response;
}

function corsHeaders(request) {
  const origin = request.headers.get('origin');
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type, x-setup-key',
    'vary': 'Origin',
  };
}

async function dispatch(request, env, method, path, url) {
  // ---- Public read endpoints (no auth) ----
  if (method === 'GET' && path === '/api/health') {
    return json({ ok: true, time: new Date().toISOString() });
  }
  if (method === 'GET' && path === '/api/maintenance-status') {
    return json({ enabled: (await getSetting(env, 'maintenance_mode')) === '1' });
  }

  // ---- /api/auth ----
  if (path.startsWith('/api/auth')) return routeAuth(request, env, method, path, url);
  // ---- /api/admin ----
  if (path.startsWith('/api/admin')) return routeAdmin(request, env, method, path, url);
  // ---- /api/materials ----
  if (path.startsWith('/api/materials')) return routeMaterials(request, env, method, path, url);
  // ---- /api/subjects ----
  if (path.startsWith('/api/subjects')) return routeSubjects(request, env, method, path, url);

  return json({ error: 'Not found.' }, 404);
}

// ------------------- /api/materials -------------------
async function routeMaterials(request, env, method, path, url) {
  if (method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  const staff = await getStaff(request, env);
  const maintenance = await maintenanceEnabled(env);
  if (maintenance && !staff) return json({ maintenance: true }, 503);

  // GET /api/materials/:id/download  (must match before :id)
  const dl = /^\/api\/materials\/([^/]+)\/download$/.exec(path);
  if (dl) {
    const material = await get(
      env, 'SELECT * FROM materials WHERE id = ? AND status = ?', dl[1], 'active'
    );
    if (!material) return json({ error: 'Material not found.' }, 404);
    const disposition = url.searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline';
    const cdnBase = env.PUBLIC_CDN_BASE;
    if (cdnBase && material.r2_object_key) {
      const encodedKey = material.r2_object_key.split('/').map(encodeURIComponent).join('/');
      const sp = new URLSearchParams();
      const safeName = material.file_name ? material.file_name.replace(/"/g, '') : 'document.pdf';
      sp.set('response-content-disposition', `${disposition}; filename="${safeName}"`);
      return json({ url: `${cdnBase}/file/${encodedKey}?${sp.toString()}`, cdn: true });
    }
    try {
      const url2 = await getPresignedDownloadUrl(env, material.r2_object_key, {
        fileName: material.file_name,
        disposition,
        contentType: material.content_type,
      });
      return json({ url: url2, expires_in: parseInt(env.PRESIGNED_URL_EXPIRY_SECONDS || '300', 10) });
    } catch (err) {
      console.error('[materials] presign error', material.id, err);
      return json({ error: 'Could not generate a download link right now. Please try again.' }, 502);
    }
  }

  // GET /api/materials/:id
  const one = /^\/api\/materials\/([^/]+)$/.exec(path);
  if (one) {
    const row = await get(
      env, `SELECT ${PUBLIC_FIELDS} FROM materials WHERE id = ? AND status = ?`, one[1], 'active'
    );
    if (!row) return json({ error: 'Material not found.' }, 404);
    return json({ material: row });
  }

  // GET /api/materials?filters
  const q = url.searchParams;
  const clauses = ["status = 'active'"];
  const params = [];
  for (const f of ['exam', 'category', 'subject', 'track', 'semester', 'material_category', 'year']) {
    if (q.get(f)) { clauses.push(`${f} = ?`); params.push(q.get(f)); }
  }
  if (q.get('q')) {
    const like = escapeLike(q.get('q'));
    clauses.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  const where = clauses.join(' AND ');
  let limit = parseInt(q.get('limit') || '0', 10);
  limit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 0;
  const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1);

  if (limit) {
    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM materials WHERE ${where}`
    ).bind(...params).all();
    const total = results.length ? results[0].c : 0;
    const rows = await all(
      env,
      `SELECT ${PUBLIC_FIELDS} FROM materials WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params, limit, (page - 1) * limit
    );
    return json({ materials: rows, page, limit, total });
  }

  const rows = await all(
    env,
    `SELECT ${PUBLIC_FIELDS} FROM materials WHERE ${where} ORDER BY created_at DESC LIMIT 5000`,
    ...params
  );
  return json({ materials: rows });
}

// --------------------------- /api/subjects -------------------
async function routeSubjects(request, env, method, path, url) {
  if (method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const staff = await getStaff(request, env);
  if ((await maintenanceEnabled(env)) && !staff) return json({ maintenance: true }, 503);

  const q = url.searchParams;
  const clauses = [];
  const params = [];
  if (q.get('exam')) { clauses.push('exam = ?'); params.push(q.get('exam')); }
  if (q.get('category')) { clauses.push('category = ?'); params.push(q.get('category')); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await all(
    env,
    `SELECT id, exam, category, name, created_at, updated_at FROM subjects ${where} ORDER BY name ASC`,
    ...params
  );
  return json({ subjects: rows });
}

// --------------------------- /api/auth -------------------
async function routeAuth(request, env, method, path) {
  // POST /api/auth/login
  if (method === 'POST' && path === '/api/auth/login') {
    return doLogin(request, env);
  }
  // POST /api/auth/logout
  if (method === 'POST' && path === '/api/auth/logout') {
    return doLogout(request, env);
  }
  // POST /api/auth/logout-all, change-password — admin only
  if (method === 'POST' && path === '/api/auth/logout-all') {
    const admin = await requireAdmin(request, env);
    if (!admin) return json({ error: 'Invalid or expired session.' }, 401);
    await run(env, 'UPDATE auth_sessions SET revoked = 1 WHERE admin_id = ? AND revoked = 0', admin.id);
    await logAuthEvent(env, admin.email, 'logout-all', true, clientIp(request), request.headers.get('user-agent'));
    return respondWithClearCookie(json({ ok: true }), env);
  }
  if (method === 'POST' && path === '/api/auth/change-password') {
    const admin = await requireAdmin(request, env);
    if (!admin) return json({ error: 'Invalid or expired session.' }, 401);
    const body = await request.json().catch(() => ({}));
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) {
      return json({ error: 'Current and new passwords are required.' }, 400);
    }
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return json({ error: 'New password must be at least 10 characters and include letters and numbers.' }, 400);
    }
    const row = await get(env, 'SELECT * FROM admins WHERE id = ?', admin.id);
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      await logAuthEvent(env, admin.email, 'change-password', false, clientIp(request), request.headers.get('user-agent'));
      return json({ error: 'Current password is incorrect.' }, 401);
    }
    const nextHash = await hashPassword(newPassword);
    await run(env, 'UPDATE admins SET password_hash = ? WHERE id = ?', nextHash, admin.id);
    await run(env, 'UPDATE auth_sessions SET revoked = 1 WHERE admin_id = ? AND id != ? AND revoked = 0', admin.id, admin.jti);
    await logAuthEvent(env, admin.email, 'change-password', true, clientIp(request), request.headers.get('user-agent'));
    return json({ ok: true });
  }
  // GET /api/auth/security-log (super only)
  if (method === 'GET' && path === '/api/auth/security-log') {
    const admin = await requireAdmin(request, env);
    if (!admin) return json({ error: 'Invalid or expired session.' }, 401);
    if ((admin.role || 'super') !== 'super') return json({ error: 'Super admin only.' }, 403);
    const rows = await all(env, 'SELECT at, email, event, ok, ip FROM auth_log ORDER BY at DESC LIMIT 100');
    return json({ log: rows });
  }
  // GET /api/auth/me
  if (method === 'GET' && path === '/api/auth/me') {
    const admin = await requireAdmin(request, env);
    if (!admin) return json({ error: 'Invalid or expired session.' }, 401);
    return json({ email: admin.email, role: admin.role || 'super' });
  }
  // POST /api/auth/bootstrap-maintainer
  if (method === 'POST' && path === '/api/auth/bootstrap-maintainer') {
    if (!env.ADMIN_SETUP_KEY || request.headers.get('x-setup-key') !== env.ADMIN_SETUP_KEY) {
      return json({ error: 'Forbidden.' }, 403);
    }
    const body = await request.json().catch(() => ({}));
    const email = (body.email || '').toLowerCase().trim();
    const password = body.password || '';
    if (!email || password.length < 8) {
      return json({ error: 'Email and a password of at least 8 characters are required.' }, 400);
    }
    const existing = await get(env, 'SELECT id FROM admins WHERE email = ?', email);
    const ts = nowIso();
    const hash = await hashPassword(password);
    if (existing) {
      await run(env, "UPDATE admins SET password_hash = ?, role = 'maintenance' WHERE id = ?", hash, existing.id);
    } else {
      await run(env, "INSERT INTO admins (id, email, password_hash, role, created_at) VALUES (?, ?, ?, 'maintenance', ?)",
        randomUuid(), email, hash, ts);
    }
    return json({ ok: true, email, role: 'maintenance' });
  }
  return json({ error: 'Not found.' }, 404);
}

async function doLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  const { email, password } = body || {};
  if (!email || !password) return json({ error: 'Email and password are required.' }, 400);
  const clean = email.toLowerCase().trim();
  const ip = clientIp(request);

  if (isLocked(loginEmail, clean)) {
    await logAuthEvent(env, clean, 'login', false, ip, request.headers.get('user-agent'));
    return json({ error: 'Account temporarily locked. Try again in 15 minutes.' }, 429);
  }

  const admin = await get(env, 'SELECT * FROM admins WHERE email = ?', clean);
  if (!admin || !(await verifyPassword(password, admin.password_hash))) {
    addLocked(loginIp, ip, parseInt(env.LOGIN_ATTEMPTS_LIMIT || '10', 10));
    addLocked(loginEmail, clean, parseInt(env.LOGIN_EMAIL_LOCK || '8', 10));
    await logAuthEvent(env, clean, 'login', false, ip, request.headers.get('user-agent'));
    // Constant-shape response either way.
    return json({ error: 'Invalid email or password.' }, 401);
  }
  clearKey(loginIp, ip);
  clearKey(loginEmail, clean);

  const role = admin.role || 'super';
  const jti = randomUuid();
  const now = Date.now();
  const idleHours = parseInt(env.AUTH_IDLE_HOURS || '12', 10);
  await run(
    env,
    'INSERT INTO auth_sessions (id, admin_id, created_at, last_seen, expires_at, revoked, ip, user_agent) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    jti, admin.id, new Date(now).toISOString(), new Date(now).toISOString(),
    new Date(now + idleHours * 3600 * 1000).toISOString(), ip, request.headers.get('user-agent') || null
  );

  const token = await signJwt({ sub: admin.id, email: admin.email, role, jti }, env.JWT_SECRET, 30 * 24 * 3600);
  await logAuthEvent(env, admin.email, 'login', true, ip, request.headers.get('user-agent'));
  const res = json({ email: admin.email, role, token });
  res.headers.append('set-cookie', cookieHeader(env.ADMIN_COOKIE_NAME || 'sulaksh_admin_token', token, true));
  return res;
}

async function doLogout(request, env) {
  const token = readTokenFromRequest(request, env);
  if (token) {
    try {
      const payload = await verifyJwt(token, env.JWT_SECRET);
      if (payload && payload.jti) {
        await run(env, 'UPDATE auth_sessions SET revoked = 1 WHERE id = ?', payload.jti);
        await logAuthEvent(env, payload.email, 'logout', true, clientIp(request), request.headers.get('user-agent'));
      }
    } catch (_) {}
  }
  return respondWithClearCookie(json({ ok: true }), env);
}

// --------------------------- /api/admin -------------------
const MAINTENANCE_ROUTES = new Set(['/maintenance']);

async function routeAdmin(request, env, method, path, url) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Invalid or expired session.' }, 401);

  // maintenance-role accounts may only toggle maintenance mode.
  if ((admin.role || 'super') !== 'super' && !MAINTENANCE_ROUTES.has(path)) {
    return json({ error: 'This account does not have permission for that action.' }, 403);
  }

  // ---- maintenance ----
  if (path === '/api/admin/maintenance') {
    if (method === 'GET') {
      return json({ enabled: (await getSetting(env, 'maintenance_mode')) === '1' });
    }
    if (method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const enabled = !!(body && (body.enabled === true || body.enabled === 'true'));
      await setSetting(env, 'maintenance_mode', enabled ? '1' : '0');
      return json({ enabled });
    }
  }

  // ---- materials ----
  if (path === '/api/admin/materials') {
    if (method === 'GET') return adminListMaterials(env, url);
    if (method === 'POST') return adminCreateMaterial(request, env);
  }
  const oneMat = /^\/api\/admin\/materials\/([^/]+)(\/file)?$/.exec(path);
  if (oneMat) {
    const id = oneMat[1];
    const isFile = Boolean(oneMat[2]);
    if (method === 'PATCH' && !isFile) return adminPatchMaterial(env, id, request);
    if (method === 'PUT' && isFile) return adminReplaceFile(request, env, id);
    if (method === 'DELETE' && !isFile) return adminDeleteMaterial(env, id);
  }

  // ---- subjects ----
  if (path === '/api/admin/subjects') {
    if (method === 'POST') return adminCreateSubject(request, env);
  }
  const oneSub = /^\/api\/admin\/subjects\/([^/]+)$/.exec(path);
  if (oneSub) {
    if (method === 'PATCH') return adminPatchSubject(env, oneSub[1], request);
    if (method === 'DELETE') return adminDeleteSubject(env, oneSub[1]);
  }

  return json({ error: 'Not found.' }, 404);
}

async function adminListMaterials(env, url) {
  const q = url.searchParams;
  const clauses = ['status = ?'];
  const params = [q.get('status') || 'active'];
  for (const f of ['exam', 'category', 'subject', 'year']) {
    if (q.get(f)) { clauses.push(`${f} = ?`); params.push(q.get(f)); }
  }
  if (q.get('q')) {
    const like = escapeLike(q.get('q'));
    clauses.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  const where = clauses.join(' AND ');
  const rows = await all(env, `SELECT * FROM materials WHERE ${where} ORDER BY created_at DESC LIMIT 500`, ...params);
  return json({ materials: rows });
}

async function adminCreateMaterial(request, env) {
  const buf = new Uint8Array(await request.arrayBuffer());
  const { fields, file } = parseMultipart(buf, request.headers.get('content-type'));
  const { title, exam, category, subject, track, semester, material_category, year, description, is_imp, is_syllabus, is_pyq } = fields;
  if (!title || !exam || !category) {
    return json({ error: 'title, exam, and category are required.' }, 400);
  }
  const fileErrors = validateUpload(env, file);
  if (fileErrors.length) return json({ error: fileErrors.join(' ') }, 400);

  const contentType = detectFileType(file.buffer);
  let stored = file.buffer;
  if (contentType === 'application/pdf') {
    try {
      stored = new Uint8Array(await stampPdf(file.buffer));
    } catch (err) {
      console.error('[admin] PDF stamping failed:', err.message);
      return json({ error: 'This PDF could not be processed for watermarking. Try re-exporting or flattening it, then upload again.' }, 400);
    }
  }
  const objectKey = buildObjectKey({ exam, category, year }, contentType);
  const safeFileName = sanitizeFileName(file.originalname, contentType);

  try {
    await uploadObject(env, objectKey, stored, contentType);
  } catch (err) {
    console.error('[admin] storage upload failed:', err.message);
    return json({ error: 'Upload to storage failed. No record was created.' }, 502);
  }

  const id = randomUuid();
  const ts = nowIso();
  try {
    await run(
      env,
      `INSERT INTO materials (id, title, exam, category, subject, track, semester, material_category, year, description, file_name, file_size, content_type, r2_object_key, status, is_imp, is_syllabus, is_pyq, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, title, exam, category, subject || null, track || null, semester || null, material_category || null,
      year ? parseInt(year, 10) : null, description || null, safeFileName, stored.length, contentType, objectKey, 'active',
      is_imp === 'true' || is_imp === '1' ? 1 : 0,
      is_syllabus === 'true' || is_syllabus === '1' ? 1 : 0,
      is_pyq === 'true' || is_pyq === '1' ? 1 : 0,
      ts, ts
    );
  } catch (err) {
    console.error('[admin] DB insert failed, cleaning up object:', objectKey, err.message);
    try { await deleteObject(env, objectKey); } catch (e) {}
    return json({ error: 'Could not save material metadata. Upload was rolled back.' }, 500);
  }

  const material = await get(env, 'SELECT * FROM materials WHERE id = ?', id);
  return json({ material }, 201);
}

async function adminPatchMaterial(env, id, request) {
  const existing = await get(env, 'SELECT * FROM materials WHERE id = ?', id);
  if (!existing) return json({ error: 'Material not found.' }, 404);
  const body = await request.json().catch(() => ({}));

  const fields = ['title', 'exam', 'category', 'subject', 'track', 'semester', 'material_category', 'year', 'description', 'is_imp', 'is_syllabus', 'is_pyq'];
  const updates = {};
  for (const f of fields) {
    if (body[f] !== undefined) {
      updates[f] = (f === 'is_imp' || f === 'is_syllabus' || f === 'is_pyq')
        ? (body[f] === 'true' || body[f] === '1' ? 1 : 0)
        : body[f];
    }
  }
  if (Object.keys(updates).length === 0) {
    return json({ error: 'No editable fields provided.' }, 400);
  }
  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  await run(env, `UPDATE materials SET ${setClause}, updated_at = ? WHERE id = ?`, ...values, nowIso(), id);
  const material = await get(env, 'SELECT * FROM materials WHERE id = ?', id);
  return json({ material });
}

async function adminReplaceFile(request, env, id) {
  const existing = await get(env, 'SELECT * FROM materials WHERE id = ?', id);
  if (!existing) return json({ error: 'Material not found.' }, 404);

  const buf = new Uint8Array(await request.arrayBuffer());
  const { fields, file } = parseMultipart(buf, request.headers.get('content-type'));
  const fileErrors = validateUpload(env, file);
  if (fileErrors.length) return json({ error: fileErrors.join(' ') }, 400);

  const contentType = detectFileType(file.buffer);
  let stored = file.buffer;
  if (contentType === 'application/pdf') {
    try {
      stored = new Uint8Array(await stampPdf(file.buffer));
    } catch (err) {
      console.error('[admin] PDF stamping failed during replace:', err.message);
      return json({ error: 'This PDF could not be processed for watermarking. Nothing was changed.' }, 400);
    }
  }
  const newKey = buildObjectKey({ exam: existing.exam, category: existing.category, year: existing.year }, contentType);
  const safeFileName = sanitizeFileName(file.originalname, contentType);

  try { await uploadObject(env, newKey, stored, contentType); }
  catch (err) {
    console.error('[admin] upload failed during replace:', err.message);
    return json({ error: 'Upload of the replacement file failed. Nothing was changed.' }, 502);
  }

  const oldKey = existing.r2_object_key;
  try {
    await run(
      env,
      'UPDATE materials SET r2_object_key = ?, file_name = ?, file_size = ?, content_type = ?, updated_at = ? WHERE id = ?',
      newKey, safeFileName, stored.length, contentType, nowIso(), id
    );
  } catch (err) {
    console.error('[admin] DB update failed after replace, cleaning up new object:', newKey, err.message);
    try { await deleteObject(env, newKey); } catch (e) {}
    return json({ error: 'Could not update material record. Replacement was rolled back.' }, 500);
  }
  try { await deleteObject(env, oldKey); }
  catch (err) { console.error('[admin] failed to delete old object after replace (non-fatal):', oldKey, err.message); }

  const material = await get(env, 'SELECT * FROM materials WHERE id = ?', id);
  return json({ material });
}

async function adminDeleteMaterial(env, id) {
  const existing = await get(env, 'SELECT * FROM materials WHERE id = ?', id);
  if (!existing) return json({ error: 'Material not found.' }, 404);
  try { await deleteObject(env, existing.r2_object_key); }
  catch (err) {
    console.error('[admin] storage delete failed, DB record kept:', existing.r2_object_key, err.message);
    return json({ error: 'Could not delete the file from storage. The material was NOT removed — please retry.' }, 502);
  }
  await run(env, 'DELETE FROM materials WHERE id = ?', id);
  return json({ ok: true });
}

async function adminCreateSubject(request, env) {
  const body = await request.json().catch(() => ({}));
  const { exam, category, name } = body;
  const clean = (name || '').trim();
  if (!exam || !category || !clean) {
    return json({ error: 'exam, category and a subject name are required.' }, 400);
  }
  const existing = await get(env, 'SELECT id FROM subjects WHERE exam = ? AND category = ? AND name = ?', exam, category, clean);
  if (existing) return json({ error: 'That subject already exists in this category.' }, 409);
  const id = randomUuid();
  const ts = nowIso();
  try {
    await run(env, 'INSERT INTO subjects (id, exam, category, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      id, exam, category, clean, ts, ts);
  } catch (err) {
    return json({ error: 'That subject already exists in this category.' }, 409);
  }
  const subject = await get(env, 'SELECT * FROM subjects WHERE id = ?', id);
  return json({ subject }, 201);
}

async function adminPatchSubject(env, id, request) {
  const existing = await get(env, 'SELECT * FROM subjects WHERE id = ?', id);
  if (!existing) return json({ error: 'Subject not found.' }, 404);
  const body = await request.json().catch(() => ({}));
  const newName = (body.name || '').trim();
  if (!newName) return json({ error: 'A new subject name is required.' }, 400);
  const dup = await get(env, 'SELECT id FROM subjects WHERE exam = ? AND category = ? AND name = ? AND id != ?',
    existing.exam, existing.category, newName, id);
  if (dup) return json({ error: 'A subject with that name already exists in this category.' }, 409);
  const oldName = existing.name;
  await run(env, 'UPDATE subjects SET name = ?, updated_at = ? WHERE id = ?', newName, nowIso(), id);
  await run(env, 'UPDATE materials SET subject = ?, updated_at = ? WHERE exam = ? AND category = ? AND subject = ?',
    newName, nowIso(), existing.exam, existing.category, oldName);
  const subject = await get(env, 'SELECT * FROM subjects WHERE id = ?', id);
  return json({ subject });
}

async function adminDeleteSubject(env, id) {
  const subject = await get(env, 'SELECT * FROM subjects WHERE id = ?', id);
  if (!subject) return json({ error: 'Subject not found.' }, 404);
  const materials = await all(env, 'SELECT * FROM materials WHERE exam = ? AND category = ? AND subject = ?',
    subject.exam, subject.category, subject.name);
  for (const m of materials) {
    try { await deleteObject(env, m.r2_object_key); }
    catch (err) {
      console.error('[admin] storage delete failed on subject delete:', m.id, err.message);
      return json({ error: 'Could not remove a file from storage — no subject was deleted. Please retry.' }, 502);
    }
  }
  for (const m of materials) await run(env, 'DELETE FROM materials WHERE id = ?', m.id);
  await run(env, 'DELETE FROM subjects WHERE id = ?', id);
  return json({ ok: true, removed_materials: materials.length });
}

export default { fetch: handleRequest };