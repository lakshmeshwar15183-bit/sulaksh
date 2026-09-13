// One-time migration: export the existing SQLite database into SQL for D1,
// and reset the admin password to a Cloudflare-native PBKDF2 hash (bcrypt
// exceeds the free-tier Workers CPU limit).
//
// Uses Node's built-in node:sqlite — no native modules needed.
//
// Usage (from the worker/ dir):
//   ADMIN_EMAIL=you@example.com \
//   ADMIN_PASSWORD='new-strong-password' \
//   DATABASE_PATH=../backend/data/sulaksh.db \
//   node migrate.mjs > out.sql
//   wrangler d1 execute sulaksh-db --file out.sql
//
// Existing bcrypt admin accounts are re-hashed to the email you pass here.

import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DB_PATH = process.env.DATABASE_PATH || '../backend/data/sulaksh.db';
const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const password = process.env.ADMIN_PASSWORD || '';

// Copy the live WAL-mode DB (+ wal/shm) to a temp dir and open the copy,
// otherwise committed-but-uncheckpointed rows (e.g. the subjects table) are
// invisible to a fresh read-only connection.
const tmpDir = mkdtempSync(join(tmpdir(), 'sulaksh-migrate-'));
const rawName = DB_PATH.split('/').pop();
const copyDb = join(tmpDir, rawName);
copyFileSync(DB_PATH, copyDb);
for (const suf of ['-wal', '-shm']) {
  const src = DB_PATH + suf;
  if (existsSync(src)) copyFileSync(src, join(tmpDir, rawName + suf));
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pbkdf2Hash(pw) {
  const iterations = 100000;
  const salt = randomBytes(16);
  const bits = pbkdf2Sync(pw, salt, iterations, 32, 'sha256');
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(bits)}`;
}
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD env vars.');
  process.exit(1);
}

const db = new DatabaseSync(copyDb);
const out = [];
out.push('BEGIN;');

const newHash = pbkdf2Hash(password);
for (const a of db.prepare('SELECT * FROM admins').all()) {
  const hash = a.email === email ? newHash : a.password_hash;
  out.push(`INSERT OR REPLACE INTO admins (id, email, password_hash, role, created_at) VALUES (${lit(a.id)}, ${lit(a.email)}, ${lit(hash)}, ${lit(a.role || 'super')}, ${lit(a.created_at)});`);
}

function dump(table, cols) {
  const exists = db.prepare(
    "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name = ?"
  ).get(table).n;
  if (!exists) {
    // Script must not die on a dev/local DB that predates the table.
    return;
  }
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  if (!rows.length) return;
  const colList = cols.join(', ');
  for (const r of rows) {
    out.push(`INSERT INTO ${table} (${colList}) VALUES (${cols.map((c) => lit(r[c])).join(', ')});`);
  }
}

const matCols = ['id','title','exam','category','subject','track','semester','material_category','year','description','file_name','file_size','content_type','r2_object_key','status','is_imp','is_syllabus','is_pyq','created_at','updated_at'];
dump('materials', matCols);
const subCols = ['id','exam','category','name','created_at','updated_at'];
dump('subjects', subCols);
const setCols = ['key','value'];
dump('settings', setCols);
const logCols = ['at','email','event','ok','ip','user_agent'];
dump('auth_log', logCols);

// auth_sessions are intentionally NOT migrated: they were signed with the old
// JWT secret and are dead after the new secret is set. Admins log in fresh.

out.push('COMMIT;');
console.log(out.join('\n'));
console.error(`[migrate] Admin password reset for: ${email}`);
console.error(`[migrate] Materials: ${db.prepare('SELECT COUNT(*) n FROM materials').get().n}`);
db.close();
rmSync(tmpDir, { recursive: true, force: true });