// One-off: export every active material row from the production API.
// Usage: node scripts/export-from-api.js [outfile]
const fs = require('fs');
const path = require('path');

const API = process.env.API_BASE || 'https://sulaksh-backend-production.up.railway.app';
const OUT = process.argv[2] || path.join(__dirname, 'archive-data', 'api-export.json');
const PAGE = 1000;

async function getJson(url, tries = 5) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

function keyFromCdn(cdnUrl) {
  if (!cdnUrl) return '';
  try {
    const u = new URL(cdnUrl);
    const m = u.pathname.match(/^\/file\/(.+)$/);
    if (!m) return '';
    return m[1].split('/').map(decodeURIComponent).join('/');
  } catch {
    return '';
  }
}

(async () => {
  const all = [];
  let page = 1;
  let total = null;
  while (true) {
    const data = await getJson(`${API}/api/materials?limit=${PAGE}&page=${page}`);
    if (data.maintenance) throw new Error('API is in maintenance mode');
    const rows = data.materials || [];
    total = data.total;
    for (const row of rows) row.r2_object_key = row.r2_object_key || keyFromCdn(row.cdnUrl);
    all.push(...rows);
    console.log(`page ${page}: ${rows.length} rows (${all.length}/${total})`);
    if (!rows.length || all.length >= total) break;
    page++;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(all));
  console.log(`\nwrote ${all.length} rows -> ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);

  const pyq = all.filter((r) => r.is_pyq === 1);
  const withKey = pyq.filter((r) => r.r2_object_key);
  console.log(`PYQ rows: ${pyq.length}; with storage key: ${withKey.length}`);
  const cats = {};
  for (const r of pyq) cats[r.category] = (cats[r.category] || 0) + 1;
  console.log('PYQ categories:', cats);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
