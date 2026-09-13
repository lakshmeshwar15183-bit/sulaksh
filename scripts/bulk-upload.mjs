#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';

const API = process.env.SULAKSH_API || 'https://sulaksh-backend-production.up.railway.app';
const MAX_BYTES = 25 * 1024 * 1024;
const RETRIES = 3;
const STATE_FILE = path.join(os.homedir(), '.uploaded-sulaksh.json');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const ROOT = path.resolve(positional[0] || '.');
const DRY_RUN = flags.has('--dry-run');
const FRESH = flags.has('--fresh');

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  die(`Folder not found: ${ROOT}`);
}

function loadState() {
  if (FRESH || !fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && /\.pdf$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function resolveMeta(file) {
  const rel = path.relative(ROOT, file);
  const parts = rel.split(path.sep).slice(0, -1);
  const title = path.basename(file).replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
  if (parts.length === 0) return { error: 'file is directly in the root folder — put it inside <Exam>/<Category>/' };
  if (parts.length === 1) return { error: `missing category — use <Exam>/${parts[0]}/<Category>/` };
  const [exam, category, third, fourth] = parts;
  let subject = null;
  let year = null;
  const extras = [];
  for (const seg of [third, fourth].filter(Boolean)) {
    if (/^\d{4}$/.test(seg) && !year) year = seg;
    else if (!subject) subject = seg;
    else extras.push(seg);
  }
  const meta = { rel, title, exam, category, subject, year };
  const metaFile = path.join(path.dirname(file), '_meta.json');
  if (fs.existsSync(metaFile)) {
    try {
      Object.assign(meta, JSON.parse(fs.readFileSync(metaFile, 'utf8')));
    } catch {
      meta.warning = '_meta.json is invalid JSON and was ignored';
    }
  }
  const sideFile = `${file}.json`;
  if (fs.existsSync(sideFile)) {
    try {
      Object.assign(meta, JSON.parse(fs.readFileSync(sideFile, 'utf8')));
    } catch {
      meta.warning = 'sidecar json is invalid JSON and was ignored';
    }
  }
  const t = title.toLowerCase();
  if (/pyq|previous year|question paper/.test(t)) {
    meta.material_category = meta.material_category || 'pyqs';
    meta.is_pyq = true;
  } else if (/syllabus/.test(t)) {
    meta.material_category = meta.material_category || 'syllabus';
    meta.is_syllabus = true;
  } else if (/notes/.test(t)) {
    meta.material_category = meta.material_category || 'notes';
  } else if (/important question/.test(t)) {
    meta.material_category = meta.material_category || 'important-questions';
    meta.is_imp = true;
  }
  if (extras.length) meta.warning = `ignoring extra folder(s): ${extras.join(', ')}`;
  return meta;
}

async function prompt(what, hidden) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (!hidden) {
    const v = await rl.question(`${what}: `);
    rl.close();
    return v.trim();
  }
  process.stdout.write(`${what}: `);
  const chars = [];
  process.stdin.setRawMode(true);
  process.stdin.resume();
  await new Promise((resolve) => {
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve();
      } else if (ch === '\u0003') {
        process.exit(1);
      } else {
        chars.push(ch);
      }
    };
    process.stdin.on('data', onData);
  });
  rl.close();
  return Buffer.concat(chars.map((c) => (typeof c === 'string' ? Buffer.from(c) : c))).toString('utf8').trim();
}

async function login() {
  let email = process.env.SULAKSH_EMAIL;
  let password = process.env.SULAKSH_PASSWORD;
  if (!email) email = await prompt('Admin email');
  if (!password) password = await prompt('Password', true);
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) die(data.error || `Login failed (${res.status}).`);
  return data.token;
}

function looksLikePdf(buf) {
  return buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-';
}

async function upload(token, file, meta) {
  const buf = fs.readFileSync(file);
  const fd = new FormData();
  fd.append('title', meta.title);
  fd.append('exam', meta.exam);
  fd.append('category', meta.category);
  if (meta.subject) fd.append('subject', meta.subject);
  if (meta.semester !== undefined && meta.semester !== null && meta.semester !== '') fd.append('semester', String(meta.semester));
  if (meta.material_category) fd.append('material_category', meta.material_category);
  if (meta.track) fd.append('track', meta.track);
  if (meta.year) fd.append('year', String(meta.year));
  fd.append('is_imp', meta.is_imp ? 'true' : 'false');
  fd.append('is_syllabus', meta.is_syllabus ? 'true' : 'false');
  fd.append('is_pyq', meta.is_pyq ? 'true' : 'false');
  fd.append('file', new Blob([buf], { type: 'application/pdf' }), path.basename(file));

  let lastErr;
  for (let i = 0; i < RETRIES; i++) {
    try {
      const res = await fetch(`${API}/api/admin/materials`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
        signal: AbortSignal.timeout(180000),
      });
      if (res.status === 401) throw Object.assign(new Error('__RELOGIN__'), { code: 'RELOGIN' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data.material;
    } catch (err) {
      if (err.code === 'RELOGIN') throw err;
      lastErr = err;
      if (i < RETRIES - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

const state = loadState();
let files = walk(ROOT).sort();
if (!files.length) die(`No PDFs found under ${ROOT}`);

const plan = [];
for (const file of files) {
  const meta = resolveMeta(file);
  const size = fs.statSync(file).size;
  if (size > MAX_BYTES) {
    meta.error = `too large (${(size / 1048576).toFixed(1)}MB > 25MB limit)`;
  } else {
    try {
      const fd = fs.openSync(file, 'r');
      const head = Buffer.alloc(5);
      fs.readSync(fd, head, 0, 5, 0);
      fs.closeSync(fd);
      if (!looksLikePdf(head)) meta.error = 'not a valid PDF (magic bytes)';
    } catch {}
  }
  const st = state[file];
  meta.skipDone = st && st.size === size && Math.abs(st.mtimeMs - fs.statSync(file).mtimeMs) < 1000;
  plan.push({ file, meta, size });
}

console.log(`\n📋 Plan — ${plan.length} PDF(s) under ${ROOT}\n`);
for (const { meta } of plan) {
  const tags = [meta.subject, meta.year].filter(Boolean).join(' / ');
  const status = meta.error ? `✗ ${meta.error}` : meta.skipDone ? '↷ already uploaded' : '↑ ready';
  console.log(`  [${status}] ${meta.rel}\n      → exam="${meta.exam}" category="${meta.category}"${meta.subject ? ` subject="${meta.subject}"` : ''}${meta.year ? ` year=${meta.year}` : ''} title="${meta.title}"${meta.warning ? `\n      ⚠ ${meta.warning}` : ''}`);
}
const ready = plan.filter((p) => !p.meta.error && !p.meta.skipDone);
const blocked = plan.filter((p) => p.meta.error);
console.log(`\n   ${ready.length} to upload · ${plan.length - ready.length - blocked.length} already done · ${blocked.length} blocked\n`);

if (DRY_RUN) {
  console.log('Dry run only — nothing was uploaded. Run again without --dry-run to upload.');
  process.exit(blocked.length ? 2 : 0);
}

if (!ready.length) {
  console.log('Nothing to upload.');
  process.exit(0);
}

const token = await login();
console.log(`✓ Logged in → ${API}\n`);

const existingKeys = new Set();
try {
  const res = await fetch(`${API}/api/materials`);
  const data = await res.json();
  for (const m of data.materials || []) {
    existingKeys.add([m.title, m.exam, m.subject || '', String(m.semester ?? ''), m.track || '', m.year ? String(m.year) : ''].join('|'));
  }
} catch {}

let ok = 0;
const failures = [];
for (const { file, meta, size } of ready) {
  process.stdout.write(`↑ Uploading ${meta.rel} … `);
  const dedupeKey = [meta.title, meta.exam, meta.subject || '', String(meta.semester ?? ''), meta.track || '', meta.year ? String(meta.year) : ''].join('|');
  if (existingKeys.has(dedupeKey)) {
    console.log('skipped ↷ identical title/year already on server');
    continue;
  }
  try {
    let material;
    try {
      material = await upload(token, file, meta);
    } catch (err) {
      if (err.code === 'RELOGIN') {
        tokenRef.t = await login();
        material = await upload(tokenRef.t, file, meta);
      } else throw err;
    }
    state[file] = { size, mtimeMs: fs.statSync(file).mtimeMs, id: material?.id };
    saveState(state);
    existingKeys.add(dedupeKey);
    ok++;
    console.log('done ✓');
  } catch (err) {
    failures.push({ rel: meta.rel, err: err.message });
    console.log(`FAILED ✗ ${err.message}`);
  }
}
saveState(state);

console.log(`\n🏁 Done — ${ok}/${ready.length} uploaded.`);
for (const f of failures) console.log(`   ✗ ${f.rel}: ${f.err}`);
if (ok > 0) console.log('\nMaterials are live on the site (may take a refresh to appear).');
process.exit(failures.length ? 1 : 0);

