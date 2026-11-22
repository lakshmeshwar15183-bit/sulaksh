// Fetch EVERY material from the public API (all exams, paginated) and write a
// JSON export that scripts/build-full-material-index.js can turn into the
// static viewer shards.
//
// The public API strips r2_object_key but returns cdnUrl; the storage key is
// recovered from the CDN path so the static shards stay complete.
//
// Usage: node scripts/fetch-all-materials.mjs [output]
// Env:   SULAKSH_API (defaults to the Railway backend)
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.SULAKSH_API || 'https://sulaksh-backend-production.up.railway.app';
const OUT = process.argv[2] || path.join('.cache', 'all-materials-export.json');

async function get(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const all = [];
  let page = 1;
  let total = null;
  while (page <= 100) {
    const d = await get(`${API}/api/materials?limit=1000&page=${page}`);
    if (!d || !Array.isArray(d.materials)) throw new Error('unexpected materials payload');
    all.push(...d.materials);
    if (typeof d.total === 'number') total = d.total;
    if (d.materials.length < 1000) break;
    if (total !== null && all.length >= total) break;
    page++;
  }
  if (!all.length) throw new Error('no materials returned');

  // Recover the storage key from the public CDN URL when the API omits it.
  let derived = 0;
  let missing = 0;
  for (const m of all) {
    if (!m.r2_object_key && m.cdnUrl) {
      try {
        const p = new URL(m.cdnUrl).pathname.replace(/^\/file\//, '');
        m.r2_object_key = p.split('/').map(decodeURIComponent).join('/');
        derived++;
      } catch (e) { /* leave missing */ }
    }
    if (!m.r2_object_key) missing++;
  }

  // Never overwrite a healthy export with a suspiciously small one.
  let prevCount = 0;
  try {
    const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    prevCount = Array.isArray(prev) ? prev.length : (prev.materials || []).length;
  } catch (e) { /* first run */ }
  if (prevCount > 1000 && all.length < Math.floor(prevCount * 0.8)) {
    throw new Error(`refusing to overwrite export: fetched ${all.length} rows, previous ${prevCount}`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(all), 'utf8');
  console.log(`fetched ${all.length} materials (API total ${total}); derived ${derived} storage keys; missing ${missing}`);
  console.log(`wrote ${OUT}`);
  if (missing) console.warn(`WARNING: ${missing} rows have no storage key and will be omitted from shards`);
}

main().catch((e) => {
  console.error('fetch-all-materials failed:', e.message);
  process.exit(1);
});
