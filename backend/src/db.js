const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || './data/sulaksh.db';
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Schema ----
// status: 'active' | 'deleted' — deleted rows are only removed after the
// corresponding R2 object is confirmed gone (see routes/admin.js).
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  exam TEXT NOT NULL,
  category TEXT NOT NULL,
  subject TEXT,
  year INTEGER,
  description TEXT,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/pdf',
  r2_object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  is_imp INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

// ---- Migration for databases created before is_imp existed ----
// Must run before creating the is_imp index below.
const cols = db.prepare('PRAGMA table_info(materials)').all();
if (!cols.some((c) => c.name === 'is_imp')) {
  db.exec('ALTER TABLE materials ADD COLUMN is_imp INTEGER NOT NULL DEFAULT 0');
  console.log('[db] Added is_imp column to materials');
}

db.exec(`
CREATE INDEX IF NOT EXISTS idx_materials_exam ON materials(exam);
CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);
CREATE INDEX IF NOT EXISTS idx_materials_subject ON materials(subject);
CREATE INDEX IF NOT EXISTS idx_materials_year ON materials(year);
CREATE INDEX IF NOT EXISTS idx_materials_status ON materials(status);
CREATE INDEX IF NOT EXISTS idx_materials_is_imp ON materials(is_imp);
`);

module.exports = db;
