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
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  // Fail loudly at boot rather than on first upload — credentials never
  // touch the frontend, so this check only ever runs server-side.
  console.warn(
    '[r2] Missing one or more R2_* environment variables. ' +
    'R2 calls will fail until they are set.'
  );
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = R2_BUCKET_NAME;
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
