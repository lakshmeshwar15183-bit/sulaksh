const express = require('express');
const db = require('../db');
const { getPresignedDownloadUrl } = require('../r2');
const { getStaff } = require('../middleware/auth');

const router = express.Router();

// Fields exposed publicly — r2_object_key is intentionally never sent to
// the client; downloads only ever happen via a short-lived presigned URL.
const PUBLIC_FIELDS = `
  id, title, exam, category, subject, track, semester, material_category, year, description,
  file_name, file_size, content_type, is_imp, is_syllabus, is_pyq, created_at, updated_at
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
    clauses.push('(title LIKE ? OR description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  const rows = db.prepare(
    `SELECT ${PUBLIC_FIELDS} FROM materials WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 200`
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

  // Fast path: stream through the Cloudflare CDN worker when configured.
  if (process.env.PUBLIC_CDN_BASE && material.r2_object_key) {
    const encodedKey = material.r2_object_key.split('/').map(encodeURIComponent).join('/');
    return res.json({
      url: `${process.env.PUBLIC_CDN_BASE}/file/${encodedKey}`,
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
