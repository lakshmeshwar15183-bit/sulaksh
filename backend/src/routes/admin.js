const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { uploadObject, deleteObject, objectExists } = require('../r2');
const { validateUpload, buildObjectKey, sanitizeFileName, detectFileType, MAX_FILE_SIZE_BYTES } = require('../utils/validate');

const router = express.Router();
router.use(requireAdmin);

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
  if (q) { clauses.push('(title LIKE ? OR description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM materials ${where} ORDER BY created_at DESC LIMIT 500`).all(...params);
  res.json({ materials: rows });
});

// ---- Upload new material ----
// POST /api/admin/materials  (multipart/form-data: file, title, exam, category, subject, year, description)
router.post('/materials', upload.single('file'), async (req, res) => {
  const { title, exam, category, subject, year, description, is_imp } = req.body || {};
  if (!title || !exam || !category) {
    return res.status(400).json({ error: 'title, exam, and category are required.' });
  }

  const fileErrors = validateUpload(req.file);
  if (fileErrors.length) {
    return res.status(400).json({ error: fileErrors.join(' ') });
  }

  const contentType = detectFileType(req.file.buffer);
  const objectKey = buildObjectKey({ exam, category, year }, contentType);
  const safeFileName = sanitizeFileName(req.file.originalname, contentType);

  // 1. Upload to R2 first. If this throws, we return before ever touching the DB.
  try {
    await uploadObject(objectKey, req.file.buffer, contentType);
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
        (id, title, exam, category, subject, year, description, file_name, file_size, content_type, r2_object_key, status, is_imp, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `    ).run(
      id, title, exam, category, subject || null, year ? parseInt(year, 10) : null,
      description || null, safeFileName, req.file.size, contentType, objectKey, 'active',
      is_imp === 'true' || is_imp === '1' ? 1 : 0, ts, ts
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

  const fields = ['title', 'exam', 'category', 'subject', 'year', 'description', 'is_imp'];
  const updates = {};
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates[f] = f === 'is_imp' ? (req.body[f] === 'true' || req.body[f] === '1' ? 1 : 0) : req.body[f];
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
  const newKey = buildObjectKey({ exam: existing.exam, category: existing.category, year: existing.year }, contentType);
  const safeFileName = sanitizeFileName(req.file.originalname, contentType);

  // 1. Upload the new file under a brand-new key (never overwrite in place).
  try {
    await uploadObject(newKey, req.file.buffer, contentType);
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
    `).run(newKey, safeFileName, req.file.size, contentType, nowIso(), req.params.id);
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

module.exports = router;
