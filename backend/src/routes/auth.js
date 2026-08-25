const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAdmin, COOKIE_NAME } = require('../middleware/auth');

const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';

// Login is rate-limited at the app level (server.js) — 10 failed attempts
// per 15 minutes per IP; successful logins never consume budget.
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email.toLowerCase().trim());
  // Constant-shaped response whether the email exists or not, to avoid
  // leaking which admin emails are registered.
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const role = admin.role || 'super';
  const token = jwt.sign(
    { sub: admin.id, email: admin.email, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );

  // SameSite must be 'none' in production: the admin panel on sulaksh.online
  // talks to this API cross-origin, so the session cookie has to travel with
  // cross-site fetches (credentials:'include'). Secure is mandatory then.
  // CSRF is mitigated by the Origin allowlist check in server.js.
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 12 * 60 * 60 * 1000,
  });

  // Session travels two ways: the HttpOnly cookie works for same-origin
  // clients (the /admin dashboard); the body token covers cross-origin
  // pages (sulaksh.online) where browsers refuse to send third-party
  // cookies at all. Both carry the identical signed JWT.
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
  const { v4: uuidv4 } = require('uuid');
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
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ email: req.admin.email, role: req.admin.role || 'super' });
});

module.exports = router;
