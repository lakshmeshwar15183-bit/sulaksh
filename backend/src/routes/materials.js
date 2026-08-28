const express = require('express');
const db = require('../db');
const { rateLimit } = require('express-rate-limit');
const { getPresignedDownloadUrl } = require('../r2');
const { getStaff } = require('../middleware/auth');

const router = express.Router();

// Download URLs are the scrape target — cap hard. Real students open a
// handful of papers per session; bulk agents need hundreds.
const downloadLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  limit: parseInt(process.env.DOWNLOAD_DAILY_LIMIT || '80', 10),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Daily download limit reached. Please come back tomorrow.' },
  skip: (req) => Boolean(getStaff(req)), // admins never throttled
});

// Staff bypass the cap (admins never get throttled while working).
router.use('/:id/download', downloadLimiter);

// Fields exposed publicly — r2_object_key is intentionally never sent to
// the client; downloads only ever happen via a short-lived presigned URL.
const PUBLIC_FIELDS = `
  id, title, exam, category, subject, track, semester, material_category, year, description,
  file_name, file_size, content_type, is_imp, is_syllabus, is_pyq, uploaded_by, created_at, updated_at
`;

// GET /api/materials?exam=&category=&subject=&track=&semester=&material_category=&year=&q=
// Lightweight listing — no file bytes touched, just metadata rows.
router.get('/', (req, res) => {
  const staff = getStaff(req);
  if (db.getSetting('maintenance_mode') === '1' && !staff) {
    return res.status(503).json({ maintenance: true });
  }
  const { exam, category, subject, track, semester, material_category, year, q } = req.query;
  const clauses = ["status = 'active'"];
  const params = [];

  if (exam) { clauses.push('exam = ?'); params.push(exam); }
  if (category) { clauses.push('category = ?'); params.push(category); }
  if (subject) { clauses.push('subject = ?'); params.push(subject); }
  if (track) { clauses.push('track = ?'); params.push(track); }
  if (semester) { clauses.push('semester = ?'); params.push(semester); }
  if (material_category) { clauses.push('material_category = ?'); params.push(material_category); }
  if (year) { clauses.push('year = ?'); params.push(year); }
  if (q) {
    // Escape LIKE wildcards so user input can't craft pathological scans.
    clauses.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    params.push(like, like);
  }

  // Optional pagination: ?page=1&limit=50 (max 1000). With NO params the
  // response is byte-identical to the legacy full listing — existing
  // clients are unaffected.
  let limit = parseInt(req.query.limit || '0', 10);
  limit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 0;
  const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);

  if (limit) {
    const total = db.prepare(`SELECT COUNT(*) AS c FROM materials WHERE ${clauses.join(' AND ')}`)
      .get(...params).c;
    const rowsP = db.prepare(
      `SELECT ${PUBLIC_FIELDS} FROM materials WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, (page - 1) * limit);
    return res.json({ materials: rowsP, page, limit, total });
  }

  const rows = db.prepare(
    `SELECT ${PUBLIC_FIELDS} FROM materials WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 5000`
  ).all(...params);

  res.json({ materials: rows });
});

router.get('/:id', (req, res) => {
  const row = db.prepare(
    `SELECT ${PUBLIC_FIELDS} FROM materials WHERE id = ? AND status = 'active'`
  ).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Material not found.' });
  res.json({ material: row });
});

// GET /api/materials/:id/download?disposition=inline|attachment
// Returns a short-lived presigned URL. The browser downloads directly
// from R2 — the file is never proxied through this server.
router.get('/:id/download', async (req, res) => {
  const staff = getStaff(req);
  if (db.getSetting('maintenance_mode') === '1' && !staff) {
    return res.status(503).json({ maintenance: true });
  }
  const material = db.prepare(
    `SELECT * FROM materials WHERE id = ? AND status = 'active'`
  ).get(req.params.id);
  if (!material) return res.status(404).json({ error: 'Material not found.' });

  const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline';

  // Fast path: stream through the Cloudflare CDN (R2 public URL) when configured.
  // R2 only honors the S3-style `response-content-disposition` query parameter
  // (the bare `disposition` is ignored), so set that — otherwise every file is
  // served as `attachment` and the browser downloads even when "View" asked for inline.
  if (process.env.PUBLIC_CDN_BASE && material.r2_object_key) {
    const encodedKey = material.r2_object_key.split('/').map(encodeURIComponent).join('/');
    const safeName = material.file_name ? material.file_name.replace(/"/g, '') : 'document.pdf';
    const params = new URLSearchParams();
    params.set('response-content-disposition', `${disposition}; filename="${safeName}"`);
    return res.json({
      url: `${process.env.PUBLIC_CDN_BASE}/file/${encodedKey}?${params.toString()}`,
      cdn: true,
    });
  }

  try {
    const url = await getPresignedDownloadUrl(material.r2_object_key, {
      fileName: material.file_name,
      disposition,
      contentType: material.content_type,
    });
    res.json({ url, expires_in: parseInt(process.env.PRESIGNED_URL_EXPIRY_SECONDS || '300', 10) });
  } catch (err) {
    console.error('[materials] presign error for', material.id, err.message);
    res.status(502).json({ error: 'Could not generate a download link right now. Please try again.' });
  }
});

module.exports = router;
