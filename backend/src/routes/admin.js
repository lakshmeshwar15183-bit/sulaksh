const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { uploadObject, deleteObject, objectExists } = require('../r2');
const { stampPdf } = require('../stamp');
const { validateUpload, buildObjectKey, sanitizeFileName, detectFileType, MAX_FILE_SIZE_BYTES } = require('../utils/validate');

const router = express.Router();
router.use(requireAdmin);

// ---- Role gate: 'maintenance' accounts may ONLY use the maintenance toggle.
// Everything else in /api/admin requires role 'super'.
const MAINTENANCE_ROUTES = new Set(['/maintenance']);
router.use((req, res, next) => {
  if ((req.admin.role || 'super') === 'super') return next();
  if (MAINTENANCE_ROUTES.has(req.path)) return next();
  return res.status(403).json({ error: 'This account does not have permission for that action.' });
});

// ---- Maintenance mode ----
// Only these emails (plus role='maintenance' accounts) may toggle the flag.
// Override with a comma-separated MAINTENANCE_EMAILS env var.
const MAINTENANCE_EMAILS = (process.env.MAINTENANCE_EMAILS || 'lakshmeshwar15183@gmail.com')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// GET current state (staff only)
router.get('/maintenance', (req, res) => {
  res.json({ enabled: db.getSetting('maintenance_mode') === '1' });
});
// POST { enabled: true|false } — site owner and maintenance-role accounts only
router.post('/maintenance', (req, res) => {
  const email = (req.admin.email || '').toLowerCase();
  const isMaintainer = (req.admin.role || 'super') === 'maintenance';
  if (!isMaintainer && !MAINTENANCE_EMAILS.includes(email)) {
    return res.status(403).json({ error: 'Only the site owner can toggle maintenance mode.' });
  }
  const enabled = req.body && (req.body.enabled === true || req.body.enabled === 'true');
  db.setSetting('maintenance_mode', enabled ? '1' : '0');
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
  if (q) { clauses.push('(title LIKE ? OR description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM materials ${where} ORDER BY created_at DESC LIMIT 5000`).all(...params);
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
        (id, title, exam, category, subject, track, semester, material_category, year, description, file_name, file_size, content_type, r2_object_key, status, is_imp, is_syllabus, is_pyq, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `    ).run(
      id, title, exam, category, subject || null, track || null, semester || null, material_category || null, year ? parseInt(year, 10) : null,
      description || null, safeFileName, req.file.size, contentType, objectKey, 'active',
      is_imp === 'true' || is_imp === '1' ? 1 : 0,
      is_syllabus === 'true' || is_syllabus === '1' ? 1 : 0,
      is_pyq === 'true' || is_pyq === '1' ? 1 : 0,
      ts, ts
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
  db.prepare('INSERT INTO subjects (id, exam, category, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, exam, category, clean, ts, ts);
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


// ---- Download kill-switch ----
// GET current state; POST { enabled: false } suspends public downloads.
router.get('/downloads-toggle', (req, res) => {
  res.json({ enabled: db.getSetting('downloads_disabled') !== '1' });
});

// Only these emails may flip the download kill-switch.
const DOWNLOADS_TOGGLE = (process.env.DOWNLOADS_TOGGLE_EMAILS || 'lakshmeshwar15183@gmail.com')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
router.post('/downloads-toggle', (req, res) => {
  const email = String(req.admin.email || '').toLowerCase();
  if (!DOWNLOADS_TOGGLE.includes(email)) {
    return res.status(403).json({ error: 'Only the site owner can change this.' });
  }
  const disable = !(req.body && req.body.enabled);
  db.setSetting('downloads_disabled', disable ? '1' : '0');
  res.json({ enabled: !disable });
});


// ---- Watermark toggle (owner only) ----
router.get('/watermark-toggle', (req, res) => {
  res.json({ enabled: db.getSetting('watermark_enabled') === '1' });
});
router.post('/watermark-toggle', (req, res) => {
  const email = String(req.admin.email || '').toLowerCase();
  if (!DOWNLOADS_TOGGLE.includes(email)) {
    return res.status(403).json({ error: 'Only the site owner can change this.' });
  }
  const enabled = !!(req.body && req.body.enabled);
  db.setSetting('watermark_enabled', enabled ? '1' : '0');
  res.json({ enabled });
});

module.exports = router;
