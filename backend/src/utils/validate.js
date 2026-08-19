const { v4: uuidv4 } = require('uuid');

const MAX_FILE_SIZE_BYTES = (parseInt(process.env.MAX_FILE_SIZE_MB || '25', 10)) * 1024 * 1024;

const ALLOWED_TYPES = {
  'application/pdf': { ext: '.pdf' },
  'image/jpeg': { ext: '.jpg' },
  'image/png': { ext: '.png' },
  'image/webp': { ext: '.webp' },
  'image/gif': { ext: '.gif' },
};

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
function sanitizeFileName(originalName, detectedType) {
  const base = String(originalName || 'document')
    .replace(/[/\\]/g, '_')
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .trim()
    .slice(0, 140);
  const knownExts = Object.values(ALLOWED_TYPES).map((t) => t.ext);
  if (knownExts.some((e) => base.toLowerCase().endsWith(e))) return base;
  const ext = (ALLOWED_TYPES[detectedType] || {}).ext || '.pdf';
  return base + ext;
}

/**
 * Build the R2 object key: materials/{exam}/{category}/{year}/{uuid}{ext}
 * The UUID guarantees uniqueness — original filenames are never relied on
 * as identifiers, so duplicate titles/filenames never collide.
 */
function buildObjectKey({ exam, category, year }, detectedType) {
  const y = year && /^\d{4}$/.test(String(year)) ? String(year) : 'undated';
  const ext = (ALLOWED_TYPES[detectedType] || {}).ext || '.pdf';
  return `materials/${slugSegment(exam)}/${slugSegment(category)}/${y}/${uuidv4()}${ext}`;
}

/**
 * Detect the real content type from magic bytes (never trusts the
 * client-supplied mimetype, which is trivially spoofable).
 */
function detectFileType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const b = buffer;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'application/pdf'; // %PDF-
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'; // FFD8FF
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'; // \x89PNG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'; // GIF8
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'; // RIFF..WEBP
  return null;
}

/**
 * Validate an uploaded file buffer against the allowed types using magic
 * bytes, not the client-supplied mimetype (trivially spoofable).
 */
function isValidFile(buffer) {
  return detectFileType(buffer) !== null;
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
  if (!isValidFile(file.buffer)) {
    errors.push('Unsupported file. Only PDF and images (JPG, PNG, WEBP, GIF) are accepted.');
  }
  return errors;
}

module.exports = {
  MAX_FILE_SIZE_BYTES,
  slugSegment,
  sanitizeFileName,
  buildObjectKey,
  detectFileType,
  isValidFile,
  validateUpload,
};
