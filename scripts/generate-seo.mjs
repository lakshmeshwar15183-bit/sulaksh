#!/usr/bin/env node
// SEO Generator v4 FINAL — site-branded pages
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.SULAKSH_API || 'https://sulaksh-backend-production.up.railway.app';
const SITE = 'https://sulaksh.online';
const OUT = path.resolve(process.cwd(), 'pyq');
const slug = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TRACK = { 'Honours': 'Honours', 'As Major': 'Major', 'As Minor': 'Minor' };
const TYPE_LABEL = { pyq: 'Previous Year Question Papers', syllabus: 'Syllabus PDF', notes: 'Notes & Study Material', 'imp-questions': 'Important Questions', imp: 'Important Questions' };
const typeOf = m => m.material_category === 'syllabus' || m.is_syllabus ? 'syllabus'
  : m.material_category === 'pyqs' || m.is_pyq ? 'pyq'
  : m.material_category === 'important-questions' || m.is_imp ? 'imp-questions' : 'notes';

const res = await fetch(`${API}/api/materials`);
const { materials } = await res.json();

const CSS = `
:root{--navy:#0C2340;--blue:#1E5FFF;--bg:#F6F8FC;--card:#fff;--text:#1A2433;--muted:#5B6B80;--border:#E4E9F1}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.65}
header{background:var(--card);border-bottom:1px solid var(--border)}
.nav{display:flex;align-items:center;gap:10px;padding:10px 18px;max-width:1100px;margin:0 auto}
.brand{display:flex;align-items:center;gap:8px;text-decoration:none}
.brand .e{height:34px}.brand .w{height:18px}
.spacer{flex:1}
.nav a.b{font-size:12.5px;font-weight:800;background:var(--navy);color:#fff;padding:7px 13px;border-radius:8px;text-decoration:none}
.wrap{max-width:900px;margin:0 auto;padding:26px 20px}
.badge{display:inline-block;background:rgba(30,95,255,.08);color:var(--blue);font-weight:800;font-size:12px;padding:4px 12px;border-radius:100px;margin-bottom:8px}
h1{font-family:'Sora',system-ui,sans-serif;font-size:23px;line-height:1.3;margin:4px 0 2px}
.intro{color:var(--muted);margin:10px 0 16px}
h2{font-family:'Sora',system-ui;font-size:17px;margin-top:24px}
.plist{list-style:none;padding:0}
.plist li{display:flex;gap:10px;align-items:center;justify-content:space-between;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin:8px 0}
.pt{font-weight:600}.ty{font-size:10px;font-weight:800;background:rgba(30,95,255,.08);color:var(--blue);border-radius:100px;padding:2px 8px;margin-left:6px}
.plist button{background:var(--navy);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer}
.rel{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}.rel a{background:var(--card);border:1px solid var(--border);border-radius:100px;padding:6px 14px;font-size:13px;font-weight:600;color:var(--text)}
footer{background:var(--navy);color:#cfd9ec;margin-top:40px;padding:26px 20px;text-align:center;font-size:13px}
footer b{color:#fff}footer a{color:#fff;font-weight:700;text-decoration:none}
@media(max-width:600px){h1{font-size:20px}}
`;

function pageHTML(o) {
  const faqH = (o.faqs || []).map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('');
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}">
<link rel="canonical" href="${SITE}/pyq/${o.file}">
<link rel="icon" type="image/png" href="/assets/images/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9918653445662775" crossorigin="anonymous"></script>
<style>${CSS}</style></head>
<body>
<header><div class="nav">
<a class="brand" href="/"><img class="e" src="/assets/images/sulaksh-emblem.png" alt="Sulaksh - Delhi University previous year question papers and study material"><img class="w" src="/assets/images/sulaksh-wordmark.png" alt="SULAKSH - DU PYQs syllabus notes free download"></a>
<span class="spacer"></span>
<a class="b" href="/pyq/index.html">All PYQs</a>
<a class="b" href="/du.html">DU &amp; College</a>
<a class="b" href="/">Home</a>
</div></header>
<div class="wrap">
<span class="badge">${esc(o.badge)} · Delhi University · Free</span>
<h1>${esc(o.h1)}</h1>
${o.intro}
<div class="ad"><ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-9918653445662775" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script></div>
${o.body}
<div class="ad"><ins class="adsbygoogle" style="display:block;margin-top:20px" data-ad-client="ca-pub-9918653445662775" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script></div>
${o.relHtml}
${o.aboutBlock || ""}
<div class="faq"><h2>FAQs</h2>${o.faqH}</div>
</div>
<footer><b>SULAKSH</b> — Learn. Prepare. Achieve.<br>Free study material for every DU aspirant · <a href="/">Home</a> · <a href="/du.html">DU &amp; College</a> · <a href="/pyq/index.html">All PYQs</a></footer>
<script>
const API='${API}';
async function openMat(id){location.href='/view.html?id='+encodeURIComponent(id)}
(adsbygoogle = window.adsbygoogle || []).push({});
</script>
</body></html>`;
}

const pages = new Map();
function emit(file, title, desc, h1, badge, intro, body, relItems, faqs) {
  if (pages.has(file)) return;
  const faqH = (faqs && faqs.length ? faqs : [
    ['Is this free?', 'Yes — every document on Sulaksh is completely free to view, no sign-up required.'],
    ['Is this official Delhi University material?', 'Yes — sourced from DU examinations under the UGCF/NEP framework.'],
  ]).map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('');
  const relHtml = (relItems && relItems.length)
    ? '<h2>Related Papers</h2><div class="rel">' + relItems.map(r => `<a href="${SITE}/pyq/${r.file}">${esc(r.label)}</a>`).join('') + '</div>' : '';
  const aboutBlock = `
    <h2>About This Collection</h2>
    <p>These <strong>Delhi University previous year question papers and study materials</strong> are among the most searched resources by BA, BSc and BCom students under the <strong>NEP/UGCF framework</strong>. Solving previous year question papers is the single most effective way to understand DU's exam pattern, marking scheme and frequently repeated questions. Every paper here is free to view.</p>
    <p>Pair these papers with semester notes, the official DU syllabus and timed practice for maximum scores. Recent years' papers carry the most weight as they follow the latest pattern.</p>
    <p>Official links: <a href="https://www.du.ac.in" target="_blank" rel="noopener">University of Delhi</a> · <a href="http://exam.du.ac.in" target="_blank" rel="noopener">DU Exam Portal</a></p>`;
  const html = pageHTML({ title, desc, h1, badge, intro, body, relHtml, faqH, file, aboutBlock });
  fs.mkdirSync(path.dirname(path.join(OUT, file)), { recursive: true });
  fs.writeFileSync(path.join(OUT, file), html);
  pages.set(file, title);
}
const listItem = m => {
  const t = (m.material_category === 'syllabus' || m.is_syllabus) ? 'SYLLABUS'
    : (m.material_category === 'pyqs' || m.is_pyq) ? 'PYQ'
    : (m.material_category === 'important-questions' || m.is_imp) ? 'IMP Q' : 'NOTES';
  return `<li><span class="pt">${esc(m.title)}</span><span class="ty">${t}</span><button onclick="openMat('${m.id}')">Open</button></li>`;
};

// ===== 1) PER-PAPER =====
for (const m of materials) {
  const t = (m.material_category === 'syllabus' || m.is_syllabus) ? 'SYLLABUS'
    : (m.material_category === 'pyqs' || m.is_pyq) ? 'PYQ'
    : (m.material_category === 'important-questions' || m.is_imp) ? 'IMP Q' : 'NOTES';
  const tn = t === 'PYQ' ? 'Previous Year Question Paper' : t === 'SYLLABUS' ? 'Syllabus' : t === 'IMP Q' ? 'Important Questions' : 'Study Material';
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
     <button class="plist button" onclick="openMat('${m.id}')">📖 Open this document</button>
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
      const tt = (m.material_category === 'syllabus' || m.is_syllabus) ? 'syllabus'
        : (m.material_category === 'pyqs' || m.is_pyq) ? 'pyq'
        : (m.material_category === 'important-questions' || m.is_imp) ? 'imp' : 'notes';
      if (!types.has(tt)) types.set(tt, []); types.get(tt).push(m);
      const y = m.year || '2025'; if (!byYr.has(y)) byYr.set(y, []); byYr.get(y).push(m);
    }
    const TN = { pyq: 'PYQ', syllabus: 'Syllabus', imp: 'Important Questions', notes: 'Notes' };
    for (const [t, arr2] of types)
      emit(`${baseSlug}${t}.html`,
        `${subject} ${track} ${semName} ${TN[t]} – DU Free | Sulaksh`,
        `${arr2.length} documents — Delhi University, free.`,
        `${subject} ${track} ${semName} — ${TN[t]}`,
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
  const typesAll = new Map();
  for (const arr of semMap.values()) for (const m of arr) {
    const tt = (m.material_category === 'syllabus' || m.is_syllabus) ? 'syllabus'
      : (m.material_category === 'pyqs' || m.is_pyq) ? 'pyq'
      : (m.material_category === 'important-questions' || m.is_imp) ? 'imp' : 'notes';
    if (!typesAll.has(tt)) typesAll.set(tt, []); typesAll.get(tt).push(m);
  }
  const TNA = { pyq: 'PYQ', syllabus: 'Syllabus', imp: 'Important Questions', notes: 'Notes' };
  for (const [t, arr] of typesAll)
    emit(`${slug(subject)}-${slug(track)}-${t}-all.html`,
      `All ${subject} ${track} ${TNA[t]} – Across Semesters | Sulaksh`,
      `${arr.length} ${subject} ${track.toLowerCase()} ${TNA[t].toLowerCase()} documents across all semesters — DU. Free.`,
      `${subject} ${track} — All ${TNA[t]}`,
      'Delhi University · Free', `<p>${arr.length} document(s).</p>`,
      `<ul class="plist">${arr.map(listItem).join('')}</ul>`);
}

// ===== 3) GE/VAC/AEC/SEC =====
const CAT_LABEL = Object.fromEntries([['GE', 'Generic Elective'], ['VAC', 'Value Added Course'], ['AEC', 'Ability Enhancement Course'], ['SEC', 'Skill Enhancement Course']]);
const ncByType = new Map(); const ncByYear = new Map(); const ncCombined = new Map();
for (const [cat, label] of [['GE', 'Generic Elective'], ['VAC', 'Value Added Course'], ['AEC', 'Ability Enhancement Course'], ['SEC', 'Skill Enhancement Course']]) {
  const ms = materials.filter(m => (m.category || '').toUpperCase() === cat && String(m.subject || '').trim() && slug(m.subject));
  for (const m of ms) {
    const t = (m.material_category === 'syllabus' || m.is_syllabus) ? 'syllabus'
      : (m.material_category === 'pyqs' || m.is_pyq) ? 'pyq'
      : (m.material_category === 'important-questions' || m.is_imp) ? 'imp' : 'notes';
    const kT = cat + '|' + m.subject + '|' + t;
    if (!ncByType.has(kT)) ncByType.set(kT, []); ncByType.get(kT).push(m);
    const y = m.year || '2025';
    const kY = cat + '|' + m.subject + '|' + y;
    if (!ncByYear.has(kY)) ncByYear.set(kY, []); ncByYear.get(kY).push(m);
    const kC = cat + '|' + m.subject;
    if (!ncCombined.has(kC)) ncCombined.set(kC, { cat, label, subject: m.subject, items: [] });
    ncCombined.get(kC).items.push(m);
  }
}
for (const [k, arr] of ncByType) {
  const [cat, subject, type] = k.split('|');
  emit(cat.toLowerCase() + '-' + slug(subject) + '-' + type + '.html',
    subject + ' ' + TYPE_LABEL[type] + ' - DU ' + CAT_LABEL[cat] + ' | Free | Sulaksh',
    arr.length + ' ' + subject + ' ' + CAT_LABEL[cat] + ' ' + TYPE_LABEL[type].toLowerCase() + ' - Delhi University NEP/UGCF, free instant view.',
    subject + ' - ' + TYPE_LABEL[type] + ' (' + CAT_LABEL[cat] + ')',
    CAT_LABEL[cat], '<p><strong>' + arr.length + '</strong> document(s).</p>',
    '<ul class="plist">' + arr.map(listItem).join('') + '</ul>');
}
for (const [k, arr] of ncByYear) {
  const [cat, subject, y] = k.split('|');
  emit(cat.toLowerCase() + '-' + slug(subject) + '-' + y + '-pyqs.html',
    subject + ' ' + CAT_LABEL[cat] + ' PYQs ' + y + ' - Delhi University | Sulaksh',
    arr.length + ' ' + subject + ' (' + CAT_LABEL[cat] + ') document(s) from ' + y + ' - Delhi University, free.',
    subject + ' - ' + y,
    CAT_LABEL[cat], '<p>' + arr.length + ' document(s).</p>',
    '<ul class="plist">' + arr.map(listItem).join('') + '</ul>');
}
for (const [k, v] of ncCombined) {
  if (v.items.length < 2) continue;
  emit(v.cat.toLowerCase() + '-' + slug(v.subject) + '-study-material.html',
    v.subject + ' Study Material - ' + v.label + ' PYQs, Syllabus & Notes | Sulaksh',
    v.items.length + ' ' + v.subject + ' documents (' + v.label + ') - PYQs, syllabus & notes. Delhi University. Free.',
    v.subject + ' - Complete Study Material (' + v.label + ')',
    v.label,
    '<p><strong>' + v.items.length + ' documents</strong> - everything available for this course.</p>',
    '<ul class="plist">' + v.items.map(listItem).join('') + '</ul>');
}

// ===== hub =====
emit('index.html',
  'All DU Previous Year Question Papers, Syllabus & Notes - Free | Sulaksh',
  'Complete DU PYQs, syllabus & study material - BA/BSc/BCom majors, minors, honours, GE, VAC, AEC, SEC. Free.',
  'Delhi University PYQs & Study Material - Complete Index',
  'Master Index',
  '<p>Browse every Delhi University previous year question paper, syllabus and study material on Sulaksh. All free.</p>',
  '<p>Use browser search (Ctrl+F) or pick your subject from <a href="/du.html">DU & College sections</a>.</p>');

// ===== sitemap =====
const INFO_EXTRA = ['where-to-find-du-pyqs.html', 'where-to-find-du-syllabus.html', 'best-website-for-du-pyqs-study-material.html'];
fs.writeFileSync('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + ['', 'index.html', 'du.html', 'one-day.html', 'upsc.html', 'guides.html', 'contact.html']
    .concat(INFO_EXTRA)
    .concat([...pages.keys()].map(f => f === 'index.html' ? 'pyq/index.html' : 'pyq/' + f))
    .map(u => '  <url><loc>' + SITE + '/' + u + '</loc></url>').join('\n')
  + '\n</urlset>\n');

console.log('TOTAL SITEMAP URLs:', 7 + pages.size);
