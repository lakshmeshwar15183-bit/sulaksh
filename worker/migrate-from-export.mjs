// One-time migration from the Railway export (JSON) into D1 SQL.
// Creates a fresh super-admin, all materials, subjects and default settings.
//
// Usage:
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' node migrate-from-export.mjs
//
// Then import the generated parts:
//   npx wrangler d1 execute sulaksh-db --remote --file=.d1-import/00-admin-settings.sql
//   for f in .d1-import/part-*.sql; do npx wrangler d1 execute sulaksh-db --remote --file="$f"; done

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

const IN = resolve(process.env.EXPORT_JSON || '../scripts/archive-data/api-export.json');
const SUBJECTS = resolve(process.env.SUBJECTS_JSON || '/tmp/subjects-export.json');
const OUT = resolve(process.env.OUT_DIR || './.d1-import');
const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const password = process.env.ADMIN_PASSWORD || '';
const PART_SIZE = parseInt(process.env.PART_SIZE || '500', 10);

if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD env vars.');
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pbkdf2Hash(pw) {
  const iterations = 100000;
  const salt = randomBytes(16);
  const bits = pbkdf2Sync(pw, salt, iterations, 32, 'sha256');
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(bits)}`;
}

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function num(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const materials = JSON.parse(readFileSync(IN, 'utf8'));
let subjects = [];
try {
  const parsed = JSON.parse(readFileSync(SUBJECTS, 'utf8'));
  subjects = Array.isArray(parsed) ? parsed : (parsed.subjects || []);
} catch (e) {
  console.warn(`[migrate] subjects file not found (${SUBJECTS}) — continuing without subjects`);
}

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
for (const f of (readdirSync(OUT))) {
  if (/^(00-admin-settings|part-\d+)\.sql$/.test(f)) rmSync(join(OUT, f));
}

const ts = new Date().toISOString();
const adminId = randomUUID();
const header = [
  'BEGIN;',
  `INSERT OR REPLACE INTO admins (id, email, password_hash, role, created_at) VALUES (${lit(adminId)}, ${lit(email)}, ${lit(pbkdf2Hash(password))}, 'super', ${lit(ts)});`,
  ...subjects.map((s) => `INSERT OR REPLACE INTO subjects (id, exam, category, name, created_at, updated_at) VALUES (${lit(s.id)}, ${lit(s.exam)}, ${lit(s.category)}, ${lit(s.name)}, ${lit(s.created_at || ts)}, ${lit(s.updated_at || ts)});`),
  `INSERT OR REPLACE INTO settings (key, value) VALUES ('maintenance_mode', '0');`,
  `INSERT OR REPLACE INTO settings (key, value) VALUES ('downloads_enabled', '1');`,
  `INSERT OR REPLACE INTO settings (key, value) VALUES ('deletes_enabled', '1');`,
  'COMMIT;',
];
writeFileSync(join(OUT, '00-admin-settings.sql'), header.join('\n'), 'utf8');

const cols = ['id', 'title', 'exam', 'category', 'subject', 'track', 'semester', 'material_category', 'year', 'description', 'file_name', 'file_size', 'content_type', 'r2_object_key', 'status', 'is_imp', 'is_syllabus', 'is_pyq', 'created_at', 'updated_at'];

let count = 0;
let part = 0;
let buf = [];
function flush() {
  if (!buf.length) return;
  part++;
  const name = `part-${String(part).padStart(4, '0')}.sql`;
  writeFileSync(join(OUT, name), ['BEGIN;', ...buf, 'COMMIT;'].join('\n'), 'utf8');
  buf = [];
}

for (const r of materials) {
  if (!r.id || !r.r2_object_key || !r.title || !r.exam || !r.category) continue;
  const row = [
    r.id, r.title, r.exam, r.category,
    r.subject || null, r.track || null, r.semester || null, r.material_category || null,
    num(r.year), r.description || null,
    r.file_name || 'document.pdf', num(r.file_size, 0),
    r.content_type || 'application/pdf', r.r2_object_key, 'active',
    num(r.is_imp, 0), num(r.is_syllabus, 0), num(r.is_pyq, 0),
    r.created_at || ts, r.updated_at || ts,
  ];
  buf.push(`INSERT OR REPLACE INTO materials (${cols.join(', ')}) VALUES (${row.map(lit).join(', ')});`);
  count++;
  if (buf.length >= PART_SIZE) flush();
}
flush();

console.log(`[migrate] admin: ${email}`);
console.log(`[migrate] materials: ${count}`);
console.log(`[migrate] subjects: ${subjects.length}`);
console.log(`[migrate] settings: maintenance=0 downloads=1 deletes=1`);
console.log(`[migrate] wrote ${part + 1} SQL file(s) -> ${OUT}`);
