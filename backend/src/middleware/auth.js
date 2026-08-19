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
    req.admin = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

module.exports = { requireAdmin, COOKIE_NAME };
