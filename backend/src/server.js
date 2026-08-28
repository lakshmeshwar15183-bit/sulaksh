require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const { rateLimit } = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const materialsRoutes = require('./routes/materials');
const subjectsRoutes = require('./routes/subjects');
const adminRoutes = require('./routes/admin');
const reportsRoutes = require('./routes/reports');

const app = express();
// Express discloses itself via X-Powered-By; disable it.
app.disable('x-powered-by');

// Railway terminates TLS and forwards the real client IP in X-Forwarded-For.
// Without this, express-rate-limit sees the proxy's IP for every request, so
// all per-IP limits (login brute-force, download, report) collapse into one
// global bucket and a single abuser could even lock out every login.
app.set('trust proxy', 1);

// ---- Core middleware ----
app.use(express.json());

// ---- Basic security headers + Content-Security-Policy ----
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // CSP: JSON API responses carry a locked-down policy. The admin panel is
  // inline-script based, so it gets a scoped policy that still stops
  // clickjacking (frame-ancestors) and form-jacking.
  const csp = req.path.startsWith('/admin')
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://cdn.sulaksh.online https://*.backblazeb2.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    : "default-src 'none'; frame-ancestors 'none'; base-uri 'self'";
  res.setHeader('Content-Security-Policy', csp);
  next();
});
app.use(cookieParser());

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Allow no-origin requests (curl, server-to-server) and any explicitly listed origin.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));

// ---- CSRF guard ----
// The session cookie is SameSite=None (cross-origin admin panel), so block
// any state-changing browser request whose Origin isn't explicitly allowed.
// Requests without an Origin header (curl, server-to-server, same-origin)
// are unaffected.
app.use((req, res, next) => {
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (safeMethod || !req.headers.origin) return next();
  if (allowedOrigins.includes(req.headers.origin)) return next();
  return res.status(403).json({ error: 'Origin not allowed.' });
});

// ---- Rate limiting ----
// Login: strict cap to make password brute-forcing impractical.
// Counts failed attempts only; successful logins never consume budget.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: parseInt(process.env.LOGIN_ATTEMPTS_LIMIT || '10', 10),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});
// General API: generous ceiling against abuse without affecting real users.
//
// Public read endpoints (materials, subjects, maintenance-health) are exempt
// from the per-IP ceiling. This is critical on mobile networks (CGNAT / NAT444,
// common in India) where many users share a single public IP — applying a
// strict per-IP cap there makes the whole site appear empty to everyone behind
// it. Abuse on downloads and login is already controlled by their own limiters.
const PUBLIC_READ_PREFIXES = [
  '/api/materials',
  '/api/subjects',
  '/api/maintenance-status',
  '/api/health',
];
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: parseInt(process.env.API_RATE_LIMIT || '300', 10),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
  skip: (req) =>
    req.method === 'GET' &&
    PUBLIC_READ_PREFIXES.some((p) => req.path.startsWith(p)),
});

// Report submission is open to anonymous visitors (they must be able to flag
// content without logging in), but we cap how many a single IP can file in a
// window so a bad actor can't drown admins in spam reports.
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: parseInt(process.env.REPORT_RATE_LIMIT || '20', 10),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many reports submitted. Please try again later.' },
});

// ---- API routes ----
app.use('/api/auth/login', loginLimiter);
app.use('/api', apiLimiter);
app.use('/api/reports', reportLimiter);

// Public maintenance flag — the static frontend polls this to show the
// maintenance overlay. Always allowed, even while other routes are gated.
const db = require('./db');
// Backups are manual for now: `node -e "require('./src/backup').backupNow(require('./src/db'))"`
// (WAL-safe snapshot → R2 backups/ folder). The Mac mirror script can pull
// them anytime: ~/sulaksh-backups/pull-backups.sh
app.get('/api/maintenance-status', (req, res) => {
  res.json({ enabled: db.getSetting('maintenance_mode') === '1' });
});

// Public site config the frontend needs before rendering (e.g. feature flags).
// No auth — safe to expose. Downloads are hidden on the client when disabled;
// the download endpoint itself is NOT blocked (View always works).
app.get('/api/config', (req, res) => {
  res.json({
    downloads_enabled: db.getSetting('downloads_enabled') !== '0',
    deletes_enabled: db.getSetting('deletes_enabled') !== '0',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/materials', materialsRoutes);
app.use('/api/subjects', subjectsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/admin', adminRoutes);

// ---- Admin panel static UI (separate from the public marketing site) ----
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---- Error handling ----
// Multer file-too-large and CORS rejection land here; keep messages generic,
// never leak internals or secrets.
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File too large. Max ${process.env.MAX_FILE_SIZE_MB || 25}MB.` });
  }
  if (err && /not allowed by CORS/.test(err.message)) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Something went wrong.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SULAKSH backend listening on port ${PORT}`);
});
