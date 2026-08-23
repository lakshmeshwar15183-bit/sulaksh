#!/usr/bin/env node
// SEO Generator v3 FINAL — sulaksh.online  (English focus)
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

const res = await fetch(`${API}/api/materials`);
const { materials } = await res.json();

const pages = new Map();
function emit(file, title, desc, h1, badge, introHTML, bodyHTML, related = [], faqs = null) {
  if (!file) return;
  const F = Array.isArray(faqs) && faqs.length ? faqs : [
    ['Is this free?', 'Yes — every document on Sulaksh is completely free to view, no sign-up required.'],
    ['Is this official Delhi University material?', 'Yes — sourced from DU examinations under the UGCF/NEP framework.'],
  ];
  const rel = related && related.length ? `<h2>Related Papers</h2><div class="rel">${related.map(r => `<a href="/pyq/${r.file}">${esc(r.label)}</a>`).join('')}</div>` : '';
  const faqH = F.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('');
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/pyq/${file}">
<link rel="icon" type="image/png" href="/assets/images/favicon.png">
<style>body{font-family:Inter,system-ui,sans-serif;max-width:820px;margin:0 auto;padding:24px;color:#16233a;line-height:1.65}h1{font-size:26px;line-height:1.25}h2{font-size:19px;margin-top:28px}a{color:#1E5FFF;text-decoration:none}.badge{display:inline-block;background:#eef3ff;color:#1E5FFF;font-weight:700;font-size:12px;padding:4px 12px;border-radius:100px;margin-bottom:10px}.plist{list-style:none;padding:0}.plist li{display:flex;gap:10px;align-items:center;justify-content:space-between;border:1px solid #e4e9f1;border-radius:10px;padding:10px 14px;margin:8px 0}.pt{font-weight:600}.ty{font-size:10px;font-weight:800;background:#eef3ff;color:#1E5FFF;border-radius:100px;padding:2px 8px;margin-left:6px}.plist button,.openbtn{background:#0C2340;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer}.rel{display:flex;flex-wrap:wrap;gap:8px}.rel a{border:1px solid #e4e9f1;border-radius:100px;padding:6px 14px;font-size:13px;font-weight:600}.faq{background:#f6f8fc;border-radius:12px;padding:18px 22px;margin-top:26px}footer{margin-top:34px;font-size:13px;color:#5b6b80}footer a{font-weight:700}</style></head><body>
<span class="badge">${esc(badge)} · Delhi University · Free</span>
<h1>${esc(h1)}</h1>
${introHTML}
${bodyHTML}${rel}
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

const listItem = m => {
  const t = typeOf(m).toUpperCase();
  return `<li><span class="pt">${esc(m.title)}</span><span class="ty">${t}</span><button onclick="openMat('${m.id}')">Open</button></li>`;
};

// ===== 1) PER-PAPER PAGES =====
for (const m of materials) {
  const t = typeOf(m);
  const tn = TYPE_LABEL[t] || 'Study Material';
  const semBit = m.semester ? ` Semester ${m.semester}` : '';
  const yr = m.year ? ` (${m.year})` : '';
  const file = `paper/${slug(m.title)}-${m.id.slice(0, 8)}.html`;
  if (pages.has(file)) continue;
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

// ===== 2) CORE: overview + per-sem + per-sem×type =====
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
  const li = listItem;
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
  // per-sem combined
  for (const [semName, arr] of semMap) {
    const semNum = (semName.match(/\d+/) || [''])[0];
    const base = `${slug(subject)}-${slug(track)}-${semNum ? 'sem-' + semNum + '-' : ''}`;
    emit(`${base}pyqs.html`,
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
    // per-sem × type
    const types = new Map();
    for (const m of arr) { const t = typeOf(m); if (!types.has(t)) types.set(t, []); types.get(t).push(m); }
    for (const [t, arr2] of types) {
      const tn2 = TYPE_LABEL[t] || t;
      emit(`${base}${t}.html`,
        `${subject} ${track} ${semName} ${tn2} – DU Free | Sulaksh`,
        `${arr2.length} ${subject} ${track.toLowerCase()} ${semName.toLowerCase()} ${tn2.toLowerCase()} — Delhi University, free.`,
        `${subject} ${track} ${semName} — ${tn2}`,
        'Delhi University · Free',
        `<p>${arr2.length} document(s).</p>`,
        `<ul class="plist">${arr2.map(listItem).join('')}</ul>`);
    }
  }
}

// ===== 3) GE/VAC/AEC/SEC subject × type =====
const cats = [['GE', 'Generic Elective'], ['VAC', 'Value Added Course'], ['AEC', 'Ability Enhancement Course'], ['SEC', 'Skill Enhancement Course']];
for (const [cat, label] of cats) {
  const ms = materials.filter(m => (m.category || '').toUpperCase() === cat && String(m.subject || '').trim() && slug(m.subject));
  const g = new Map();
  for (const m of ms) {
    const k = `${m.subject}||${typeOf(m)}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(m);
  }
  for (const [k, arr] of g) {
    if (!arr.length) continue;
    const [subject, type] = k.split('||');
    const tn = TYPE_LABEL[type] || type;
    const years = [...new Set(arr.map(m => m.year).filter(Boolean))].sort().join(', ');
    emit(`${cat.toLowerCase()}-${slug(subject)}-${type}.html`,
      `${subject} ${tn} – DU ${label}${years ? ' ' + years : ''} | Free | Sulaksh`,
      `${arr.length} ${subject} ${label} ${tn.toLowerCase()} — Delhi University NEP/UGCF, free instant view.`,
      `${subject} — ${tn} (${label})`,
      label, `<p><strong>${arr.length}</strong> document(s).</p>`,
      `<ul class="plist">${arr.map(listItem).join('')}</ul>`);
  }
}

// ===== hub =====
const hubItems = [...pages.entries()]
  .filter(([f]) => f !== 'index.html')
  .slice(-350)
  .map(([f, t]) => `<li><span class="pt"><a href="/pyq/${f}">${esc(t.replace(' | Sulaksh', ''))}</a></span></li>`).join('');
emit('index.html',
  'All DU Previous Year Question Papers, Syllabus & Notes – Free | Sulaksh',
  'Complete DU PYQs, syllabus & study material — BA/BSc/BCom majors, minors, honours, GE, VAC, AEC, SEC. Free.',
  'Delhi University PYQs & Study Material — Complete Index',
  'Master Index',
  '<p>Browse every Delhi University previous year question paper, syllabus and study material on Sulaksh. All free.</p>',
  `<ul class="plist">${hubItems}</ul>`);

// ===== sitemap =====
const urls = ['', 'index.html', 'du.html', 'one-day.html', 'upsc.html', 'guides.html', 'contact.html'];
const seenU = new Set(urls);
for (const f of pages.keys()) {
  const u = f === 'index.html' ? 'pyq/index.html' : 'pyq/' + f;
  if (!seenU.has(u)) { urls.push(u); seenU.add(u); }
}
fs.writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${SITE}/${u}</loc></url>`).join('\n')}
</urlset>\n`);

console.log(`✅ TOTAL SITEMAP URLs: ${urls.length}`);
