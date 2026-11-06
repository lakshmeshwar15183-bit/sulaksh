// Build a complete static catalog of EVERY material, split into 16 shards by
// the first hex character of the material id. view.html fetches just the one
// shard it needs, so any document opens without the Railway API.
//
// Shard row format: [id, r2_object_key, title, subject, semester, year]
//
// Usage: node scripts/build-full-material-index.js [input] [outputDir]
const fs = require('fs');
const path = require('path');

const IN = process.argv[2] || path.join(__dirname, 'archive-data', 'api-export.json');
const OUT_DIR = process.argv[3] || path.join(__dirname, '..', 'assets', 'data', 'material-shards');

const rows = JSON.parse(fs.readFileSync(IN, 'utf8'));
const shards = new Map();

for (const r of rows) {
  if (!r.id || !r.r2_object_key) continue;
  const first = String(r.id).toLowerCase()[0] || 'x';
  const shard = /^[0-9a-f]$/.test(first) ? first : 'x';
  if (!shards.has(shard)) shards.set(shard, []);
  shards.get(shard).push([
    r.id,
    r.r2_object_key,
    r.title || '',
    r.subject || '',
    r.semester || '',
    r.year || '',
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let total = 0;
for (const [shard, list] of [...shards.entries()].sort()) {
  list.sort((a, b) => a[0].localeCompare(b[0]));
  const file = path.join(OUT_DIR, `${shard}.json`);
  fs.writeFileSync(file, JSON.stringify(list), 'utf8');
  total += list.length;
  console.log(`  ${shard}.json: ${list.length} rows (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}
console.log(`wrote ${total} materials across ${shards.size} shards -> ${OUT_DIR}`);
