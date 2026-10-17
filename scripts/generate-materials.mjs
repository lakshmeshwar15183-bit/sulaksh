// Generates a static materials/subjects snapshot from the backend and writes
// it to assets/data/*.json. The static site serves these, so the public
// materials listing works even when the Railway backend is down/sleeping.
//
// Run:  node scripts/generate-materials.mjs
// Env:  SULAKSH_API (backend base; defaults to Railway)
//
// Resilience (Oct 2026): the backend can also come back as a STALE deploy —
// raw rows without track/semester/material_category/is_*/cdnUrl, and
// /api/subjects returning 404. In that case we:
//   - keep the previous subjects.json instead of failing the whole run
//   - re-enrich fetched rows by id from the previous snapshot
//   - derive semester/material_category from the title for unknown rows
// Only grouping metadata is filled in — ids, titles and file names are
// never touched.
//
// On failure it exits 0 WITHOUT overwriting the previous snapshot, so a
// transient backend outage never wipes the last-known-good data.
import fs from 'fs';
import path from 'path';

const API = process.env.SULAKSH_API || 'https://sulaksh-backend-production.up.railway.app';
const OUT_DIR = 'assets/data';
const EXAM = 'DU & College';
// Fields a stale backend can drop. Only ever copied onto rows whose own value
// is missing — live values always win, ids/titles/file names are untouched.
const ENRICH_FIELDS = ['track', 'semester', 'material_category', 'is_pyq', 'is_syllabus', 'is_imp', 'cdnUrl'];

const ROMAN_SEM = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };
// Title-based fallbacks, measured ~92% precision against the enriched
// snapshot (Oct 2026). Used only for rows the snapshot doesn't know about.
function deriveCategory(m) {
  const t = `${m.title || ''} ${m.file_name || ''}`.toLowerCase();
  if (/datesheet|date sheet|exam schedule/.test(t)) return 'datesheet';
  if (/\bpyq|previous year|question paper|question bank|\bqb\b|solved paper|past paper|model paper|examination|(nov|may)[\s\-_/]*(dec|june)[^a-z0-9]{0,3}\d{4}/.test(t)) return 'pyqs';
  if (/important/.test(t)) return 'important-questions';
  if (/syllabus/.test(t)) return 'syllabus';
  return 'notes';
}
function deriveSemester(m) {
  const src = `${m.title || ''} ${m.file_name || ''}`;
  const mm = src.match(/(?:^|[^A-Za-z])sem(?:ester)?[^A-Za-z0-9]{0,4}([ivxl]{1,4}|[1-8])\b/i);
  if (!mm) return null;
  const raw = mm[1].toLowerCase();
  for (const cand of [raw, raw.endsWith('l') ? raw.slice(0, -1) : '', raw.replace(/l/g, 'i')]) {
    if (!cand) continue;
    if (ROMAN_SEM[cand]) return String(ROMAN_SEM[cand]);
    const n = parseInt(cand, 10);
    if (n >= 1 && n <= 8) return String(n);
  }
  return null;
}

async function get(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

function readPreviousRows(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(OUT_DIR, file), 'utf8'));
    const arr = Array.isArray(parsed) ? parsed : parsed && parsed.materials;
    return Array.isArray(arr) ? arr : null;
  } catch (e) {
    return null;
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const prev = readPreviousRows('materials.json');
  const [mats, subs] = await Promise.all([
    // Exam-scoped: the snapshot backs DU & College pages, and the unfiltered
    // listing is capped server-side (PYQ Archive rows would crowd it out).
    get(`${API}/api/materials?exam=${encodeURIComponent(EXAM)}`),
    // A stale backend build can 404 here while materials still work — keep
    // serving the previous subject list instead of failing the whole sync.
    get(`${API}/api/subjects?exam=${encodeURIComponent(EXAM)}`).catch((e) => {
      console.warn(`subjects fetch failed (${e.message}) — keeping previous subjects.json`);
      return null;
    }),
  ]);
  if (!mats || !Array.isArray(mats.materials)) throw new Error('materials payload unexpected');

  // Re-enrich raw rows from the previous snapshot (matched by id), then derive
  // the fields the site groups by from the title where still missing.
  const byId = new Map(((prev || [])).filter((s) => s && s.id).map((s) => [s.id, s]));
  let merged = 0, derivedCat = 0, derivedSem = 0;
  for (const m of mats.materials) {
    const base = byId.get(m.id);
    if (base) {
      for (const k of ENRICH_FIELDS) {
        if ((m[k] === undefined || m[k] === null) && base[k] !== undefined && base[k] !== null) { m[k] = base[k]; merged++; }
      }
    }
    if (m.material_category === undefined || m.material_category === null) { m.material_category = deriveCategory(m); derivedCat++; }
    if (m.semester === undefined || m.semester === null) {
      const s = deriveSemester(m);
      if (s) { m.semester = s; derivedSem++; }
    }
    if (m.is_pyq === undefined || m.is_pyq === null) m.is_pyq = m.material_category === 'pyqs' ? 1 : 0;
    if (m.is_syllabus === undefined || m.is_syllabus === null) m.is_syllabus = m.material_category === 'syllabus' ? 1 : 0;
    if (m.is_imp === undefined || m.is_imp === null) m.is_imp = m.material_category === 'important-questions' ? 1 : 0;
  }
  console.log(`Enriched ${mats.materials.length} rows (merged ${merged} fields from previous snapshot; derived category for ${derivedCat}, semester for ${derivedSem})`);

  // The static snapshot is what `view.html` uses to open a document directly
  // from the CDN, with no backend call. If the backend omits `cdnUrl` (e.g. a
  // stale deploy), fill it in from the download endpoint so viewing still works
  // without depending on the rate-limited / cold backend. Stop at the first
  // 429 so we never trip the daily download limit.
  let enriched = 0, stopped = false;
  for (const m of mats.materials) {
    if (stopped) break;
    if (m.cdnUrl) continue;
    try {
      const r = await fetch(`${API}/api/materials/${m.id}/download?disposition=inline`, { cache: 'no-store' });
      if (r.status === 429) { stopped = true; break; }
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.url) { m.cdnUrl = d.url; enriched++; }
    } catch (e) { /* transient — leave for next run */ }
  }
  if (enriched) console.log(`Enriched ${enriched} materials with cdnUrl`);

  fs.writeFileSync(path.join(OUT_DIR, 'materials.json'), JSON.stringify(mats));
  if (subs && Array.isArray(subs.subjects)) {
    fs.writeFileSync(path.join(OUT_DIR, 'subjects.json'), JSON.stringify(subs));
  } else {
    console.log('subjects.json kept as-is (fetch failed)');
  }
  console.log(`Wrote materials.json (${(mats.materials || []).length} items)${subs ? ` + subjects.json (${(subs.subjects || []).length} subjects)` : ''}`);
}

main().catch((e) => {
  console.error('materials snapshot skipped (backend unreachable) — keeping previous:', e.message);
  process.exit(0);
});
