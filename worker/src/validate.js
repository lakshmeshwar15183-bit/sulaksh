// Port of backend/src/utils/validate.js — pure functions, no Node deps.

const ALLOWED_TYPES = {
  'application/pdf': { ext: '.pdf' },
  'image/jpeg': { ext: '.jpg' },
  'image/png': { ext: '.png' },
  'image/webp': { ext: '.webp' },
  'image/gif': { ext: '.gif' },
};

const DEFAULT_MAX_MB = 25;
function maxFileSizeBytes(env) {
  return (parseInt(env.MAX_FILE_SIZE_MB || String(DEFAULT_MAX_MB), 10) || DEFAULT_MAX_MB) * 1024 * 1024;
}

function randomUuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function slugSegment(value) {
  return String(value || 'misc')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'misc';
}

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

function buildObjectKey({ exam, category, year }, detectedType) {
  const y = year && /^\d{4}$/.test(String(year)) ? String(year) : 'undated';
  const ext = (ALLOWED_TYPES[detectedType] || {}).ext || '.pdf';
  return `materials/${slugSegment(exam)}/${slugSegment(category)}/${y}/${randomUuid()}${ext}`;
}

function detectFileType(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'application/pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

function isValidFile(buffer) {
  return detectFileType(buffer) !== null;
}

function validateUpload(env, file) {
  const errors = [];
  if (!file) {
    errors.push('No file was provided.');
    return errors;
  }
  if (file.size > maxFileSizeBytes(env)) {
    errors.push(`File exceeds the ${maxFileSizeBytes(env) / (1024 * 1024)}MB limit.`);
  }
  if (!isValidFile(file.buffer)) {
    errors.push('Unsupported file. Only PDF and images (JPG, PNG, WEBP, GIF) are accepted.');
  }
  return errors;
}

export {
  maxFileSizeBytes, randomUuid, slugSegment, sanitizeFileName,
  buildObjectKey, detectFileType, isValidFile, validateUpload,
};