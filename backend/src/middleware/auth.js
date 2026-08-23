const jwt = require('jsonwebtoken');

const COOKIE_NAME = process.env.ADMIN_COOKIE_NAME || 'sulaksh_admin_token';

function requireAdmin(req, res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = req.cookies?.[COOKIE_NAME] || bearer;

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = { id: payload.sub, email: payload.email, role: payload.role || 'super' };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

// Soft check: returns the admin payload if a valid token is present,
// otherwise null. Never rejects — used for maintenance gating where the
// general public is blocked but staff keep full access.
function getStaff(req) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = req.cookies?.[COOKIE_NAME] || bearer;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return { id: payload.sub, email: payload.email, role: payload.role || 'super' };
  } catch (err) {
    return null;
  }
}

module.exports = { requireAdmin, getStaff, COOKIE_NAME };
