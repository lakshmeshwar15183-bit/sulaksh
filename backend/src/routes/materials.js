const express = require('express');
const { PDFDocument, StandardFonts, degrees, rgb } = require('pdf-lib');
const db = require('../db');
const { rateLimit } = require('express-rate-limit');
const { getPresignedDownloadUrl, getObject } = require('../r2');
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
  if (db.getSetting('watermark_enabled') === '1' && !staff && material_id_ok(req.params.id)) {
    return res.json({ url: `${req.protocol}://${req.get('host')}/api/materials/${req.params.id}/wm` });
  }
  if (db.getSetting('downloads_disabled') === '1' && !staff && req.query.disposition === 'attachment') {
    return res.status(403).json({ error: 'Downloads are temporarily paused. Please check back soon.' });
  }
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
    const params = new URLSearchParams();
    params.set('disposition', req.query.disposition === 'attachment' ? 'attachment' : 'inline');
    if (material.file_name) params.set('filename', material.file_name);
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


// ---- Watermarked inline stream ----
function material_id_ok(id){ return /^[0-9a-f-]{36}$/i.test(id||''); }

router.get('/:id/wm', async (req, res) => {
  const material = db.prepare(`SELECT * FROM materials WHERE id = ? AND status = 'active'`).get(req.params.id);
  if (!material || !material.r2_object_key) return res.status(404).json({ error: 'Material not found.' });
  try {
    const bytes = await getObject(material.r2_object_key);
    let out = bytes;
    try {
      const pdfDoc = await PDFDocument.load(bytes);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
      const day = new Date().toISOString().slice(0,10);
      const txt = `sulaksh.online · ${ip} · ${day}`;
      pdfDoc.getPages().forEach(p => {
        const w = p.getWidth(), h = p.getHeight();
        const ang = Math.atan(h / w) * 180 / Math.PI;
        p.drawText(txt, { x: w * 0.08, y: h * 0.5, size: Math.max(16, Math.round(w / 34)), font, color: rgb(0.55,0.55,0.62), opacity: 0.3, rotate: degrees(ang) });
      });
      out = Buffer.from(await pdfDoc.save());
    } catch (e) { /* unparsable — serve original */ }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${(material.file_name||'document.pdf').replace(/"/g,'')}"`);
    res.send(out);
  } catch (e) {
    console.error('[wm] failed:', e.message);
    res.status(500).json({ error: 'Could not process file.' });
  }
});

module.exports = router;
