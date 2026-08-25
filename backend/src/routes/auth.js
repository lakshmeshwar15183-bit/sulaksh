const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin, COOKIE_NAME } = require('../middleware/auth');

const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';
const IDLE_HOURS = parseInt(process.env.AUTH_IDLE_HOURS || '12', 10);
const EMAIL_LOCK_LIMIT = parseInt(process.env.LOGIN_EMAIL_LOCK || '8', 10);

// ---- Per-account lockout: protects a single email from targeted brute-force
// even when the attacker rotates IPs (the per-IP limiter catches the rest).
const emailFails = new Map(); // email -> { count, resetAt }
function emailLocked(email) {
  const rec = emailFails.get(email);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) { emailFails.delete(email); return false; }
  return rec.count >= EMAIL_LOCK_LIMIT;
}
function noteFail(email) {
  const rec = emailFails.get(email) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  rec.count++;
  emailFails.set(email, rec);
}

// Login is rate-limited at the app level (server.js) — failed attempts only.
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const clean = email.toLowerCase().trim();
  if (emailLocked(clean)) {
    db.logAuthEvent(clean, 'login', false, req);
    return res.status(429).json({ error: 'Account temporarily locked. Try again in 15 minutes.' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(clean);
  // Constant-shaped response whether the email exists or not, to avoid
  // leaking which admin emails are registered.
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    noteFail(clean);
    db.logAuthEvent(clean, 'login', false, req);
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  emailFails.delete(clean);

  const role = admin.role || 'super';
  const jti = uuidv4();
  const now = Date.now();
  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0].trim()) ||
    (req.socket && req.socket.remoteAddress) || null;
  db.prepare(`INSERT INTO auth_sessions (id, admin_id, created_at, last_seen, expires_at, revoked, ip, user_agent)
              VALUES (?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(jti, admin.id, new Date(now).toISOString(), new Date(now).toISOString(),
      new Date(now + IDLE_HOURS * 3600 * 1000).toISOString(), ip, req.headers['user-agent'] || null);

  const token = jwt.sign(
    { sub: admin.id, email: admin.email, role, jti },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || `${IDLE_HOURS}h` }
  );

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: IDLE_HOURS * 60 * 60 * 1000,
  });

  db.logAuthEvent(admin.email, 'login', true, req);

  // Token lives in the HttpOnly cookie for same-origin clients; also returned
  // in the body because cross-origin pages (sulaksh.online) are blocked from
  // sending third-party cookies by modern browsers.
  res.json({ email: admin.email, role, token });
});

// ---- One-time bootstrap for limited-role accounts ----
// Creates or updates an account with role 'maintenance' (can only toggle
// maintenance mode). Requires the ADMIN_SETUP_KEY env value in the
// x-setup-key header. Delete the env var after use to disable this route.
router.post('/bootstrap-maintainer', (req, res) => {
  if (!process.env.ADMIN_SETUP_KEY || req.get('x-setup-key') !== process.env.ADMIN_SETUP_KEY) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email and a password of at least 8 characters are required.' });
  }
  const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(email.toLowerCase().trim());
  const ts = new Date().toISOString();
  if (existing) {
    db.prepare("UPDATE admins SET password_hash = ?, role = 'maintenance' WHERE id = ?")
      .run(bcrypt.hashSync(password, 10), existing.id);
  } else {
    db.prepare(
      "INSERT INTO admins (id, email, password_hash, role, created_at) VALUES (?, ?, ?, 'maintenance', ?)"
    ).run(uuidv4(), email.toLowerCase().trim(), bcrypt.hashSync(password, 10), ts);
  }
  res.json({ ok: true, email: email.toLowerCase().trim(), role: 'maintenance' });
});

router.post('/logout', (req, res) => {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = req.cookies?.[COOKIE_NAME] || bearer;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.jti) {
        db.prepare('UPDATE auth_sessions SET revoked = 1 WHERE id = ?').run(payload.jti);
        db.logAuthEvent(payload.email, 'logout', true, req);
      }
    } catch {}
  }
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
  });
  res.json({ ok: true });
});

// Kill every session of the current account (all devices).
router.post('/logout-all', requireAdmin, (req, res) => {
  db.prepare('UPDATE auth_sessions SET revoked = 1 WHERE admin_id = ? AND revoked = 0')
    .run(req.admin.id);
  db.logAuthEvent(req.admin.email, 'logout-all', true, req);
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
  });
  res.json({ ok: true });
});

// Change password: verifies the current one, then revokes every other
// session so stolen tokens die immediately. The current device stays in.
router.post('/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new passwords are required.' });
  }
  if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'New password must be at least 10 characters and include letters and numbers.' });
  }
  const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!row || !bcrypt.compareSync(currentPassword, row.password_hash)) {
    db.logAuthEvent(req.admin.email, 'change-password', false, req);
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), req.admin.id);
  db.prepare('UPDATE auth_sessions SET revoked = 1 WHERE admin_id = ? AND id != ? AND revoked = 0')
    .run(req.admin.id, req.admin.jti);
  db.logAuthEvent(req.admin.email, 'change-password', true, req);
  res.json({ ok: true });
});

// Security log — last 100 events, super only.
router.get('/security-log', requireAdmin, (req, res) => {
  if ((req.admin.role || 'super') !== 'super') {
    return res.status(403).json({ error: 'Super admin only.' });
  }
  const rows = db.prepare('SELECT at, email, event, ok, ip FROM auth_log ORDER BY at DESC LIMIT 100').all();
  res.json({ log: rows });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ email: req.admin.email, role: req.admin.role || 'super' });
});

module.exports = router;
