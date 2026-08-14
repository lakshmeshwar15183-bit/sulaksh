const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
require('dotenv').config();

const {
  STORAGE_ACCESS_KEY_ID,
  STORAGE_SECRET_ACCESS_KEY,
  STORAGE_ENDPOINT,
  STORAGE_REGION,
  STORAGE_BUCKET,
} = process.env;

// S3-compatible storage (Backblaze B2, Cloudflare R2, etc.). Provide the
// endpoint/region via env vars; the presigned-URL flow works the same for all.
if (!STORAGE_ACCESS_KEY_ID || !STORAGE_SECRET_ACCESS_KEY || !STORAGE_ENDPOINT || !STORAGE_BUCKET) {
  // Fail loudly at boot rather than on first upload — credentials never
  // touch the frontend, so this check only ever runs server-side.
  console.warn(
    '[r2] Missing one or more STORAGE_* environment variables. ' +
    'Storage calls will fail until they are set.'
  );
}

const s3 = new S3Client({
  region: STORAGE_REGION || 'auto',
  endpoint: STORAGE_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: STORAGE_ACCESS_KEY_ID,
    secretAccessKey: STORAGE_SECRET_ACCESS_KEY,
  },
});

const BUCKET = STORAGE_BUCKET;
const DEFAULT_EXPIRY = parseInt(process.env.PRESIGNED_URL_EXPIRY_SECONDS || '300', 10);

/**
 * Upload a buffer to R2. Throws on failure — callers must not write a DB
 * row until this resolves successfully.
 */
async function uploadObject(key, buffer, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    // Private by default — no ACL set. Access only via presigned URLs.
  }));
  return key;
}

/**
 * Confirm an object exists in R2 (used after upload / before trusting a DB row).
 */
async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.$metadata && err.$metadata.httpStatusCode === 404) return false;
    if (err.name === 'NotFound') return false;
    throw err;
  }
}

/**
 * Delete an object from R2. Treats "already gone" as success (idempotent),
 * but rethrows any other error so callers don't silently report success.
 */
async function deleteObject(key) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    return { deleted: true, alreadyGone: false };
  } catch (err) {
    if (err.$metadata && err.$metadata.httpStatusCode === 404) {
      return { deleted: true, alreadyGone: true };
    }
    throw err;
  }
}

/**
 * Generate a short-lived presigned GET URL. `disposition` controls whether
 * the browser opens the PDF inline ("View") or downloads it ("Download").
 */
async function getPresignedDownloadUrl(key, { fileName, disposition = 'inline', expiresIn = DEFAULT_EXPIRY } = {}) {
  const safeName = fileName ? fileName.replace(/"/g, '') : 'document.pdf';
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: `${disposition}; filename="${safeName}"`,
    ResponseContentType: 'application/pdf',
  });
  return getSignedUrl(s3, command, { expiresIn });
}

module.exports = {
  s3,
  BUCKET,
  uploadObject,
  objectExists,
  deleteObject,
  getPresignedDownloadUrl,
};
