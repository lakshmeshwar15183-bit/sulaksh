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
  fs.writeFileSync(path.join(OUT_DIR, 'subjects.json'), JSON.stringify(subs));
  console.log(`Wrote materials.json (${(mats.materials || []).length} items) + subjects.json (${(subs.subjects || []).length} subjects)`);
}

main().catch((e) => {
  console.error('materials snapshot skipped (backend unreachable) — keeping previous:', e.message);
  process.exit(0);
});
