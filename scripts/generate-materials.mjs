// Generates a static materials/subjects snapshot from the backend and writes
// it to assets/data/*.json. The static site serves these, so the public
// materials listing works even when the Railway backend is down/sleeping.
//
// Run:  node scripts/generate-materials.mjs
// Env:  SULAKSH_API (backend base; defaults to Railway)
//
// On failure it exits 0 WITHOUT overwriting the previous snapshot, so a
// transient backend outage never wipes the last-known-good data.
import fs from 'fs';
import path from 'path';

const API = process.env.SULAKSH_API || 'https://sulaksh-backend-production.up.railway.app';
const OUT_DIR = 'assets/data';
const EXAM = 'DU & College';

async function get(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const [mats, subs] = await Promise.all([
    get(`${API}/api/materials`),
    get(`${API}/api/subjects?exam=${encodeURIComponent(EXAM)}`),
  ]);
  if (!mats || !Array.isArray(mats.materials)) throw new Error('materials payload unexpected');
  if (!subs || !Array.isArray(subs.subjects)) throw new Error('subjects payload unexpected');
  fs.writeFileSync(path.join(OUT_DIR, 'materials.json'), JSON.stringify(mats));
  fs.writeFileSync(path.join(OUT_DIR, 'subjects.json'), JSON.stringify(subs));
  console.log(`Wrote materials.json (${(mats.materials || []).length} items) + subjects.json (${(subs.subjects || []).length} subjects)`);
}

main().catch((e) => {
  console.error('materials snapshot skipped (backend unreachable) — keeping previous:', e.message);
  process.exit(0);
});
