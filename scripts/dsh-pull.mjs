#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const SITE_HTML = fs.readFileSync('/Users/lakshmeshwarpandey/sulaksh-website/du.html', 'utf8');
const getList = n => {
  const start = SITE_HTML.indexOf('const ' + n + ' = [');
  if (start < 0) return [];
  const seg = SITE_HTML.slice(start, SITE_HTML.indexOf('];', start));
  const names = []; const re = /'([^']+)'/g; let m;
  while ((m = re.exec(seg))) names.push(m[1]);
  return names;
};
const LISTS = { SEC: getList('SEC_SUBJECTS'), VAC: getList('VAC_SUBJECTS'), AEC: getList('AEC_SUBJECTS'), GE: getList('GE_SUBJECTS') };
const norm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const DSH = 'https://dustudenthelper.com';

const inv = JSON.parse(fs.readFileSync('/tmp/dsh-inventory.json', 'utf8'));
const seenKey = new Set(); const plan = [];
for (const o of inv) {
  const k = norm(o.name) + '|' + o.type;
  if (seenKey.has(k)) continue; seenKey.add(k);
  for (const c of ['SEC', 'VAC', 'AEC', 'GE']) {
    const hit = LISTS[c].find(s => norm(s) === norm(o.name));
    if (hit) { plan.push({ ...o, cat: c, subj: hit }); break; }
  }
}
console.log('Matched:', plan.length);

async function listDrive(id) {
  const html = await (await fetch(`https://drive.google.com/embeddedfolderview?id=${id}#list`)).text();
  const out = [];
  const re = /href="https:\/\/drive\.google\.com\/(file\/d|drive\/folders)\/([A-Za-z0-9_-]+)[\s\S]*?flip-entry-title">([^<]+)</g;
  let m;
  while ((m = re.exec(html))) out.push({ kind: m[1] === 'folders' ? 'dir' : 'file', id: m[2], name: m[3].trim() });
  return out;
}
async function fetchBuf(url) {
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}
async function fetchPdfBuf(id) {
  try {
    const buf = await fetchBuf(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
    return buf.subarray(0, 5).toString() === '%PDF-' ? buf : null;
  } catch { return null; }
}
async function walkFolder(fid, depth) {
  depth = depth || 0;
  if (depth > 2) return [];
  const items = await listDrive(fid); const out = [];
  for (const it of items) {
    if (it.kind === 'dir') out.push(...await walkFolder(it.id, depth + 1));
    else { const b = await fetchPdfBuf(it.id); if (b) out.push({ name: it.name, buf: b }); }
  }
  return out;
}

const ROOT = '/Users/lakshmeshwarpandey/sulaksh-materials/DU & College';
let okN = 0, failN = 0;

for (const p of plan) {
  {
    const link = p.link;
    const partBit = '';
    const base = `${p.name} ${p.type === 'pyq' ? 'PYQ' : 'Notes'}${p.year ? ' ' + p.year : ''}${partBit}`.replace(/\s+/g, ' ').trim();
    const dir = path.join(ROOT, p.cat, p.name);
    fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, base + '.pdf');
    if (fs.existsSync(outPath)) { console.log('SKIP', base); continue; }

    let buf = null;
    try {
      if (link.includes('/api/serve-file')) {
        buf = await fetchBuf(DSH + link);
      } else if (link.includes('/drive/folders/')) {
        const fid = link.match(/folders\/([A-Za-z0-9_-]+)/)[1];
        const inner = await walkFolder(fid);
        if (!inner.length) { console.log('✗ empty folder:', base); continue; }
        // merge all inner PDFs into one buffer-sequence file? no - save first only if single
        if (inner.length === 1) {
          buf = inner[0].buf;
        } else {
          // save each as Part files via separate loop below using raw buffers
          for (let pi = 0; pi < inner.length; pi++) {
            const nm = `${base} Part ${pi + 1}.pdf`;
            fs.writeFileSync(path.join(dir, nm), inner[pi].buf);
            fs.writeFileSync(path.join(dir, nm + '.json'), JSON.stringify({
              material_category: p.type === 'pyq' ? 'pyqs' : 'important-questions',
              is_pyq: p.type === 'pyq', is_imp: p.type !== 'pyq',
              year: p.year || null,
            }, null, 2));
            okN++; console.log('OK', nm);
          }
          continue;
        }
      } else if (link.includes('/file/d/')) {
        const fid = link.match(/file\/d\/([A-Za-z0-9_-]+)/)[1];
        buf = await fetchPdfBuf(fid);
      } else {
        console.log('? unknown link form:', link);
        continue;
      }
    } catch (e) {
      failN++; console.log('ERR', base, e.message);
      continue;
    }

    if (!buf || buf.subarray(0, 4).toString() !== '%PDF') {
      failN++; console.log('FAIL not-pdf:', base);
      continue;
    }
    fs.writeFileSync(outPath, buf);
    fs.writeFileSync(outPath + '.json', JSON.stringify({
      material_category: p.type === 'pyq' ? 'pyqs' : 'important-questions',
      is_pyq: p.type === 'pyq', is_imp: p.type !== 'pyq',
      year: p.year || null,
    }, null, 2));
    okN++; console.log('OK', base);
  }
}

console.log(`===> OK:${okN} FAIL:${failN}`);
