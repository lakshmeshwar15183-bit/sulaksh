// One-off: list DB snapshots the backend wrote to object storage.
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
require('dotenv').config();

const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
  },
});

(async () => {
  let token;
  const all = [];
  do {
    const r = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.STORAGE_BUCKET,
      Prefix: 'backups/',
      MaxKeys: 1000,
      ContinuationToken: token,
    }));
    all.push(...(r.Contents || []));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);

  all.sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified));
  for (const o of all) {
    console.log(`${o.LastModified.toISOString()}  ${(o.Size / 1024).toFixed(0).padStart(8)} KB  ${o.Key}`);
  }
  console.log(`\n${all.length} backup object(s)`);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
