require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const materialsRoutes = require('./routes/materials');
const subjectsRoutes = require('./routes/subjects');
const adminRoutes = require('./routes/admin');

const app = express();

// ---- Core middleware ----
app.use(express.json());
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

// ---- API routes ----
app.use('/api/auth', authRoutes);
app.use('/api/materials', materialsRoutes);
app.use('/api/subjects', subjectsRoutes);
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
