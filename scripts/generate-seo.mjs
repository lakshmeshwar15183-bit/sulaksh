#!/usr/bin/env node
// SEO Landing Page Generator — sulaksh.online
// Reads live catalog → generates keyword-rich static pages per
// Subject × Track × Semester (CORE) and per Subject (GE/VAC/AEC/SEC).
// Re-run anytime after new uploads: node scripts/generate-seo.mjs

import fs from 'node:fs';
import path from 'node:path';

const API = process.env.SULAKSH_API || 'https://sulaksh-backend-production.up.railway.app';
const OUT = path.resolve(process.cwd(), 'pyq');
const SITE = 'https://sulaksh.online';

const slug = (s) => String(s || '').toLowerCase()
  .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const tc = (s) => s.split('-').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TRACK = { 'Honours': 'Honours', 'As Major': 'Major', 'As Minor': 'Minor', '': 'General' };
const CAT_LABEL = { GE: 'Generic Elective (GE)', VAC: 'Value Added Course (VAC)', AEC: 'Ability Enhancement Course (AEC)', SEC: 'Skill Enhancement Course (SEC)' };

const res = await fetch(`${API}/api/materials`);
const { materials } = await res.json();
fs.mkdirSync(OUT, { recursive: true });

const pages = []; // {file,title,desc,h1,body}

function page(file, title, desc, h1, introHTML, groups, related, faqs, catLabel) {
  const list = [...groups.entries()].map(([year, arr]) => `
    <h2>${year} Question Papers</h2>
    <ul class="plist">${arr.map(m => { const t=(m.material_category||(m.is_syllabus?'syllabus':m.is_pyq?'pyqs':'notes')||'').toUpperCase(); return `
      <li><span class="pt">${esc(m.title)}</span><span class="ty">${t}</span>
        <button onclick="openMat('${m.id}')">Open</button></li>`}).join('')}
    </ul>`).join('');
  const rel = related.length ? `
    <h2>Related Papers</h2>
    <div class="rel">${related.map(r => `<a href="/pyq/${r.file}">${esc(r.label)}</a>`).join('')}</div>` : '';
  const faqH = faqs.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('');
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  });
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/pyq/${file}">
<link rel="icon" type="image/png" href="/assets/images/favicon.png">
<script type="application/ld+json">${jsonld}</script>
<style>
body{font-family:Inter,system-ui,sans-serif;max-width:820px;margin:0 auto;padding:24px;color:#16233a;line-height:1.65}
h1{font-size:26px;line-height:1.25} h2{font-size:19px;margin-top:28px} a{color:#1E5FFF;text-decoration:none}
.badge{display:inline-block;background:#eef3ff;color:#1E5FFF;font-weight:700;font-size:12px;padding:4px 12px;border-radius:100px;margin-bottom:10px}
.plist{list-style:none;padding:0}.plist li{display:flex;gap:10px;align-items:center;justify-content:space-between;border:1px solid #e4e9f1;border-radius:10px;padding:10px 14px;margin:8px 0}
.pt{font-weight:600}.ty{font-size:10px;font-weight:800;background:#eef3ff;color:#1E5FFF;border-radius:100px;padding:2px 8px;margin-left:6px}.plist button{background:#0C2340;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer}
.rel{display:flex;flex-wrap:wrap;gap:8px}.rel a{border:1px solid #e4e9f1;border-radius:100px;padding:6px 14px;font-size:13px;font-weight:600}
.faq{background:#f6f8fc;border-radius:12px;padding:18px 22px;margin-top:26px}
footer{margin-top:34px;font-size:13px;color:#5b6b80}footer a{font-weight:700}
</style></head><body>
<span class="badge">${esc(catLabel)} · Delhi University · Free</span>
<h1>${esc(h1)}</h1>
${introHTML}
${list}${rel}
<div class="faq"><h2>FAQs</h2>${faqH}</div>
<footer>Part of <a href="/">Sulaksh</a> — free study material for every aspirant. Browse <a href="/du.html">DU &amp; College resources</a>.</footer>
<script>
const API='${API}';
async function openMat(id){try{const r=await fetch(API+'/api/materials/'+id+'/download?disposition=inline');const d=await r.json();if(d.url)window.open(d.url,'_blank');else alert(d.error||'Currently unavailable')}catch(e){alert('Please try again later')}}
</script>
</body></html>`;
  fs.writeFileSync(path.join(OUT, file), html);
  pages.push({ file, title, desc });
}

// ---------- CORE: subject × track × semester ----------
const core = materials.filter(m => m.category === 'CORE' && String(m.subject||'').trim() && slug(m.subject));
const bySubjTrack = new Map();
for (const m of core) {
  const track = TRACK[m.track] || 'General';
  const key = `${m.subject}||${track}`;
  if (!bySubjTrack.has(key)) bySubjTrack.set(key, new Map());
  const semMap = bySubjTrack.get(key);
  const sem = m.semester ? `Semester ${m.semester}` : 'Papers';
  if (!semMap.has(sem)) semMap.set(sem, []);
  semMap.get(sem).push(m);
}
for (const [key, semMap] of bySubjTrack) {
  const [subject, track] = key.split('||');
  const tSlug = slug(track), sSlug = slug(subject);
  const total = [...semMap.values()].reduce((a, v) => a + v.length, 0);
  const years = [...new Set([...semMap.values()].flat().map(m => m.year).filter(Boolean))].sort().join(', ');
  const file = `${sSlug}-${tSlug}-pyqs.html`;
  const title = `${subject} ${track} Previous Year Papers, Syllabus & Notes – BA Programme DU${years ? ' ' + years : ''} | Sulaksh`;
  const desc = `Download/view ${subject} ${track.toLowerCase()} semester-wise previous year question papers of Delhi University (UGCF/NEP) — free PDFs, all semesters, solved by toppers' approach.`;
  const h1 = `${subject} ${track} PYQs — Delhi University (Semester-wise)`;
  const intro = `<p>Every <strong>${subject} ${track.toLowerCase()}</strong> previous year question paper of Delhi University (UGCF/NEP-2022 scheme) — organised semester-wise and free to view. Click any paper to open it instantly.</p>`;
  // related: other tracks of same subject + other sems hub
  const related = [];
  for (const [k2, m2] of bySubjTrack) {
    if (k2 === key) continue;
    const [s2, t2] = k2.split('||');
    if (s2 === subject) related.push({ file: `${sSlug}-${slug(t2)}-pyqs.html`, label: `${subject} ${TRACK[t2] ?? t2}` });
  }
  const faqs = [
    [`Where can I download ${subject} ${track.toLowerCase()} PYQs for DU?`, `Right here — Sulaksh provides semester-wise previous year question papers of ${subject} (${track}) under Delhi University's UGCF/NEP framework, free for every aspirant.`],
    [`Are these official DU question papers?`, `Yes. These are the same papers issued in university examinations for ${subject} ${track.toLowerCase()} students, collected from official college sources.`],
    [`Is any payment required?`, `No. Every paper on Sulaksh is completely free to view.`],
  ];
  page(file, title, desc, h1, intro, semMap, related, faqs, 'Delhi University · Core Paper');
}

// ---------- GE / VAC / AEC / SEC: subject pages ----------
const cats = [['GE', 'Generic Elective'], ['VAC', 'Value Added Course'], ['AEC', 'Ability Enhancement Course'], ['SEC', 'Skill Enhancement Course']];
for (const [cat, label] of cats) {
  const ms = materials.filter(m => (m.category || '').toUpperCase() === cat && String(m.subject||'').trim() && slug(m.subject));
  const bySubj = new Map();
  for (const m of ms) {
    if (!bySubj.has(m.subject)) bySubj.set(m.subject, []);
    bySubj.get(m.subject).push(m);
  }
  for (const [subject, arr] of bySubj) {
    if (!arr.length) continue;
    const sSlug = slug(subject);
    const years = [...new Set(arr.map(m => m.year).filter(Boolean))].sort().join(', ');
    const file = `${cat.toLowerCase()}-${sSlug}-pyqs.html`;
    const title = `${subject} ${label} PYQs – Delhi University${years ? ' ' + years : ''} | Free Question Papers | Sulaksh`;
    const desc = `Previous year question papers of ${subject} (${label}) offered across DU programmes — free to view, semester-wise, based on NEP/UGCF syllabus.`;
    const h1 = `${subject} — ${label} PYQs (Delhi University)`;
    const intro = `<p>All available <strong>${subject}</strong> ${label.toLowerCase()} question papers taught across Delhi University programmes — free to view, no sign-up.</p>`;
    const groups = new Map([[years || 'Papers', arr]]);
    const related = [];
    const faqs = [
      [`Is ${subject} PYQ available for free?`, `Yes — every ${subject} question paper on Sulaksh is free to view, sourced from official DU examinations.`],
      [`Which syllabus does this cover?`, `These follow the current NEP/UGCF ${label} syllabus prescribed by the University of Delhi.`],
    ];
    page(file, title, desc, h1, intro, groups, related, faqs, label);
  }
}

// ---------- Hub page ----------
const hubGroups = new Map();
pages.sort((a, b) => a.title.localeCompare(b.title));
const __seen=new Set();
for(let i=pages.length-1;i>=0;i--){if(__seen.has(pages[i].file))pages.splice(i,1);else __seen.add(pages[i].file);}
hubGroups.set('All Pages', pages.map(p => ({ id: null, title: p.title.replace(' | Sulaksh', ''), file: p.file })));
const hubIntro = `<p>Browse every Delhi University previous year question paper available on Sulaksh — BA Programme majors, minors, honours, GE, VAC, AEC and SEC courses. All free, always.</p>`;
page('index.html', 'All DU Previous Year Question Papers (PYQs) – Free | Sulaksh',
  'Complete collection of Delhi University previous year question papers — BA/BSc/BCom majors, minors, honours, GE, VAC, AEC & SEC. Free for every aspirant.',
  'Delhi University PYQs — Complete Collection', hubIntro, hubGroups, [],
  [['How many PYQs does Sulaksh have?', 'Hundreds of official DU question papers across dozens of subjects and semesters, growing every week.']], 'Master Index');

// ---------- sitemap ----------
const seen=new Set();
const uniq=pages.filter(p=>!seen.has(p.file)&&seen.add(p.file));
const urls = ['', 'index.html', 'du.html', 'one-day.html', 'upsc.html', 'guides.html', 'contact.html',
  ...uniq.filter(p => p.file !== 'index.html').map(p => 'pyq/' + p.file)];
const sm = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${SITE}/${u}</loc></url>`).join('\n')}
</urlset>\n`;
fs.writeFileSync('sitemap.xml', sm);

console.log(`✅ Generated ${pages.length - 1} SEO pages + hub + sitemap (${urls.length} URLs total)`);
