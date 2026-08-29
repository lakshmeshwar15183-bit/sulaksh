// Branding stamp — sulaksh.online watermark for every PDF page.
const { PDFDocument, StandardFonts, degrees, rgb } = require('pdf-lib');

async function stampPdf(buffer, ip) {
  const pdfDoc = await PDFDocument.load(buffer);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const day = new Date().toISOString().slice(0, 10);
  const txt = `sulaksh.online${ip ? ' · ' + ip : ''} · ${day}`;
  pdfDoc.getPages().forEach(p => {
    const w = p.getWidth(), h = p.getHeight();
    const ang = Math.atan(h / w) * 180 / Math.PI;
    const size = Math.max(16, Math.round(w / 34));
    p.drawText(txt, { x: w * 0.08, y: h * 0.5, size, font, color: rgb(0.55, 0.55, 0.62), opacity: 0.28, rotate: degrees(ang) });
    p.drawText('sulaksh.online', { x: w - 130, y: 14, size: 9, font, color: rgb(0.55, 0.55, 0.62), opacity: 0.45 });
  });
  return Buffer.from(await pdfDoc.save());
}

module.exports = { stampPdf };
