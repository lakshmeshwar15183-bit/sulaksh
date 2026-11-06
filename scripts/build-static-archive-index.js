// Build the static, browser-searchable PYQ index from the production export.
// Output format matches the OCR pipeline: { k, t, s, c, m, y }.
//
// Usage: node scripts/build-static-archive-index.js [input] [output]
const fs = require('fs');
const path = require('path');

const IN = process.argv[2] || path.join(__dirname, 'archive-data', 'api-export.json');
const OUT = process.argv[3] || path.join(__dirname, '..', 'assets', 'data', 'pyq-archive-index.json');

const MONTH_YEAR_RE = /\b(20\d{2})\b/;
const KEY_YEAR_RE = /\/pyq\/(20\d{2})\//;
const SEM_RE = /\bsem(?:ester)?[\s-]*([1-8])\b/i;
const DEDUP_RE = /\s*\((\d{1,3})\)\s*$/;

function deriveYear(row) {
  if (row.year != null && String(row.year).trim()) return String(row.year);
  const fromTitle = String(row.title || '').match(MONTH_YEAR_RE);
  if (fromTitle) return fromTitle[1];
  const fromKey = String(row.r2_object_key || '').match(KEY_YEAR_RE);
  if (fromKey) return fromKey[1];
  return '';
}

function deriveSemester(row) {
  if (row.semester != null && String(row.semester).trim()) return String(row.semester);
  const m = String(row.title || '').match(SEM_RE);
  return m ? m[1] : '';
}

function deriveCourse(row) {
  const track = String(row.track || '').trim();
  if (track) return track;
  const cat = String(row.category || '').trim();
  if (cat && cat.toUpperCase() !== 'PYQ') return cat;
  return '';
}

function cleanTitle(title) {
  return String(title || '').trim().replace(DEDUP_RE, '');
}

const rows = JSON.parse(fs.readFileSync(IN, 'utf8'));
const seen = new Set();
const out = [];

for (const row of rows) {
  if (row.is_pyq !== 1) continue;
  const key = String(row.r2_object_key || '').trim();
  if (!key || seen.has(key)) continue;
  seen.add(key);

  const subject = String(row.subject || '').trim();
  let title = cleanTitle(row.title);
  if (!title) title = subject || 'Untitled PYQ';
  // The archive rows already end in "PYQ"; keep new uploads consistent.
  if (subject && title.toLowerCase() === subject.toLowerCase()) title += ' PYQ';

  out.push({
    k: key,
    t: title,
    s: subject,
    c: deriveCourse(row),
    m: deriveSemester(row),
    y: deriveYear(row),
  });
}

out.sort((a, b) => a.t.localeCompare(b.t) || (Number(b.y || 0) - Number(a.y || 0)));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');
const bytes = fs.statSync(OUT).size;

const count = (fn) => out.filter(fn).length;
console.log(`wrote ${out.length} rows -> ${OUT} (${(bytes / 1e6).toFixed(2)} MB)`);
console.log(`with subject: ${count((r) => r.s)} | with year: ${count((r) => r.y)} | with semester: ${count((r) => r.m)} | with course: ${count((r) => r.c)}`);
const keys = fs.readFileSync(path.join(__dirname, 'archive-data', 'keys.txt'), 'utf8').trim().split('\n');
const outKeys = new Set(out.map((r) => r.k));
const missing = keys.filter((k) => !outKeys.has(k.trim()));
console.log(`archive keys covered: ${keys.length - missing.length}/${keys.length}`);
