const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/subjects?exam=&category=
// Lists subject folders. Used by the frontend to build editable subject grids
// (SEC, VAC, AEC, GE) instead of relying only on hardcoded lists.
router.get('/', (req, res) => {
  const { exam, category } = req.query;
  const clauses = [];
  const params = [];
  if (exam) { clauses.push('exam = ?'); params.push(exam); }
  if (category) { clauses.push('category = ?'); params.push(category); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT id, exam, category, name, created_at, updated_at FROM subjects ${where} ORDER BY name ASC`
  ).all(...params);

  res.json({ subjects: rows });
});

module.exports = router;