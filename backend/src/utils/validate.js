const { v4: uuidv4 } = require('uuid');

const MAX_FILE_SIZE_BYTES = (parseInt(process.env.MAX_FILE_SIZE_MB || '25', 10)) * 1024 * 1024;

/**
 * Slugify a path segment (exam/category names) for use inside an R2 object
 * key. Lowercase, alphanumeric + hyphens only.
 */
function slugSegment(value) {
  return String(value || 'misc')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'misc';
}

/**
 * Strip a filename down to something safe to store/display. Does not
 * affect the R2 object key (which uses a UUID), only the display name.
 */
function sanitizeFileName(originalName) {
  const base = String(originalName || 'document.pdf')
    .replace(/[/\\]/g, '_')
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .trim()
    .slice(0, 150);
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

/**
 * Build the R2 object key: materials/{exam}/{category}/{year}/{uuid}.pdf
 * The UUID guarantees uniqueness — original filenames are never relied on
 * as identifiers, so duplicate titles/filenames never collide.
 */
function buildObjectKey({ exam, category, year }) {
  const y = year && /^\d{4}$/.test(String(year)) ? String(year) : 'undated';
  return `materials/${slugSegment(exam)}/${slugSegment(category)}/${y}/${uuidv4()}.pdf`;
}

/**
 * Validate an uploaded file buffer: real PDF magic bytes, not just the
 * client-supplied mimetype (which is trivially spoofable).
 */
function isPdfBuffer(buffer) {
  if (!buffer || buffer.length < 5) return false;
  return buffer.slice(0, 5).toString('ascii') === '%PDF-';
}

function validateUpload(file) {
  const errors = [];
  if (!file) {
    errors.push('No file was provided.');
    return errors;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    errors.push(`File exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit.`);
  }
  if (file.mimetype !== 'application/pdf') {
    errors.push('Only PDF files are accepted.');
  }
  if (!isPdfBuffer(file.buffer)) {
    errors.push('File does not look like a valid PDF (magic bytes check failed).');
  }
  return errors;
}

module.exports = {
  MAX_FILE_SIZE_BYTES,
  slugSegment,
  sanitizeFileName,
  buildObjectKey,
  isPdfBuffer,
  validateUpload,
};
