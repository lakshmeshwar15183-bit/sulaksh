// Certificates & LOR verification API.
// Public:  GET /api/certificates/verify/:number  (no auth, public fields only)
// Admin:   everything else (requireAdmin + super/admin roles; maintenance denied)
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { generateCertificatePdf } = require('../utils/certificate-pdf');
const { uploadObject, deleteObject, getPresignedDownloadUrl } = require('../r2');

const router = express.Router();

const TYPES = { internship: 'INT', participation: 'PAR', lor: 'LOR', joining: 'JL' };
const SITE = (process.env.PUBLIC_SITE_URL || 'https://sulaksh.online').replace(/\/$/, '');
const NUMBER_RE = /^SUL-(INT|PAR|LOR|JL)-\d{4}-\d{4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const verifyUrlFor = (n) => `${SITE}/verify.html?id=${encodeURIComponent(n)}`;

function publicView(r) {
  return {
    certificate_number: r.certificate_number,
    certificate_type: r.certificate_type,
    recipient_name: r.recipient_name,
    role: r.role,
    start_date: r.start_date,
    end_date: r.end_date,
    issue_date: r.issue_date,
    description: r.description,
    issued_by_name: r.issued_by_name,
    issued_by_title: r.issued_by_title,
    department: r.department,
    supervisor: r.supervisor,
    responsibilities: r.responsibilities,
  };
}

function adminView(r) {
  return {
    id: r.id,
    ...publicView(r),
    status: r.status,
    has_pdf: !!r.r2_object_key,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---- Public verification (no auth) ----
// Only ever returns public fields. Numbers are sequential by design, so any
// response here is data the holder chose to publish — nothing private.
router.get('/verify/:number', (req, res) => {
  const number = String(req.params.number || '').trim().toUpperCase();
  if (!NUMBER_RE.test(number)) return res.status(404).json({ status: 'not_found' });
  const row = db.prepare('SELECT * FROM certificates WHERE certificate_number = ?').get(number);
  if (!row) return res.status(404).json({ status: 'not_found' });
  if (row.status === 'revoked') return res.json({ status: 'revoked', certificate: publicView(row) });
  return res.json({ status: 'valid', certificate: publicView(row) });
});

// ---- Admin-only below ----
router.use(requireAdmin);
router.use((req, res, next) => {
  const role = (req.admin && req.admin.role) || 'super';
  if (role === 'super' || role === 'admin') return next();
  return res.status(403).json({ error: 'Forbidden' });
});

// Atomic per-type-per-year sequence → SUL-INT-2026-0001. Never editable.
const nextNumber = db.transaction((type) => {
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT last_seq FROM certificate_counters WHERE type = ? AND year = ?').get(type, year);
  const seq = (row ? row.last_seq : 0) + 1;
  db.prepare(
    `INSERT INTO certificate_counters (type, year, last_seq) VALUES (?, ?, ?)
     ON CONFLICT(type, year) DO UPDATE SET last_seq = excluded.last_seq`
  ).run(type, year, seq);
  return `SUL-${TYPES[type]}-${year}-${String(seq).padStart(4, '0')}`;
});

function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function validateBody(b) {
  const fail = (m) => ({ ok: false, error: m });
  if (!b || typeof b !== 'object') return fail('Invalid request.');
  if (!TYPES[b.certificate_type]) return fail('Invalid certificate type.');
  const name = String(b.recipient_name || '').trim();
  if (name.length < 2 || name.length > 120) return fail('Recipient name must be 2–120 characters.');
  const role = String(b.role || '').trim();
  if (role.length < 2 || role.length > 160) return fail('Role/program must be 2–160 characters.');
  const sd = b.start_date ? String(b.start_date).trim() : null;
  const ed = b.end_date ? String(b.end_date).trim() : null;
  if (sd && !validDate(sd)) return fail('Invalid start date.');
  if (ed && !validDate(ed)) return fail('Invalid end date.');
  if (b.certificate_type === 'internship' && (!sd || !ed)) {
    return fail('Internships require start and end dates.');
  }
  if (sd && ed && ed < sd) return fail('End date cannot be before start date.');
  const issue = String(b.issue_date || '').trim();
  if (!validDate(issue)) return fail('Invalid issue date.');
  const desc = b.description ? String(b.description).trim() : null;
  if (desc && desc.length > 2000) return fail('Description too long (max 2000 characters).');
  const byName = String(b.issued_by_name || '').trim();
  if (byName.length < 2 || byName.length > 120) return fail('Issuing person name must be 2–120 characters.');
  const byTitle = b.issued_by_title ? String(b.issued_by_title).trim() : null;
  if (byTitle && byTitle.length > 120) return fail('Designation too long (max 120 characters).');
  const dept = b.department ? String(b.department).trim() : null;
  if (dept && dept.length > 120) return fail('Department too long (max 120 characters).');
  const sup = b.supervisor ? String(b.supervisor).trim() : null;
  if (sup && sup.length > 120) return fail('Supervisor name too long (max 120 characters).');
  const resp = b.responsibilities ? String(b.responsibilities).trim() : null;
  if (resp && resp.length > 2000) return fail('Responsibilities too long (max 2000 characters).');
  if (b.certificate_type === 'joining') {
    if (!sd || !ed) return fail('Joining letters require start and end dates.');
    if (!dept || dept.length < 2) return fail('Joining letters require a department / team.');
    if (!sup || sup.length < 2) return fail('Joining letters require a reporting supervisor.');
    if (!resp) return fail('Joining letters require key responsibilities.');
  }
  return {
    ok: true,
    value: {
      certificate_type: b.certificate_type,
      recipient_name: name,
      role,
      start_date: sd,
      end_date: ed,
      issue_date: issue,
      description: desc,
      issued_by_name: byName,
      issued_by_title: byTitle,
      department: dept,
      supervisor: sup,
      responsibilities: resp,
    },
  };
}

// List + search (number or recipient name)
router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  let rows;
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    rows = db.prepare(
      `SELECT * FROM certificates
       WHERE certificate_number LIKE ? ESCAPE '\\' OR recipient_name LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(like, like, limit, offset);
  } else {
    rows = db.prepare('SELECT * FROM certificates ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  }
  res.json({ certificates: rows.map(adminView) });
});

// Create: validate → number → PDF+QR → R2 → row (in that order; no row without a stored PDF)
router.post('/', async (req, res) => {
  const v = validateBody(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  let number;
  try {
    number = nextNumber(v.value.certificate_type);
  } catch (e) {
    console.error('[certificates] sequence failed:', e.message);
    return res.status(500).json({ error: 'Could not issue a certificate number.' });
  }
  const now = new Date().toISOString();
  const record = { id: uuidv4(), certificate_number: number, ...v.value, status: 'valid' };
  let pdf;
  try {
    pdf = await generateCertificatePdf(record, verifyUrlFor(number));
  } catch (e) {
    console.error('[certificates] pdf failed:', e.message);
    return res.status(500).json({ error: 'Could not generate the PDF.' });
  }
  const key = `certificates/${number}.pdf`;
  try {
    await uploadObject(key, pdf, 'application/pdf');
  } catch (e) {
    console.error('[certificates] storage failed:', e.message);
    return res.status(500).json({ error: 'Could not store the PDF.' });
  }
  try {
    db.prepare(
      `INSERT INTO certificates
       (id, certificate_number, certificate_type, recipient_name, role, start_date, end_date,
        issue_date, description, issued_by_name, issued_by_title, status,
        department, supervisor, responsibilities,
        r2_object_key, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, number, v.value.certificate_type, v.value.recipient_name, v.value.role,
      v.value.start_date, v.value.end_date, v.value.issue_date, v.value.description,
      v.value.issued_by_name, v.value.issued_by_title,
      v.value.department, v.value.supervisor, v.value.responsibilities,
      key, (req.admin && req.admin.email) || null, now, now
    );
  } catch (e) {
    console.error('[certificates] insert failed:', e.message);
    return res.status(500).json({ error: 'Could not save the certificate.' });
  }
  res.status(201).json({ certificate: adminView({ ...record, status: 'valid', r2_object_key: key, created_by: (req.admin && req.admin.email) || null, created_at: now, updated_at: now }), verify_url: verifyUrlFor(number) });
});

// Detail
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM certificates WHERE id = ?').get(String(req.params.id || ''));
  if (!row) return res.status(404).json({ error: 'Certificate not found.' });
  res.json({ certificate: adminView(row) });
});

// Revoke (idempotent). Revocation DESTROYS the stored PDF so the document can
// never be opened again — no proof of anything remains except the ledger row
// itself, which is what lets verification truthfully answer "Revoked" instead
// of "Not Found". Status is flipped first so revocation sticks even if storage
// is momentarily unreachable; the key is always cleared so no new download
// can ever be minted for a revoked certificate.
router.post('/:id/revoke', async (req, res) => {
  const row = db.prepare('SELECT * FROM certificates WHERE id = ?').get(String(req.params.id || ''));
  if (!row) return res.status(404).json({ error: 'Certificate not found.' });
  const now = new Date().toISOString();
  if (row.status !== 'revoked') {
    db.prepare('UPDATE certificates SET status = ?, updated_at = ? WHERE id = ?')
      .run('revoked', now, row.id);
  }
  if (row.r2_object_key) {
    try {
      await deleteObject(row.r2_object_key);
    } catch (e) {
      console.error('[certificates] revoke storage delete failed:', e.message);
    }
    db.prepare('UPDATE certificates SET r2_object_key = NULL, updated_at = ? WHERE id = ?')
      .run(now, row.id);
  }
  const fresh = db.prepare('SELECT * FROM certificates WHERE id = ?').get(row.id);
  res.json({ certificate: adminView(fresh) });
});

// Admin download (short-lived presigned URL, same pattern as materials).
// Revoked certificates can never be downloaded — their PDFs are destroyed.
router.get('/:id/download', async (req, res) => {
  const row = db.prepare('SELECT * FROM certificates WHERE id = ?').get(String(req.params.id || ''));
  if (!row) return res.status(404).json({ error: 'Certificate not found.' });
  if (row.status === 'revoked' || !row.r2_object_key) {
    return res.status(404).json({ error: 'No document available for this certificate.' });
  }
  try {
    const url = await getPresignedDownloadUrl(row.r2_object_key, {
      fileName: `${row.certificate_number}.pdf`,
      disposition: 'inline',
      contentType: 'application/pdf',
    });
    res.json({ url });
  } catch (e) {
    console.error('[certificates] download failed:', e.message);
    res.status(500).json({ error: 'Could not prepare the download.' });
  }
});

module.exports = router;
