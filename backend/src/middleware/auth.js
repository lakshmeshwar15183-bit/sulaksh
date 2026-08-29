const jwt = require('jsonwebtoken');
const db = require('../db');

const COOKIE_NAME = process.env.ADMIN_COOKIE_NAME || 'sulaksh_admin_token';
// Idle lifetime of a session. The window SLIDES on every verified request, so a
// session stays alive as long as it is used. Set AUTH_IDLE_HOURS very high (or
// rely on explicit logout) to keep admins signed in until they choose to leave.
const IDLE_HOURS = parseInt(process.env.AUTH_IDLE_HOURS || '720', 10);

function readToken(req) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return req.cookies?.[COOKIE_NAME] || bearer || null;
}

// Full verification: signature + server-side session row + sliding expiry.
// Returns the verified payload ({ sub, email, role, jti }) or null.
function verifySession(token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
  if (!payload.jti) return null; // legacy token from before sessions existed
  let row;
  try {
    row = db.prepare('SELECT * FROM auth_sessions WHERE id = ?').get(payload.jti);
  } catch {
    return null;
  }
  if (!row || row.revoked) return null;
  const now = Date.now();
  if (new Date(row.expires_at).getTime() < now) return null;
  // Sliding window: every verified request pushes the idle deadline out, so the
  // session never auto-expires while it is in use. It ends only on explicit
  // logout, logout-all, or IDLE_HOURS of total inactivity.
  try {
    db.prepare('UPDATE auth_sessions SET expires_at = ?, last_seen = ? WHERE id = ?')
      .run(new Date(now + IDLE_HOURS * 3600 * 1000).toISOString(), new Date(now).toISOString(), row.id);
  } catch {}
  return payload;
}

function requireAdmin(req, res, next) {
  const payload = verifySession(readToken(req));
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
  req.admin = { id: payload.sub, email: payload.email, role: payload.role || 'super', jti: payload.jti };
  next();
}

// Soft check: verified staff info for optional gating, null when absent/invalid.
function getStaff(req) {
  const payload = verifySession(readToken(req));
  return payload ? { id: payload.sub, email: payload.email, role: payload.role || 'super' } : null;
}

module.exports = { requireAdmin, getStaff, COOKIE_NAME };
