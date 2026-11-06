const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: '/Users/lakshmeshwarpandey/sulaksh-website/backend/.env' });
const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION || 'auto',
  credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY },
});
(async () => {
  let token, n = 0;
  const hits = [];
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: process.env.STORAGE_BUCKET, MaxKeys: 1000, ContinuationToken: token }));
    for (const o of r.Contents || []) {
      n++;
      const k = o.Key.toLowerCase();
      if (k.endsWith('.db') || k.endsWith('.sqlite') || k.includes('backup') || k.includes('sulaksh.db')) {
        hits.push(`${o.LastModified.toISOString()}  ${(o.Size/1024).toFixed(0)} KB  ${o.Key}`);
      }
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  console.log(`scanned ${n} objects`);
  console.log(hits.join('\n') || 'no db/backup-looking objects');
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
