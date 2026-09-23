// Certificate / LOR PDF generator — Sulaksh branded, pdf-lib only.
// Takes a certificate DB record + its public verification URL, returns a PDF
// Buffer. QR encodes ONLY the verification URL (no personal data inside).
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const QRCode = require('qrcode');

const NAVY = rgb(12 / 255, 35 / 255, 64 / 255);
const BLUE = rgb(30 / 255, 95 / 255, 255 / 255);
const MUTED = rgb(91 / 255, 107 / 255, 128 / 255);
const DARK = rgb(26 / 255, 36 / 255, 51 / 255);

const TITLES = {
  internship: 'Certificate of Internship',
  participation: 'Certificate of Participation',
  lor: 'Letter of Recommendation',
};

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

async function generateCertificatePdf(record, verifyUrl) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const W = page.getWidth();
  const H = page.getHeight();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const cx = (text, font, size, color) => font.widthOfTextAtSize(text, size) / 2;

  // Borders
  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: NAVY, borderWidth: 3 });
  page.drawRectangle({ x: 34, y: 34, width: W - 68, height: H - 68, borderColor: BLUE, borderWidth: 1 });

  let y = H - 90;

  // Logo (optional — skipped silently if the asset is missing)
  try {
    const logoPath = path.join(__dirname, '..', '..', 'assets', 'sulaksh-emblem.png');
    if (fs.existsSync(logoPath)) {
      const png = await pdf.embedPng(fs.readFileSync(logoPath));
      const lw = 64;
      const lh = (png.height / png.width) * lw;
      page.drawImage(png, { x: W / 2 - lw / 2, y, width: lw, height: lh });
      y -= lh + 12;
    }
  } catch (e) { /* logo is decorative — never fail the PDF for it */ }

  const brand = 'SULAKSH';
  page.drawText(brand, { x: W / 2 - cx(brand, helvBold, 30), y, size: 30, font: helvBold, color: NAVY });
  y -= 22;
  const tag = 'Learn. Prepare. Achieve.';
  page.drawText(tag, { x: W / 2 - cx(tag, helv, 11), y, size: 11, font: helv, color: MUTED });
  y -= 40;

  const title = TITLES[record.certificate_type] || 'Certificate';
  page.drawText(title, { x: W / 2 - cx(title, helvBold, 24), y, size: 24, font: helvBold, color: NAVY });
  y -= 30;

  const pre = 'This certificate is proudly presented to';
  page.drawText(pre, { x: W / 2 - cx(pre, helv, 12), y, size: 12, font: helv, color: MUTED });
  y -= 34;

  const name = record.recipient_name || '';
  page.drawText(name, { x: W / 2 - cx(name, helvBold, 26), y, size: 26, font: helvBold, color: DARK });
  y -= 14;
  // underline flourish
  page.drawLine({ start: { x: W / 2 - 130, y }, end: { x: W / 2 + 130, y }, thickness: 1.5, color: BLUE });
  y -= 30;

  const roleLine = `Role / Program: ${record.role || ''}`;
  page.drawText(roleLine, { x: W / 2 - cx(roleLine, helv, 13), y, size: 13, font: helv, color: DARK });
  y -= 26;

  if (record.description) {
    for (const ln of wrapText(record.description, helv, 11, W - 180)) {
      page.drawText(ln, { x: W / 2 - cx(ln, helv, 11), y, size: 11, font: helv, color: DARK });
      y -= 16;
    }
    y -= 10;
  }

  const bits = [];
  if (record.start_date || record.end_date) {
    bits.push(`Duration: ${record.start_date || '—'}  to  ${record.end_date || '—'}`);
  }
  bits.push(`Issued on: ${record.issue_date || ''}`);
  bits.push(`Ref: ${record.certificate_number || ''}`);
  for (const b of bits) {
    page.drawText(b, { x: W / 2 - cx(b, helv, 11), y, size: 11, font: helv, color: MUTED });
    y -= 18;
  }

  // Footer: issued-by (left) + QR (right)
  const fy = 120;
  const byLine = 'Issued by';
  page.drawText(byLine, { x: 70, y: fy + 34, size: 10, font: helv, color: MUTED });
  const byName = record.issued_by_name || '';
  page.drawText(byName, { x: 70, y: fy + 16, size: 13, font: helvBold, color: DARK });
  if (record.issued_by_title) {
    page.drawText(record.issued_by_title, { x: 70, y: fy, size: 10, font: helv, color: MUTED });
  }

  const qrBuf = await QRCode.toBuffer(String(verifyUrl), { type: 'png', width: 240, margin: 1 });
  const qr = await pdf.embedPng(qrBuf);
  const qs = 110;
  page.drawImage(qr, { x: W - 70 - qs, y: fy - 30, width: qs, height: qs });
  const vt = 'Verify at:';
  page.drawText(vt, { x: W - 70 - qs, y: fy - 44, size: 8, font: helv, color: MUTED });
  const vu = String(verifyUrl);
  const short = vu.length > 52 ? vu.slice(0, 52) + '…' : vu;
  page.drawText(short, { x: W - 70 - qs, y: fy - 55, size: 7.5, font: helv, color: BLUE });

  return Buffer.from(await pdf.save());
}

module.exports = { generateCertificatePdf, TITLES };
