const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

// Valid report reasons a visitor may choose from. Kept fixed so the data is
// clean and easy for admins to triage.
const VALID_REASONS = [
  'duplicate',
  'copyright',
  'irrelevant',
  'broken',
  'inappropriate',
  'other',
];

const REASON_LABELS = {
  duplicate: 'Duplicate content',
  copyright: 'Copyrighted / owned by someone else',
  irrelevant: 'Not relevant to this subject/semester',
  broken: "File is broken or won't open",
  inappropriate: 'Inappropriate content',
  other: 'Other',
};

// ---- Submit a report (open to any visitor, no auth) ----
// POST /api/reports  { material_id, reason, details?, reporter_name?, reporter_email? }
// Visitors can ONLY create a report — they never mutate or delete a material.
router.post('/', (req, res) => {
  const { material_id, reason, details, reporter_name, reporter_email } = req.body || {};

  if (!material_id || !reason) {
    return res.status(400).json({ error: 'material_id and reason are required.' });
  }
  if (!VALID_REASONS.includes(reason)) {
    return res.status(400).json({ error: 'Invalid report reason.' });
  }

  const material = db.prepare(
    "SELECT id, title, exam, category, subject, semester, material_category, is_pyq FROM materials WHERE id = ? AND status = 'active'"
  ).get(material_id);
  if (!material) {
    return res.status(404).json({ error: 'Material not found or no longer available.' });
  }

  const detailsText = String(details || '').trim().slice(0, 2000) || null;
  const name = String(reporter_name || '').trim().slice(0, 120) || null;
  const email = String(reporter_email || '').trim().toLowerCase().slice(0, 254) || null;

  const id = uuidv4();
  const ts = new Date().toISOString();

  db.prepare(`
    INSERT INTO reports (id, material_id, reason, details, reporter_name, reporter_email, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(id, material_id, reason, detailsText, name, email, ts);

  // Bump the material's live report_count so admins can spot hot items.
  db.prepare('UPDATE materials SET report_count = report_count + 1, updated_at = ? WHERE id = ?')
    .run(ts, material_id);

  res.status(201).json({ ok: true, report_id: id });
});

module.exports = router;
module.exports.VALID_REASONS = VALID_REASONS;
module.exports.REASON_LABELS = REASON_LABELS;
