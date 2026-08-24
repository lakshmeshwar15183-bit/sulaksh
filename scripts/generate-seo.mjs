#!/usr/bin/env node
// SEO Generator v3 FINAL-MAX — sulaksh.online
// All families: per-paper, CORE overviews/per-sem/per-sem-type/sem-year/year,
// type-track overviews, GE/VAC/AEC/SEC subject×type×year, combined overviews,
// program semester mega-pages, hubs.
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.SULAKSH_API || 'https://sulaksh-backend-production.up.railway.app';
const SITE = 'https://sulaksh.online';
const OUT = path.resolve(process.cwd(), 'pyq');
const slug = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TRACK = { 'Honours': 'Honours', 'As Major': 'Major', 'As Minor': 'Minor' };
const TYPE_LABEL = { pyq: 'Previous Year Question Papers', syllabus: 'Syllabus PDF', notes: 'Notes & Study Material', 'imp-questions': 'Important Questions' };
const typeOf = m => m.material_category === 'syllabus' || m.is_syllabus ? 'syllabus'
  : m.material_category === 'pyqs' || m.is_pyq ? 'pyq'
  : m.material_category === 'important-questions' || m.is_imp ? 'imp-questions' : 'notes';
const AD1 = `<ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-9918653445662775" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script>`;
const AD2 = `<ins class="adsbygoogle" style="display:block;margin-top:20px" data-ad-client="ca-pub-9918653445662775" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script>`;
const listItem = m => {
  const t = typeOf(m).toUpperCase();
  return `<li><span class="pt">${esc(m.title)}</span><span class="ty">${t}</span><button onclick="openMat('${m.id}')">Open</button></li>`;
};

const res = await fetch(`${API}/api/materials`);
const { materials } = await res.json();
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'paper'), { recursive: true });

const pages = new Map();
function emit(file, title, desc, h1, badge, introHTML, bodyHTML, related = [], faqs = null) {
  if (!file) return;
  if (pages.has(file)) return;
  const F = Array.isArray(faqs) && faqs.length ? faqs : [
    ['Is this free?', 'Yes — every document on Sulaksh is completely free to view, no sign-up required.'],
    ['Is this official Delhi University material?', 'Yes — sourced from DU examinations under the UGCF/NEP framework.'],
  ];
  const rel = related && related.length ? `<h2>Related Papers</h2><div class="rel">${related.slice(0, 8).map(r => `<a href="/pyq/${r.file}">${esc(r.label)}</a>`).join('')}</div>` : '';
  const faqH = F.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('');
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/pyq/${file}">
<link rel="icon" type="image/png" href="/assets/images/favicon.png">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9918653445662775" crossorigin="anonymous"></script>
<style>body{font-family:Inter,system-ui,sans-serif;max-width:820px;margin:0 auto;padding:24px;color:#16233a;line-height:1.65}h1{font-size:26px;line-height:1.25}h2{font-size:19px;margin-top:28px}a{color:#1E5FFF;text-decoration:none}.badge{display:inline-block;background:#eef3ff;color:#1E5FFF;font-weight:700;font-size:12px;padding:4px 12px;border-radius:100px;margin-bottom:10px}.plist{list-style:none;padding:0}.plist li{display:flex;gap:10px;align-items:center;justify-content:space-between;border:1px solid #e4e9f1;border-radius:10px;padding:10px 14px;margin:8px 0}.pt{font-weight:600}.ty{font-size:10px;font-weight:800;background:#eef3ff;color:#1E5FFF;border-radius:100px;padding:2px 8px;margin-left:6px}.plist button,.openbtn{background:#0C2340;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer}.rel{display:flex;flex-wrap:wrap;gap:8px}.rel a{border:1px solid #e4e9f1;border-radius:100px;padding:6px 14px;font-size:13px;font-weight:600}.faq{background:#f6f8fc;border-radius:12px;padding:18px 22px;margin-top:26px}footer{margin-top:34px;font-size:13px;color:#5b6b80}footer a{font-weight:700}</style></head><body>
<span class="badge">${esc(badge)} · Delhi University · Free</span>
<h1>${esc(h1)}</h1>
${introHTML}
${AD1}
${bodyHTML}
${AD2}${rel}
<div class="faq"><h2>FAQs</h2>${faqH}</div>
<footer>Part of <a href="/">Sulaksh</a> — free study material for every aspirant. Browse <a href="/du.html">DU &amp; College resources</a> or the <a href="/pyq/index.html">complete PYQ index</a>.</footer>
<script>
const API='${API}';
async function openMat(id){try{const r=await fetch(API+'/api/materials/'+id+'/download?disposition=inline');const d=await r.json();if(d.url)window.open(d.url,'_blank');else alert(d.error||'Currently unavailable')}catch(e){alert('Please try again later')}}
</script>
</body></html>`;
  fs.mkdirSync(path.dirname(path.join(OUT, file)), { recursive: true });
  fs.writeFileSync(path.join(OUT, file), html);
  pages.set(file, title);
}

// ===== 1) PER-PAPER =====
for (const m of materials) {
  const t = typeOf(m);
  const tn = TYPE_LABEL[t] || 'Study Material';
  const semBit = m.semester ? ` Semester ${m.semester}` : '';
  const yr = m.year ? ` (${m.year})` : '';
  const file = `paper/${slug(m.title)}-${m.id.slice(0, 8)}.html`;
  const related = materials.filter(x => x.subject && x.subject === m.subject && x.id !== m.id).slice(0, 6)
    .map(x => ({ label: x.title.slice(0, 55), file: `paper/${slug(x.title)}-${x.id.slice(0, 8)}.html` }));
  emit(file,
    `${m.title} – DU ${tn}${semBit} | Free View | Sulaksh`,
    `${m.title} — official Delhi University ${tn.toLowerCase()}${semBit}, free to view instantly on Sulaksh.`,
    m.title,
    'Delhi University · Free',
    `<p><strong>${tn}</strong>${semBit} ${yr} · ${esc(m.exam || 'Delhi University')}${m.subject ? ' · ' + esc(m.subject) : ''}</p>
     <button class="openbtn" onclick="openMat('${m.id}')">📖 Open this document</button>
     <p style="margin-top:14px">Free to view — part of Sulaksh's complete DU collection.</p>`,
    '', related);
}

// ===== 2) CORE =====
const core = materials.filter(m => m.category === 'CORE' && String(m.subject || '').trim() && slug(m.subject));
const bySubjTrack = new Map();
for (const m of core) {
  const track = TRACK[m.track] || 'General';
  const key = `${m.subject}||${track}`;
  if (!bySubjTrack.has(key)) bySubjTrack.set(key, new Map());
  const sm = bySubjTrack.get(key);
  const sem = m.semester ? `Semester ${m.semester}` : 'Papers';
  if (!sm.has(sem)) sm.set(sem, []);
  sm.get(sem).push(m);
}
const ovFile = (s, t) => `${slug(s)}-${slug(t)}-pyqs.html`;
for (const [key, semMap] of bySubjTrack) {
  const [subject, track] = key.split('||');
  const total = [...semMap.values()].reduce((a, v) => a + v.length, 0);
  // overview
  emit(ovFile(subject, track),
    `${subject} ${track} PYQs, Syllabus & Notes – DU ${total} Docs | Sulaksh`,
    `All ${subject} ${track.toLowerCase()} material for Delhi University — ${total} docs, semester-wise PYQs, syllabus & notes. Free.`,
    `${subject} ${track} — Question Papers & Study Material`,
    'Delhi University · Core',
    `<p><strong>${total} documents</strong>, all free.</p>`,
    [...semMap.entries()].map(([sn, arr]) =>
      `<h2>${sn}</h2><ul class="plist">${arr.slice(0, 12).map(listItem).join('')}</ul>`).join(''),
    [...bySubjTrack.keys()].filter(k => k !== key && k.split('||')[0] === subject)
      .map(k => ({ file: ovFile(...k.split('||')), label: `${k.split('||')[0]} ${TRACK[k.split('||')[1]] ?? ''}` })));
  // per-sem + per-sem×type + per-sem×year
  for (const [semName, arr] of semMap) {
    const semNum = (semName.match(/\d+/) || [''])[0];
    const baseSlug = `${slug(subject)}-${slug(track)}-${semNum ? 'sem-' + semNum + '-' : ''}`;
    emit(`${baseSlug}pyqs.html`,
      `${subject} ${track} ${semName} PYQs & Material – DU | Sulaksh`,
      `${arr.length} documents for ${subject} ${track.toLowerCase()} ${semName.toLowerCase()} — Delhi University. Free instant view.`,
      `${subject} ${track} — ${semName}`,
      'Delhi University · Free',
      `<p>All <strong>${arr.length}</strong> documents for <strong>${semName}</strong>.</p>`,
      `<ul class="plist">${arr.map(listItem).join('')}</ul>`,
      [...semMap.keys()].filter(s2 => s2 !== semName).map(s2 => {
        const n2 = (s2.match(/\d+/) || [''])[0];
        return { file: `${slug(subject)}-${slug(track)}-${n2 ? 'sem-' + n2 + '-' : ''}pyqs.html`, label: `${subject} ${track} ${s2}` };
      }));
    const types = new Map(); const byYr = new Map();
    for (const m of arr) {
      const t = typeOf(m); if (!types.has(t)) types.set(t, []); types.get(t).push(m);
      const y = m.year || '2025'; if (!byYr.has(y)) byYr.set(y, []); byYr.get(y).push(m);
    }
    for (const [t, arr2] of types)
      emit(`${baseSlug}${t}.html`,
        `${subject} ${track} ${semName} ${TYPE_LABEL[t]} – DU Free | Sulaksh`,
        `${arr2.length} documents — Delhi University, free.`,
        `${subject} ${track} ${semName} — ${TYPE_LABEL[t]}`,
        'Delhi University · Free', `<p>${arr2.length} document(s).</p>`,
        `<ul class="plist">${arr2.map(listItem).join('')}</ul>`);
    for (const [y, arr2] of byYr)
      emit(`${baseSlug}${y}-pyqs.html`,
        `${subject} ${track} ${semName} PYQs ${y} – Delhi University | Sulaksh`,
        `${arr2.length} papers from ${y} — DU UGCF/NEP. Free instant view.`,
        `${subject} ${track} — ${semName} ${y}`,
        'Delhi University · Free', `<p>${arr2.length} document(s).</p>`,
        `<ul class="plist">${arr2.map(listItem).join('')}</ul>`);
  }
  // subject × track × year
  const byYearAll = new Map();
  for (const arr of semMap.values()) for (const m of arr) {
    const y = m.year || '2025'; if (!byYearAll.has(y)) byYearAll.set(y, []); byYearAll.get(y).push(m);
  }
  for (const [y, arr] of byYearAll)
    emit(`${slug(subject)}-${slug(track)}-${y}-pyqs.html`,
      `${subject} ${track} PYQs ${y} – Delhi University | Free | Sulaksh`,
      `${arr.length} ${subject} ${track.toLowerCase()} papers & material from ${y} — DU UGCF/NEP. Free.`,
      `${subject} ${track} — ${y} Papers`,
      'Delhi University · Free', `<p>${arr.length} document(s).</p>`,
      `<ul class="plist">${arr.map(listItem).join('')}</ul>`);
  // type × track overview (all sems)
  const typesAll = new Map();
  for (const arr of semMap.values()) for (const m of arr) {
    const t = typeOf(m); if (!typesAll.has(t)) typesAll.set(t, []); typesAll.get(t).push(m);
  }
  for (const [t, arr] of typesAll)
    emit(`${slug(subject)}-${slug(track)}-${t}-all.html`,
      `All ${subject} ${track} ${TYPE_LABEL[t]} – Across Semesters | Sulaksh`,
      `${arr.length} ${subject} ${track.toLowerCase()} ${TYPE_LABEL[t].toLowerCase()} documents across all semesters — DU. Free.`,
      `${subject} ${track} — All ${TYPE_LABEL[t]}`,
      'Delhi University · Free', `<p>${arr.length} document(s).</p>`,
      `<ul class="plist">${arr.map(listItem).join('')}</ul>`);
}

// ===== 3) GE/VAC/AEC/SEC =====
const CAT_LABEL = Object.fromEntries([['GE','Generic Elective'],['VAC','Value Added Course'],['AEC','Ability Enhancement Course'],['SEC','Skill Enhancement Course']]);
const cats = [['GE', 'Generic Elective'], ['VAC', 'Value Added Course'], ['AEC', 'Ability Enhancement Course'], ['SEC', 'Skill Enhancement Course']];
const ncByType = new Map(); const ncByYear = new Map(); const ncCombined = new Map();
for (const [cat, label] of cats) {
  const ms = materials.filter(m => (m.category || '').toUpperCase() === cat && String(m.subject || '').trim() && slug(m.subject));
  for (const m of ms) {
    const t = typeOf(m);
    const kT = `${cat}||${m.subject}||${t}`;
    if (!ncByType.has(kT)) ncByType.set(kT, []);
    ncByType.get(kT).push(m);
    const y = m.year || '2025';
    const kY = `${cat}||${m.subject}||${y}`;
    if (!ncByYear.has(kY)) ncByYear.set(kY, []);
    ncByYear.get(kY).push(m);
    const kC = `${cat}||${m.subject}`;
    if (!ncCombined.has(kC)) ncCombined.set(kC, { cat, label, subject: m.subject, items: [] });
    ncCombined.get(kC).items.push(m);
  }
}
for (const [k, arr] of ncByType) {
  const [cat, subject, type] = k.split('||');
  const tn = TYPE_LABEL[type] || type;
  const years = [...new Set(arr.map(m => m.year).filter(Boolean))].sort().join(', ');
  emit(`${cat.toLowerCase()}-${slug(subject)}-${type}.html`,
    `${subject} ${tn} – DU ${CAT_LABEL[cat]}${years ? ' ' + years : ''} | Free | Sulaksh`,
    `${arr.length} ${subject} ${CAT_LABEL[cat]} ${tn.toLowerCase()} — Delhi University NEP/UGCF, free instant view.`,
    `${subject} — ${tn} (${CAT_LABEL[cat]})`,
    CAT_LABEL[cat], `<p><strong>${arr.length}</strong> document(s).</p>`,
    `<ul class="plist">${arr.map(listItem).join('')}</ul>`);
}
for (const [k, arr] of ncByYear) {
  const [cat, subject, y] = k.split('||');
  emit(`${cat.toLowerCase()}-${slug(subject)}-${y}-pyqs.html`,
    `${subject} ${CAT_LABEL[cat]} PYQs ${y} – Delhi University | Sulaksh`,
    `${arr.length} ${subject} (${CAT_LABEL[cat]}) document(s) from ${y} — Delhi University, free.`,
    `${subject} — ${y}`,
    CAT_LABEL[cat], `<p>${arr.length} document(s).</p>`,
    `<ul class="plist">${arr.map(listItem).join('')}</ul>`);
}
for (const [k, v] of ncCombined) {
  if (v.items.length < 2) continue;
  emit(v.cat.toLowerCase() + '-' + slug(v.subject) + '-study-material.html',
    v.subject + ' Study Material – ' + v.label + ' PYQs, Syllabus & Notes | Sulaksh',
    v.items.length + ' ' + v.subject + ' documents (' + v.label + ') — PYQs, syllabus & notes. Delhi University. Free.',
    v.subject + ' — Complete Study Material (' + v.label + ')',
    v.label,
    '<p><strong>' + v.items.length + ' documents</strong> — everything available for this course.</p>',
    '<ul class="plist">' + v.items.map(listItem).join('') + '</ul>');
}

// ===== 4) PROGRAM SEMESTER MEGA PAGES =====
for (let N = 1; N <= 8; N++) {
  const items = materials.filter(m => String(m.semester) === String(N));
  if (!items.length) continue;
  emit(`du-ba-programme-sem-${N}-pyqs.html`,
    `DU BA Programme Semester ${N} PYQs & Study Material – All Subjects | Sulaksh`,
    `${items.length} Delhi University BA Programme semester ${N} question papers & study documents across all subjects. Free.`,
    `DU BA Programme — Semester ${N} Collection`,
    'Delhi University · Free',
    `<p>${items.length} documents.</p>`,
    `<ul class="plist">${items.slice(0, 300).map(listItem).join('')}</ul>`);
}

// ===== HUB =====
emit('index.html',
  'All DU Previous Year Question Papers, Syllabus & Notes – Free | Sulaksh',
  'Complete DU PYQs, syllabus & study material — BA/BSc/BCom majors, minors, honours, GE, VAC, AEC, SEC. Free.',
  'Delhi University PYQs & Study Material — Complete Index',
  'Master Index',
  '<p>Browse every Delhi University previous year question paper, syllabus and study material on Sulaksh. All free.</p>',
  '<p>Use your browser search (Ctrl+F) within the complete index, or pick a section from the site menu.</p>');

// ===== SITEMAP =====
fs.writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['', 'index.html', 'du.html', 'one-day.html', 'upsc.html', 'guides.html', 'contact.html']
    .concat([...pages.keys()].map(f => f === 'index.html' ? 'pyq/index.html' : 'pyq/' + f))
    .map(u => `  <url><loc>${SITE}/${u}</loc></url>`).join('\n')}
</urlset>\n`);

console.log(`✅ TOTAL SITEMAP URLs: ${7 + pages.size}`);
