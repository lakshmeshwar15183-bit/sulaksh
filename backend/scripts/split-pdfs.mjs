#!/usr/bin/env node
// Split oversized PDFs into <22MB parts
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const _r = createRequire(import.meta.url);
const { PDFDocument } = _r('pdf-lib');

const DIR = '/Users/lakshmeshwarpandey/sulaksh-materials/DU & College/CORE/Economics/2025';
const TARGETS = [
  'Micro DSC1 Compiled PYQs 2011-18.pdf',
  'Micro DSC1 Complete Notes.pdf',
  'Micro DSC1 Extra Notes.pdf',
  'Micro DSC1 Notes Unit 2.pdf',
  'Micro DSC1 Shiv Das Compiled PYQs.pdf',
];
const MAX = 21 * 1024 * 1024;

async function saveRange(srcDoc, from, to) {
  const nd = await PDFDocument.create();
  const idx = [];
  for (let i = from; i < to; i++) idx.push(i);
  const cp = await nd.copyPages(srcDoc, idx);
  cp.forEach(p => nd.addPage(p));
  return Buffer.from(await nd.save());
}

for (const name of TARGETS) {
  const srcPath = path.join(DIR, name);
  if (!fs.existsSync(srcPath)) { console.log('SKIP missing', name); continue; }
  if (fs.statSync(srcPath).size <= MAX) { console.log('OK already small:', name); continue; }
  const srcBytes = fs.readFileSync(srcPath);
  const srcDoc = await PDFDocument.load(srcBytes);
  const n = srcDoc.getPageCount();
  const perPage = srcBytes.length / n;
  let perPart = Math.max(1, Math.floor((MAX * 0.92) / perPage));
  let part = 1, i = 0, okAll = true;
  const base = name.replace(/\.pdf$/, '');
  while (i < n) {
    const to = Math.min(n, i + perPart);
    const buf = await saveRange(srcDoc, i, to);
    const outFile = `${base} Part ${part}.pdf`;
    fs.writeFileSync(path.join(DIR, outFile), buf);
    fs.writeFileSync(outFile + '.json', JSON.stringify({
      semester: '1', material_category: 'notes', is_pyq: false,
      note: `Part ${part} of original ${name}`,
    }, null, 2));
    console.log(`  ${outFile} (${to - i} pages, ${(buf.length / 1048576).toFixed(1)}MB)`);
    i = to; part++;
  }
  console.log('✓ split complete:', name);
}
console.log('ALL-SPLIT-DONE');
