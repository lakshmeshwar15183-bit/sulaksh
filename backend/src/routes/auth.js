const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAdmin, COOKIE_NAME } = require('../middleware/auth');

const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';

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

  const token = jwt.sign(
    { sub: admin.id, email: admin.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
  });

  res.json({ email: admin.email, token });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ email: req.admin.email });
});

module.exports = router;
