const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { uploadObject, deleteObject, objectExists } = require('../r2');
const { validateUpload, buildObjectKey, sanitizeFileName, detectFileType, MAX_FILE_SIZE_BYTES } = require('../utils/validate');
const { stampPdf } = require('../stamp');

const router = express.Router();
router.use(requireAdmin);

// ---- Role gate ----
// 'super'      : everything (materials, subjects, reports, toggles).
// 'admin'      : materials / subjects / reports — NOT site-wide toggles.
// 'maintenance': may ONLY toggle maintenance mode.
router.use((req, res, next) => {
  const role = req.admin.role || 'super';
  if (role === 'super') return next();
  if (role === 'admin') {
    if (req.path === '/maintenance' || req.path === '/downloads') {
      return res.status(403).json({ error: 'This account does not have permission for that action.' });
    }
    return next();
  }
  if (role === 'maintenance' && req.path === '/maintenance') return next();
  return res.status(403).json({ error: 'This account does not have permission for that action.' });
});

// ---- Maintenance mode ----
// GET current state (staff only)
router.get('/maintenance', (req, res) => {
  res.json({ enabled: db.getSetting('maintenance_mode') === '1' });
});
// POST { enabled: true|false } — super admins and maintenance-role accounts
router.post('/maintenance', (req, res) => {
  const enabled = req.body && (req.body.enabled === true || req.body.enabled === 'true');
  db.setSetting('maintenance_mode', enabled ? '1' : '0');
  res.json({ enabled });
});

// ---- Download buttons toggle (site-wide) ----
// Only lakshmeshwar15183@gmail.com may read/change this.
const DOWNLOADS_ADMIN = 'lakshmeshwar15183@gmail.com';
router.get('/downloads', (req, res) => {
  if ((req.admin.email || '').toLowerCase() !== DOWNLOADS_ADMIN) return res.status(403).json({ error: 'Forbidden' });
  res.json({ enabled: db.getSetting('downloads_enabled') !== '0' });
});
router.post('/downloads', (req, res) => {
  if ((req.admin.email || '').toLowerCase() !== DOWNLOADS_ADMIN) return res.status(403).json({ error: 'Forbidden' });
  const enabled = req.body && (req.body.enabled === true || req.body.enabled === '1' || req.body.enabled === 1);
  db.setSetting('downloads_enabled', enabled ? '1' : '0');
  res.json({ enabled });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

function nowIso() { return new Date().toISOString(); }

// ---- List / search all materials (including any non-active, for the admin table) ----
// GET /api/admin/materials?exam=&category=&subject=&year=&q=&status=
router.get('/materials', (req, res) => {
  const { exam, category, subject, year, q, status } = req.query;
  const clauses = [];
  const params = [];

  clauses.push('status = ?');
  params.push(status || 'active');

  if (exam) { clauses.push('exam = ?'); params.push(exam); }
  if (category) { clauses.push('category = ?'); params.push(category); }
  if (subject) { clauses.push('subject = ?'); params.push(subject); }
  if (year) { clauses.push('year = ?'); params.push(year); }
  if (q) { clauses.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')"); params.push(`%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`, `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM materials ${where} ORDER BY created_at DESC LIMIT 500`).all(...params);
  res.json({ materials: rows });
});

// ---- Upload new material ----
// POST /api/admin/materials  (multipart/form-data: file, title, exam, category, subject, year, description)
router.post('/materials', upload.single('file'), async (req, res) => {
  const { title, exam, category, subject, track, semester, material_category, year, description, is_imp, is_syllabus, is_pyq } = req.body || {};
  if (!title || !exam || !category) {
    return res.status(400).json({ error: 'title, exam, and category are required.' });
  }

  const fileErrors = validateUpload(req.file);
  if (fileErrors.length) {
    return res.status(400).json({ error: fileErrors.join(' ') });
  }

  const contentType = detectFileType(req.file.buffer);
  let fileBuffer = req.file.buffer;
  // Brand PDFs at upload time — the stored object is watermarked once, so
  // every download (CDN or presigned) serves the protected version.
  if (contentType === 'application/pdf') {
    try {
      fileBuffer = await stampPdf(fileBuffer);
    } catch (err) {
      console.error('[admin] PDF stamping failed:', err.message);
      return res.status(400).json({ error: 'This PDF could not be processed for watermarking. Try re-exporting or flattening it, then upload again.' });
    }
  }
  const objectKey = buildObjectKey({ exam, category, year }, contentType);
  const safeFileName = sanitizeFileName(req.file.originalname, contentType);

  // 1. Upload to R2 first. If this throws, we return before ever touching the DB.
  try {
    await uploadObject(objectKey, fileBuffer, contentType);
  } catch (err) {
    console.error('[admin] R2 upload failed:', err.message);
    return res.status(502).json({ error: 'Upload to storage failed. No record was created.' });
  }

  // 2. Insert metadata. If this fails, clean up the object we just uploaded
  //    so we never leave an orphaned file in R2.
  const id = uuidv4();
  const ts = nowIso();
  try {
    db.prepare(`
      INSERT INTO materials
        (id, title, exam, category, subject, track, semester, material_category, year, description, file_name, file_size, content_type, r2_object_key, status, is_imp, is_syllabus, is_pyq, uploaded_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `    ).run(
      id, title, exam, category, subject || null, track || null, semester || null, material_category || null, year ? parseInt(year, 10) : null,
      description || null, safeFileName, fileBuffer.length, contentType, objectKey, 'active',
      is_imp === 'true' || is_imp === '1' ? 1 : 0,
      is_syllabus === 'true' || is_syllabus === '1' ? 1 : 0,
      is_pyq === 'true' || is_pyq === '1' ? 1 : 0,
      (req.admin && req.admin.email) || null, ts, ts
    );
  } catch (err) {
    console.error('[admin] DB insert failed after R2 upload, cleaning up object:', objectKey, err.message);
    try {
      await deleteObject(objectKey);
    } catch (cleanupErr) {
      // Worst case: an orphaned object survives. Log loudly so it can be
      // found via a periodic reconciliation job (see README).
      console.error('[admin] CLEANUP FAILED — orphaned R2 object:', objectKey, cleanupErr.message);
    }
    return res.status(500).json({ error: 'Could not save material metadata. Upload was rolled back.' });
  }

  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  res.status(201).json({ material });
});

// ---- Edit metadata only (no file change) ----
// PATCH /api/admin/materials/:id
router.patch('/materials/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Material not found.' });

  const fields = ['title', 'exam', 'category', 'subject', 'track', 'semester', 'material_category', 'year', 'description', 'is_imp', 'is_syllabus', 'is_pyq'];
  const updates = {};
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates[f] = (f === 'is_imp' || f === 'is_syllabus' || f === 'is_pyq') ? (req.body[f] === 'true' || req.body[f] === '1' ? 1 : 0) : req.body[f];
    }
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No editable fields provided.' });
  }

  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  db.prepare(`UPDATE materials SET ${setClause}, updated_at = ? WHERE id = ?`)
    .run(...values, nowIso(), req.params.id);

  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  res.json({ material });
});

// ---- Replace the PDF file for an existing material ----
// PUT /api/admin/materials/:id/file  (multipart/form-data: file)
router.put('/materials/:id/file', upload.single('file'), async (req, res) => {
  const existing = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Material not found.' });

  const fileErrors = validateUpload(req.file);
  if (fileErrors.length) {
    return res.status(400).json({ error: fileErrors.join(' ') });
  }

  const contentType = detectFileType(req.file.buffer);
  let fileBuffer = req.file.buffer;
  // Same upload-time watermarking as the create route.
  if (contentType === 'application/pdf') {
    try {
      fileBuffer = await stampPdf(fileBuffer);
    } catch (err) {
      console.error('[admin] PDF stamping failed during replace:', err.message);
      return res.status(400).json({ error: 'This PDF could not be processed for watermarking. Nothing was changed.' });
    }
  }
  const newKey = buildObjectKey({ exam: existing.exam, category: existing.category, year: existing.year }, contentType);
  const safeFileName = sanitizeFileName(req.file.originalname, contentType);

  // 1. Upload the new file under a brand-new key (never overwrite in place).
  try {
    await uploadObject(newKey, fileBuffer, contentType);
  } catch (err) {
    console.error('[admin] R2 upload failed during replace:', err.message);
    return res.status(502).json({ error: 'Upload of the replacement file failed. Nothing was changed.' });
  }

  // 2. Point the DB row at the new key. Only after this succeeds do we
  //    touch the old object.
  const oldKey = existing.r2_object_key;
  try {
    db.prepare(`
      UPDATE materials
      SET r2_object_key = ?, file_name = ?, file_size = ?, content_type = ?, updated_at = ?
      WHERE id = ?
    `).run(newKey, safeFileName, fileBuffer.length, contentType, nowIso(), req.params.id);
  } catch (err) {
    console.error('[admin] DB update failed after replace-upload, cleaning up new object:', newKey, err.message);
    try {
      await deleteObject(newKey);
    } catch (cleanupErr) {
      console.error('[admin] CLEANUP FAILED — orphaned R2 object:', newKey, cleanupErr.message);
    }
    return res.status(500).json({ error: 'Could not update material record. Replacement was rolled back.' });
  }

  // 3. Only now delete the old object — the new one is confirmed live in the DB.
  try {
    await deleteObject(oldKey);
  } catch (err) {
    // Not fatal: the material now correctly points at the new file. The old
    // one just lingers as storage waste — log it for cleanup.
    console.error('[admin] Failed to delete old R2 object after replace (non-fatal):', oldKey, err.message);
  }

  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  res.json({ material });
});

// ---- Delete a material ----
// DELETE /api/admin/materials/:id
router.delete('/materials/:id', async (req, res) => {
  const existing = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Material not found.' });

  // Delete the R2 object first. Only remove the DB record once storage
  // deletion is confirmed (or confirmed already-gone) — never the reverse,
  // to avoid orphaned files that no metadata points to.
  try {
    await deleteObject(existing.r2_object_key);
  } catch (err) {
    console.error('[admin] R2 delete failed, DB record kept:', existing.r2_object_key, err.message);
    return res.status(502).json({
      error: 'Could not delete the file from storage. The material was NOT removed — please retry.',
    });
  }

  db.prepare('DELETE FROM materials WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Subjects (editable subject folders) ----

// ---- Create subject folder ----
// POST /api/admin/subjects  { exam, category, name }
router.post('/subjects', (req, res) => {
  const { exam, category, name } = req.body || {};
  const clean = (name || '').trim();
  if (!exam || !category || !clean) {
    return res.status(400).json({ error: 'exam, category and a subject name are required.' });
  }
  const existing = db.prepare('SELECT id FROM subjects WHERE exam = ? AND category = ? AND name = ?')
    .get(exam, category, clean);
  if (existing) return res.status(409).json({ error: 'That subject already exists in this category.' });

  const id = uuidv4();
  const ts = nowIso();
  try {
    db.prepare('INSERT INTO subjects (id, exam, category, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, exam, category, clean, ts, ts);
  } catch (err) {
    if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'That subject already exists in this category.' });
    }
    throw err;
  }
  const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(id);
  res.status(201).json({ subject });
});

// ---- Rename subject folder (and move its materials along) ----
// PATCH /api/admin/subjects/:id  { name }
router.patch('/subjects/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM subjects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Subject not found.' });

  const newName = (req.body.name || '').trim();
  if (!newName) return res.status(400).json({ error: 'A new subject name is required.' });

  const dup = db.prepare('SELECT id FROM subjects WHERE exam = ? AND category = ? AND name = ? AND id != ?')
    .get(existing.exam, existing.category, newName, existing.id);
  if (dup) return res.status(409).json({ error: 'A subject with that name already exists in this category.' });

  const oldName = existing.name;
  db.prepare('UPDATE subjects SET name = ?, updated_at = ? WHERE id = ?')
    .run(newName, nowIso(), existing.id);

  // Move any materials tagged with the old subject name so files follow it.
  db.prepare('UPDATE materials SET subject = ?, updated_at = ? WHERE exam = ? AND category = ? AND subject = ?')
    .run(newName, nowIso(), existing.exam, existing.category, oldName);

  const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(existing.id);
  res.json({ subject });
});

// ---- Delete subject folder (and everything filed under it) ----
// DELETE /api/admin/subjects/:id
router.delete('/subjects/:id', async (req, res) => {
  const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(req.params.id);
  if (!subject) return res.status(404).json({ error: 'Subject not found.' });

  const materials = db.prepare('SELECT * FROM materials WHERE exam = ? AND category = ? AND subject = ?')
    .all(subject.exam, subject.category, subject.name);

  // Delete every R2 object first (never leave orphaned files if any step fails).
  for (const m of materials) {
    try {
      await deleteObject(m.r2_object_key);
    } catch (err) {
      console.error('[admin] R2 delete failed for material on subject delete:', m.id, err.message);
      return res.status(502).json({
        error: 'Could not remove a file from storage — no subject was deleted. Please retry.',
      });
    }
  }
  for (const m of materials) {
    db.prepare('DELETE FROM materials WHERE id = ?').run(m.id);
  }
  db.prepare('DELETE FROM subjects WHERE id = ?').run(subject.id);
  res.json({ ok: true, removed_materials: materials.length });
});

const { REASON_LABELS } = require('./reports');

// ---- List content reports ----
// GET /api/admin/reports?status=open|resolved|dismissed|all
// Joins with the material so admins see the flagged file's context and the
// admin who uploaded it. Reports are read-only to everyone else.
router.get('/reports', (req, res) => {
  const status = req.query.status || 'open';
  const where =
    status === 'all' ? "WHERE 1 = 1" : "WHERE r.status = ?";
  const params = status === 'all' ? [] : [status];

  const rows = db.prepare(`
    SELECT
      r.id, r.reason, r.details, r.reporter_name, r.reporter_email, r.status,
      r.created_at, r.material_id,
      m.title AS material_title, m.exam, m.category, m.subject,
      m.semester, m.material_category, m.is_pyq, m.uploaded_by
    FROM reports r
    LEFT JOIN materials m ON m.id = r.material_id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT 500
  `).all(...params);

  const reports = rows.map((r) => ({
    ...r,
    reason_label: REASON_LABELS[r.reason] || r.reason,
  }));

  // Aggregate counts by status for the admin filter tabs.
  const counts = {};
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM reports GROUP BY status').all()) {
    counts[row.status] = row.n;
  }

  res.json({ reports, counts, total: rows.length });
});

// ---- Resolve / dismiss a report (admin only) ----
// PATCH /api/admin/reports/:id  { status: 'resolved' | 'dismissed' }
// "resolved" means the admin agreed and acted (e.g. removed the material);
// "dismissed" means the report was reviewed and rejected. Either way the
// report is closed and stops counting toward the material's report_count.
router.patch('/reports/:id', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });

  const status = req.body && req.body.status;
  if (!['resolved', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'status must be "resolved" or "dismissed".' });
  }
  if (report.status !== 'open') {
    return res.status(409).json({ error: 'This report has already been closed.' });
  }

  const ts = new Date().toISOString();
  db.prepare("UPDATE reports SET status = ? WHERE id = ?").run(status, req.params.id);

  // Decrement the material's live report count (floor at 0).
  if (report.material_id) {
    db.prepare("UPDATE materials SET report_count = MAX(0, report_count - 1), updated_at = ? WHERE id = ?")
      .run(ts, report.material_id);
  }

  const updated = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  res.json({ report: updated });
});

module.exports = router;
