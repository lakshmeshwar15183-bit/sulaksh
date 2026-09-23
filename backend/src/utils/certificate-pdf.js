// Certificate / LOR PDF generator — Sulaksh branded, pdf-lib only.
// Internship & Participation -> formal landscape certificate with gold/navy
// ornamentation. LOR -> formal portrait letter with letterhead + signature.
// QR encodes ONLY the verification URL (no personal data inside).
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, degrees, rgb } = require('pdf-lib');
const QRCode = require('qrcode');

const NAVY = rgb(12 / 255, 35 / 255, 64 / 255);
const GOLD = rgb(176 / 255, 134 / 255, 30 / 255);
const GOLD_LIGHT = rgb(201 / 255, 178 / 255, 90 / 255);
const MUTED = rgb(100 / 255, 112 / 255, 130 / 255);
const DARK = rgb(26 / 255, 36 / 255, 51 / 255);

const TITLES = {
  internship: 'Certificate of Internship',
  participation: 'Certificate of Participation',
  lor: 'Letter of Recommendation',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${m[3]} ${MONTHS[parseInt(m[2], 10) - 1] || ''} ${m[1]}`;
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
async function certificatePage(pdf, record, verifyUrl, fonts, logo, qr) {
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

  // Footer: signature (left) + QR (right)
  const fx = 80;
  const fy = 78;
  page.drawLine({ start: { x: fx, y: fy + 26 }, end: { x: fx + 170, y: fy + 26 }, thickness: 1, color: MUTED });
  const byName = record.issued_by_name || '';
  page.drawText(byName, { x: fx, y: fy + 10, size: 12, font: helvBold, color: DARK });
  const byTitle = record.issued_by_title || '';
  if (byTitle) page.drawText(byTitle, { x: fx, y: fy - 4, size: 9.5, font: helv, color: MUTED });
  const sig = spaced('Authorised Signatory');
  page.drawText(sig, { x: fx, y: fy - 17, size: 7.5, font: helv, color: MUTED });

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
async function lorPages(pdf, record, verifyUrl, fonts, logo, qr) {
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

  if (y < 230) y = newPage();
  y -= 6;
  page.drawText('With regards,', { x: ML, y: y - 12, size: 11.5, font: helv, color: DARK });
  y -= 44;
  page.drawLine({ start: { x: ML, y: y + 26 }, end: { x: ML + 190, y: y + 26 }, thickness: 1, color: MUTED });
  const byName = record.issued_by_name || '';
  page.drawText(byName, { x: ML, y: y + 8, size: 13, font: helvBold, color: DARK });
  const byTitle = record.issued_by_title ? `${record.issued_by_title}, Sulaksh` : 'Sulaksh';
  page.drawText(byTitle, { x: ML, y: y - 7, size: 10.5, font: helv, color: MUTED });

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

async function generateCertificatePdf(record, verifyUrl) {
  const pdf = await PDFDocument.create();
  const fonts = {
    helv: await pdf.embedFont(StandardFonts.Helvetica),
    helvBold: await pdf.embedFont(StandardFonts.HelveticaBold),
    helvOblique: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const logo = await loadLogo(pdf);
  const qr = await makeQr(pdf, verifyUrl);
  if ((record.certificate_type || '') === 'lor') {
    await lorPages(pdf, record, verifyUrl, fonts, logo, qr);
  } else {
    await certificatePage(pdf, record, verifyUrl, fonts, logo, qr);
  }
  return Buffer.from(await pdf.save());
}

module.exports = { generateCertificatePdf, TITLES };
