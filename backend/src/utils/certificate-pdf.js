// Certificate / LOR PDF generator — Sulaksh branded, pdf-lib only.
// Internship & Participation -> formal landscape certificate with gold/navy
// ornamentation. LOR -> formal portrait letter with letterhead + signature.
// QR encodes ONLY the verification URL (no personal data inside).
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, degrees, rgb } = require('pdf-lib');
const QRCode = require('qrcode');

const NAVY = rgb(12 / 255, 35 / 255, 64 / 255);
const BLUE = rgb(30 / 255, 95 / 255, 255 / 255);
const GOLD = rgb(176 / 255, 134 / 255, 30 / 255);
const GOLD_LIGHT = rgb(201 / 255, 178 / 255, 90 / 255);
const MUTED = rgb(100 / 255, 112 / 255, 130 / 255);
const DARK = rgb(26 / 255, 36 / 255, 51 / 255);

const TITLES = {
  internship: 'Certificate of Internship',
  participation: 'Certificate of Participation',
  lor: 'Letter of Recommendation',
  joining: 'Internship Offer Letter',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// In-memory cache for private signature art: fetched from Backblaze once per
// process, then reused. Restarts re-fetch (picks up replacements).
const sigCache = new Map();

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${m[3]} ${MONTHS[parseInt(m[2], 10) - 1] || ''} ${m[1]}`;
}

// "3 months (01 September 2026 to 30 November 2026)" — never promises more.
function durationText(startIso, endIso) {
  const range = `${fmtDate(startIso)} to ${fmtDate(endIso)}`;
  const a = new Date(String(startIso) + 'T00:00:00Z');
  const b = new Date(String(endIso) + 'T00:00:00Z');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return range;
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  if (months >= 1) return `${months} month${months === 1 ? '' : 's'} (${range})`;
  const weeks = Math.max(1, Math.round((b - a) / (7 * 86400000)));
  return `${weeks} week${weeks === 1 ? '' : 's'} (${range})`;
}

// Letterspaced small-caps labels: C E R T I F I C A T E
function spaced(s) {
  return String(s || '').split('').join(' ');
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const trial = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      line = trial;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function loadLogo(pdf) {
  try {
    const logoPath = path.join(__dirname, '..', '..', 'assets', 'sulaksh-emblem.png');
    if (fs.existsSync(logoPath)) return await pdf.embedPng(fs.readFileSync(logoPath));
  } catch (e) { /* decorative only */ }
  return null;
}

// Authority signature art: white/transparent-background PNGs in private
// Backblaze storage (never served over any public URL). Each issuer's full
// block (signature + name + designation + seal if any) prints at the sign
// spot, Aryan-style. Anything else (or a missing file) falls back to the
// plain signature line. Black-background images are NOT accepted here.
function signatureFileFor(issuedByName) {
  const n = String(issuedByName || '').toLowerCase();
  if (n.includes('aryan')) return { sig: 'sign-aryan.png', stamp: null };
  if (n.includes('lakshmeshwar') || n.includes('pandey')) return { sig: 'sign-founder-full.png', stamp: null };
  return null;
}

async function loadArt(pdf, file) {
  if (!file) return null;
  if (sigCache.has(file)) {
    const hit = sigCache.get(file);
    const img = await pdf.embedPng(hit);
    return { img, w: img.width, h: img.height };
  }
  // Private Backblaze copy first (never served over any public URL) …
  try {
    const { downloadObject } = require('../r2');
    const buf = await downloadObject('private/signatures/' + file);
    sigCache.set(file, buf);
    const img = await pdf.embedPng(buf);
    return { img, w: img.width, h: img.height };
  } catch (e) { /* fall through to local file (dev machines) */ }
  // … then a local backend/assets/ copy (dev only — never committed).
  try {
    const p = path.join(__dirname, '..', '..', 'assets', file);
    if (fs.existsSync(p)) {
      const img = await pdf.embedPng(fs.readFileSync(p));
      return { img, w: img.width, h: img.height };
    }
  } catch (e) { /* fall back to plain line */ }
  return null;
}

async function loadSignature(pdf, issuedByName) {
  try {
    const spec = signatureFileFor(issuedByName);
    if (!spec) return null;
    // Signature art and seal load independently: a missing signature still
    // leaves the plain line + printed name, and a missing seal just skips it.
    const sig = await loadArt(pdf, spec.sig);
    const stamp = await loadArt(pdf, spec.stamp);
    if (!sig && !stamp) return null;
    return { img: sig ? sig.img : null, w: sig ? sig.w : 0, h: sig ? sig.h : 0, stamp };
  } catch (e) { /* fall back to plain line */ }
  return null;
}

// Fit a signature block into (maxW x maxH) without upscaling.
function fitSig(sig, maxW, maxH) {
  if (!sig || !sig.w || !sig.h) return null;
  const s = Math.min(maxW / sig.w, maxH / sig.h, 1);
  return { img: sig.img, w: sig.w * s, h: sig.h * s };
}

// Round authority seal in a ~64px box (founder only). Placed where the old
// drawn muhar sat; everyone else gets nothing here.
function drawStamp(page, sig, cx, cy) {
  if (!sig || !sig.stamp || !sig.stamp.img) return;
  const st = sig.stamp;
  const s = Math.min(64 / st.w, 64 / st.h, 1);
  const w = st.w * s, h = st.h * s;
  page.drawImage(st.img, { x: cx - w / 2, y: cy - h / 2, width: w, height: h });
}

async function makeQr(pdf, url) {
  const buf = await QRCode.toBuffer(String(url), { type: 'png', width: 260, margin: 1 });
  return pdf.embedPng(buf);
}

function diamond(page, x, y, s, color) {
  page.drawRectangle({ x: x - s / 2, y: y - s / 2, width: s, height: s, rotate: degrees(45), color });
}

function goldRule(page, x1, x2, y) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 1.2, color: GOLD });
  diamond(page, (x1 + x2) / 2, y, 9, GOLD);
}

// ---------------- Formal landscape certificate ----------------
async function certificatePage(pdf, record, verifyUrl, fonts, logo, qr, sig) {
  const { helv, helvBold, helvOblique } = fonts;
  const page = pdf.addPage([841.89, 595.28]); // A4 landscape
  const W = page.getWidth();
  const H = page.getHeight();
  const center = (text, font, size) => W / 2 - font.widthOfTextAtSize(text, size) / 2;

  // Double border: navy outer, gold inner, diamond corners
  page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: NAVY, borderWidth: 3.5 });
  page.drawRectangle({ x: 28, y: 28, width: W - 56, height: H - 56, borderColor: GOLD, borderWidth: 1 });
  diamond(page, 28, 28, 10, NAVY);
  diamond(page, W - 28, 28, 10, NAVY);
  diamond(page, 28, H - 28, 10, NAVY);
  diamond(page, W - 28, H - 28, 10, NAVY);

  let y = H - 46;

  if (logo) {
    const lw = 58;
    const lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: W / 2 - lw / 2, y: y - lh, width: lw, height: lh });
    y -= lh + 10;
  }

  const brand = spaced('SULAKSH');
  page.drawText(brand, { x: center(brand, helvBold, 15), y: y - 15, size: 15, font: helvBold, color: NAVY });
  y -= 22;
  const tag = 'Learn  .  Prepare  .  Achieve';
  page.drawText(tag, { x: center(tag, helvOblique, 9.5), y: y - 10, size: 9.5, font: helvOblique, color: MUTED });
  y -= 26;

  goldRule(page, W / 2 - 170, W / 2 + 170, y);
  y -= 34;

  const title = TITLES[record.certificate_type] || 'Certificate';
  page.drawText(title, { x: center(title, helvBold, 30), y: y - 30, size: 30, font: helvBold, color: NAVY });
  y -= 52;

  const pre = 'This certificate is proudly presented to';
  page.drawText(pre, { x: center(pre, helvOblique, 12), y: y - 12, size: 12, font: helvOblique, color: MUTED });
  y -= 36;

  const name = record.recipient_name || '';
  const nameSize = name.length > 22 ? 26 : 32;
  page.drawText(name, { x: center(name, helvBold, nameSize), y: y - nameSize, size: nameSize, font: helvBold, color: DARK });
  y -= nameSize + 16;

  goldRule(page, W / 2 - 150, W / 2 + 150, y);
  y -= 28;

  const roleLine = `${record.role || ''}`;
  page.drawText(roleLine, { x: center(roleLine, helvBold, 13), y: y - 13, size: 13, font: helvBold, color: DARK });
  y -= 26;

  if (record.description) {
    for (const ln of wrapText(record.description, helvOblique, 11, W - 320).slice(0, 3)) {
      page.drawText(ln, { x: center(ln, helvOblique, 11), y: y - 11, size: 11, font: helvOblique, color: DARK });
      y -= 16;
    }
    y -= 8;
  }

  const meta = [];
  if (record.start_date || record.end_date) {
    meta.push(`Duration :  ${fmtDate(record.start_date) || '—'}   to   ${fmtDate(record.end_date) || '—'}`);
  }
  meta.push(`Issued on :  ${fmtDate(record.issue_date)}`);
  for (const mline of meta) {
    page.drawText(mline, { x: center(mline, helv, 10.5), y: y - 11, size: 10.5, font: helv, color: MUTED });
    y -= 18;
  }
  const ref = spaced(`Ref : ${record.certificate_number || ''}`);
  page.drawText(ref, { x: center(ref, helvBold, 10), y: y - 10, size: 10, font: helvBold, color: NAVY });
  y -= 10;

  // Footer: signature (left) + QR (right). Printed name sits well below its
  // line, leaving real space for a wet signature. When the issuer has a
  // signature-block image, it is drawn above the line and replaces the
  // printed name/title (the block already contains them).
  const fx = 80;
  const fy = 78;
  // Adaptive cap: the footer is fixed, but content length varies — size the
  // signature art to whatever room the content leaves above the footer.
  const sigFit = fitSig(sig, 230, Math.max(48, Math.min(130, y - 144)));
  page.drawLine({ start: { x: fx, y: fy + 34 }, end: { x: fx + 170, y: fy + 34 }, thickness: 1, color: MUTED });
  if (sigFit) {
    page.drawImage(sigFit.img, { x: fx, y: fy + 50, width: sigFit.w, height: sigFit.h });
  } else {
    const byName = record.issued_by_name || '';
    page.drawText(byName, { x: fx, y: fy + 14, size: 12, font: helvBold, color: DARK });
    const byTitle = record.issued_by_title || '';
    if (byTitle) page.drawText(byTitle, { x: fx, y: fy + 0, size: 9.5, font: helv, color: MUTED });
  }
  const sigLabel = spaced('Authorised Signatory');
  page.drawText(sigLabel, { x: fx, y: fy - 12, size: 7.5, font: helv, color: MUTED });

  const qs = 92;
  page.drawImage(qr, { x: W - fx - qs, y: fy - 26, width: qs, height: qs });
  const scan = 'Scan to verify';
  page.drawText(scan, { x: W - fx - qs, y: fy - 38, size: 8, font: helvBold, color: NAVY });
  const vu = String(verifyUrl);
  const short = vu.length > 44 ? vu.slice(0, 44) + '...' : vu;
  page.drawText(short, { x: W - fx - qs, y: fy - 49, size: 7, font: helv, color: MUTED });

  const foot = 'sulaksh.online  |  This is a system-generated verifiable certificate';
  page.drawText(foot, { x: center(foot, helv, 7.5), y: 40, size: 7.5, font: helv, color: MUTED });
}

// ---------------- Formal LOR letter (portrait) ----------------
async function lorPages(pdf, record, verifyUrl, fonts, logo, qr, sig) {
  const { helv, helvBold, helvOblique } = fonts;
  const PW = 595.28;
  const PH = 841.89;
  const ML = 72; // margins
  const maxW = PW - ML * 2;

  let page = pdf.addPage([PW, PH]);
  const pages = [page];
  let y = PH - 60;

  const newPage = () => {
    page = pdf.addPage([PW, PH]);
    pages.push(page);
    return PH - 70;
  };

  // Letterhead
  if (logo) {
    const lw = 52;
    const lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: ML, y: y - lh, width: lw, height: lh });
  }
  page.drawText('SULAKSH', { x: ML + 64, y: y - 24, size: 22, font: helvBold, color: NAVY });
  page.drawText('Learn. Prepare. Achieve.  |  sulaksh.online', { x: ML + 64, y: y - 40, size: 9.5, font: helv, color: MUTED });
  y -= 62;
  page.drawLine({ start: { x: ML, y }, end: { x: PW - ML, y }, thickness: 1.2, color: GOLD });
  page.drawLine({ start: { x: ML, y: y - 3 }, end: { x: PW - ML, y: y - 3 }, thickness: 0.6, color: GOLD_LIGHT });
  y -= 30;

  const dateLine = `Date : ${fmtDate(record.issue_date)}`;
  page.drawText(dateLine, { x: PW - ML - helv.widthOfTextAtSize(dateLine, 10.5), y: y - 11, size: 10.5, font: helv, color: DARK });
  const refLine = `Ref : ${record.certificate_number || ''}`;
  page.drawText(refLine, { x: ML, y: y - 11, size: 10.5, font: helvBold, color: NAVY });
  y -= 34;

  const subj = `Subject : Letter of Recommendation for ${record.recipient_name || ''}`;
  for (const ln of wrapText(subj, helvBold, 12, maxW)) {
    page.drawText(ln, { x: ML, y: y - 12, size: 12, font: helvBold, color: DARK });
    y -= 17;
  }
  y -= 8;

  page.drawText('Dear Sir / Madam,', { x: ML, y: y - 12, size: 11.5, font: helv, color: DARK });
  y -= 30;

  let paras = String(record.description || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (!paras.length) {
    const dur = record.start_date || record.end_date
      ? ` during ${fmtDate(record.start_date) || ''}${record.end_date ? ' to ' + fmtDate(record.end_date) : ''}` : '';
    paras = [
      `This is to certify that ${record.recipient_name || ''} served as ${record.role || ''} at Sulaksh${dur}. During this period, we found them sincere, hardworking and consistent in meeting the responsibilities entrusted to them.`,
      `Based on their performance and conduct, we are pleased to recommend ${record.recipient_name || 'them'} for future academic and professional pursuits. We wish them success in all forthcoming endeavours.`,
    ];
  }

  const body = (ln, font, size) => {
    if (y < 190) y = newPage();
    page.drawText(ln, { x: ML, y: y - size, size, font, color: DARK });
    y -= size + 7;
  };
  for (const p of paras) {
    for (const ln of wrapText(p, helv, 11.5, maxW)) body(ln, helv, 11.5);
    y -= 6;
  }

  if (y < 280) y = newPage();
  y -= 6;
  page.drawText('With regards,', { x: ML, y: y - 12, size: 11.5, font: helv, color: DARK });
  // Reserve the signing gap first so a signature image can never touch body text.
  const sigFit = fitSig(sig, 160, 95);
  const gapAbove = sigFit ? sigFit.h + 60 : 56;
  // Labels bottom out at y_final-49; the gap math already guarantees the image
  // clears the paragraph above, so 205 is sufficient with or without an image.
  if (y - gapAbove < 205) y = newPage();
  y -= gapAbove;
  page.drawLine({ start: { x: ML, y }, end: { x: ML + 190, y }, thickness: 1, color: MUTED });
  if (sigFit) {
    page.drawImage(sigFit.img, { x: ML, y: y + 16, width: sigFit.w, height: sigFit.h });
  } else {
    const byName = record.issued_by_name || '';
    page.drawText(byName, { x: ML, y: y - 18, size: 13, font: helvBold, color: DARK });
    const byTitle = record.issued_by_title ? `${record.issued_by_title}, Sulaksh` : 'Sulaksh';
    page.drawText(byTitle, { x: ML, y: y - 33, size: 10.5, font: helv, color: MUTED });
  }
  page.drawText('Authorised Signatory', { x: ML, y: y - 46, size: 8, font: helv, color: MUTED });

  // Verification footer on the last page
  const last = pages[pages.length - 1];
  last.drawLine({ start: { x: ML, y: 96 }, end: { x: PW - ML, y: 96 }, thickness: 0.6, color: GOLD_LIGHT });
  const qs = 62;
  last.drawImage(qr, { x: ML, y: 24, width: qs, height: qs });
  const vt = 'Verify this letter :';
  last.drawText(vt, { x: ML + qs + 12, y: 66, size: 9, font: helvBold, color: NAVY });
  const vu = String(verifyUrl);
  last.drawText(vu.length > 56 ? vu.slice(0, 56) + '...' : vu, { x: ML + qs + 12, y: 52, size: 8, font: helv, color: MUTED });
  last.drawText(`Ref : ${record.certificate_number || ''}   |   sulaksh.online`, { x: ML + qs + 12, y: 38, size: 8, font: helv, color: MUTED });
}

// ---------------- Internship Offer Letter (portrait, minimum 2 pages) ----------------
// Deliberately an offer/engagement letter, never an employment appointment.
// Terms page always starts on a fresh page, so the document is >= 2 pages.
async function joiningPages(pdf, record, verifyUrl, fonts, logo, qr, sig) {
  const { helv, helvBold } = fonts;
  const PW = 595.28;
  const PH = 841.89;
  const ML = 72;
  const maxW = PW - ML * 2;

  let page = pdf.addPage([PW, PH]);
  let y = PH - 60;
  const startPages = pdf.getPageCount();
  const freshPage = () => {
    page = pdf.addPage([PW, PH]);
    return PH - 70;
  };

  // Letterhead (same family as the LOR)
  if (logo) {
    const lw = 52;
    const lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: ML, y: y - lh, width: lw, height: lh });
  }
  page.drawText('SULAKSH', { x: ML + 64, y: y - 24, size: 22, font: helvBold, color: NAVY });
  page.drawText('Learn. Prepare. Achieve.  |  sulaksh.online', { x: ML + 64, y: y - 40, size: 9.5, font: helv, color: MUTED });
  y -= 62;
  page.drawLine({ start: { x: ML, y }, end: { x: PW - ML, y }, thickness: 1.2, color: GOLD });
  page.drawLine({ start: { x: ML, y: y - 3 }, end: { x: PW - ML, y: y - 3 }, thickness: 0.6, color: GOLD_LIGHT });
  y -= 32;

  const dateLine = `Date : ${fmtDate(record.issue_date)}`;
  page.drawText(dateLine, { x: PW - ML - helv.widthOfTextAtSize(dateLine, 10.5), y: y - 11, size: 10.5, font: helv, color: DARK });
  const refLine = `Ref : ${record.certificate_number || ''}`;
  page.drawText(refLine, { x: ML, y: y - 11, size: 10.5, font: helvBold, color: NAVY });
  y -= 36;

  const docTitle = spaced('INTERNSHIP OFFER LETTER');
  page.drawText(docTitle, { x: PW / 2 - helvBold.widthOfTextAtSize(docTitle, 15) / 2, y: y - 15, size: 15, font: helvBold, color: NAVY });
  y -= 26;
  goldRule(page, PW / 2 - 120, PW / 2 + 120, y);
  y -= 30;

  const para = (text, size, font, gap) => {
    for (const ln of wrapText(text, font, size, maxW)) {
      if (y < 90) y = freshPage();
      page.drawText(ln, { x: ML, y: y - size, size, font, color: DARK });
      y -= size + 7;
    }
    y -= (gap == null ? 6 : gap);
  };
  const head = (text) => {
    if (y < 120) y = freshPage();
    page.drawText(text, { x: ML, y: y - 12, size: 12, font: helvBold, color: NAVY });
    y -= 24;
  };

  para(`Dear ${record.recipient_name || ''},`, 11.5, helv, 4);
  para(`We are pleased to offer you the position of ${record.role || ''} in the ${record.department || ''} team at Sulaksh, commencing on ${fmtDate(record.start_date)}. This letter sets out the terms of this internship opportunity.`, 11.5, helv, 6);

  head('Role Details');
  const details = [
    ['Internship Title', record.role || ''],
    ['Department / Team', record.department || ''],
    ['Start Date', fmtDate(record.start_date)],
    ['Expected Duration', durationText(record.start_date, record.end_date)],
    ['Reporting To', record.supervisor || ''],
  ];
  for (const [k, v] of details) {
    if (y < 90) y = freshPage();
    page.drawText(k + ' :', { x: ML, y: y - 11, size: 11, font: helvBold, color: DARK });
    for (const ln of wrapText(v, helv, 11, maxW - 170)) {
      page.drawText(ln, { x: ML + 165, y: y - 11, size: 11, font: helv, color: DARK });
      y -= 18;
    }
    y -= 2;
  }
  y -= 6;

  head('Key Responsibilities');
  const duties = String(record.responsibilities || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  for (const d of duties) {
    for (const ln of wrapText('\u2022  ' + d, helv, 11, maxW - 20)) {
      if (y < 90) y = freshPage();
      page.drawText(ln, { x: ML + 14, y: y - 11, size: 11, font: helv, color: DARK });
      y -= 18;
    }
    y -= 2;
  }
  y -= 4;

  head('Compensation');
  para('Compensation: This is an unpaid internship opportunity. No stipend or monetary compensation will be provided during the internship period.', 11.5, helv, 6);

  head('About the Organisation');
  para('Sulaksh is an independent, student-led learning platform working to make quality education material freely accessible to every aspirant. Its open library of previous year question papers, syllabi, notes and exam guidance supports thousands of Delhi University students each year in preparing with structure and confidence.', 11.5, helv, 4);
  para('Through its internship program, Sulaksh mentors students in real-world skills across content research, digital marketing, media and community engagement. Interns work directly with the core team on live projects and are evaluated on sincerity, consistency and the quality of their contribution.', 11.5, helv, 0);

  // ---- Terms page: starts fresh only if page 1 held everything, so the
  // document is always >= 2 pages but never wastes a near-empty middle page.
  if (pdf.getPageCount() === startPages) y = freshPage();
  const cont = `(Ref : ${record.certificate_number || ''} - continued)`;
  page.drawText(cont, { x: PW - ML - helv.widthOfTextAtSize(cont, 8.5), y: y - 9, size: 8.5, font: helv, color: MUTED });
  y -= 28;

  head('Performance and Conduct');
  const terms = [
    'Maintain professional conduct and sincerity towards all assigned work throughout the internship period.',
    'Follow the guidance of the reporting supervisor and meet the timelines communicated for each task.',
    'Maintain confidentiality of Sulaksh internal material, data and processes during and after the internship.',
    'Sulaksh reserves the right to conclude the internship early in case of unsatisfactory performance or misconduct.',
  ];
  for (const t of terms) {
    for (const ln of wrapText('\u2022  ' + t, helv, 11, maxW - 20)) {
      if (y < 200) y = freshPage();
      page.drawText(ln, { x: ML + 14, y: y - 11, size: 11, font: helv, color: DARK });
      y -= 18;
    }
    y -= 2;
  }
  y -= 6;

  head('Certification');
  para("Upon successful completion of the internship, an Internship Certificate may be issued based on the intern's performance, conduct, and contribution. A Letter of Recommendation may be issued separately at the discretion of Sulaksh based on demonstrated performance and contribution.", 11.5, helv, 6);

  head('Acceptance');
  para(`I, ${record.recipient_name || ''}, hereby accept the terms of this internship offer as set out above.`, 11.5, helv, 10);
  // Generous signing space, reserved BEFORE the lines: a signature image can
  // never touch body text, and printed names go below the lines, never on them.
  const sigFitJ = fitSig(sig, 170, 95);
  const gapAboveJ = sigFitJ ? sigFitJ.h + 60 : 34;
  // Labels bottom out at y_final-39 with the footer rule at 96, so 150 keeps
  // ~16pt clearance while letting signatures stay on page 2 whenever they fit.
  if (y - gapAboveJ < 150) y = freshPage();
  y -= gapAboveJ;
  page.drawLine({ start: { x: ML, y }, end: { x: ML + 200, y }, thickness: 1, color: MUTED });
  page.drawLine({ start: { x: PW - ML - 200, y }, end: { x: PW - ML, y }, thickness: 1, color: MUTED });
  y -= 18;
  page.drawText("Intern's Signature & Date", { x: ML, y: y - 10, size: 9.5, font: helv, color: MUTED });
  if (sigFitJ) {
    page.drawImage(sigFitJ.img, { x: PW - ML - 200, y: y + 16, width: sigFitJ.w, height: sigFitJ.h });
  } else {
    const byName = record.issued_by_name || '';
    page.drawText(byName, { x: PW - ML - 200, y: y - 10, size: 12, font: helvBold, color: DARK });
    const byTitle = record.issued_by_title ? `${record.issued_by_title}, Sulaksh` : 'Sulaksh';
    page.drawText(byTitle, { x: PW - ML - 200, y: y - 24, size: 9.5, font: helv, color: MUTED });
  }
  page.drawText('Authorised Signatory', { x: PW - ML - 200, y: y - 36, size: 8, font: helv, color: MUTED });

  // Verification footer on the final page
  page.drawLine({ start: { x: ML, y: 96 }, end: { x: PW - ML, y: 96 }, thickness: 0.6, color: GOLD_LIGHT });
  const qs = 62;
  page.drawImage(qr, { x: ML, y: 24, width: qs, height: qs });
  const vt = 'Verify this letter :';
  page.drawText(vt, { x: ML + qs + 12, y: 66, size: 9, font: helvBold, color: NAVY });
  const vu = String(verifyUrl);
  page.drawText(vu.length > 56 ? vu.slice(0, 56) + '...' : vu, { x: ML + qs + 12, y: 52, size: 8, font: helv, color: MUTED });
  page.drawText(`Ref : ${record.certificate_number || ''}   |   sulaksh.online`, { x: ML + qs + 12, y: 38, size: 8, font: helv, color: MUTED });
}

async function generateCertificatePdf(record, verifyUrl) {
  const pdf = await PDFDocument.create();
  const fonts = {
    helv: await pdf.embedFont(StandardFonts.Helvetica),
    helvBold: await pdf.embedFont(StandardFonts.HelveticaBold),
    helvOblique: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const logo = await loadLogo(pdf);
  const qr = await makeQr(pdf, verifyUrl);
  const sig = await loadSignature(pdf, record.issued_by_name);
  const t = record.certificate_type || '';
  if (t === 'lor') {
    await lorPages(pdf, record, verifyUrl, fonts, logo, qr, sig);
  } else if (t === 'joining') {
    await joiningPages(pdf, record, verifyUrl, fonts, logo, qr, sig);
  } else {
    await certificatePage(pdf, record, verifyUrl, fonts, logo, qr, sig);
  }
  return Buffer.from(await pdf.save());
}

module.exports = { generateCertificatePdf, TITLES };
