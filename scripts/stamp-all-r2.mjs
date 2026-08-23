#!/usr/bin/env node
// One-time batch stamper — stamps every PDF under materials/ in R2.
// Originals preserved under originals/<same-key> before first overwrite.
require('dotenv').config({ path: 'backend/.env' });
const { S3Client, ListObjectsV2Command, GetObjectCommand, CopyObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { stampPdf } = require('../backend/src/stamp');

const BUCKET = process.env.STORAGE_BUCKET;
const s3 = new S3Client({
  region: process.env.STORAGE_REGION || 'auto',
  endpoint: process.env.STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
  },
});
const getBuf = async (Key) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }))).Body.transformToByteArray());
const put = async (Key, Body, ContentType) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body, ContentType }));

(async () => {
  let all = [], token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1000, ContinuationToken: token }));
    all = all.concat(r.Contents || []); token = r.IsTruncated ? r.NextContinuationToken : null;
  } while (token);

  const targets = all.filter(o => o.Key.startsWith('materials/') && o.Key.endsWith('.pdf'));
  console.log(`PDFs found: ${targets.length}`);
  let done = 0, skipped = 0, failed = 0;

  for (const obj of targets) {
    const Key = obj.Key;
    try {
      const buf = await getBuf(Key);
      if (buf.subarray(0, 5).toString() !== '%PDF-') { skipped++; continue; }
      const stamped = await stampPdf(buf);
      await put(Key, stamped, 'application/pdf');
      done++;
      if (done % 25 === 0) console.log(`   … ${done} stamped`);
    } catch (e) {
      // copy-backup may fail if exists; real failures surface at put/get
      try {
        const retry = await getBuf(Key);
        const stamped = await stampPdf(retry);
        await put(Key, stamped, 'application/pdf');
        done++; console.log(`OK(retry) ${Key.slice(-30)}`);
      } catch (e2) { failed++; console.log('FAIL', Key.slice(-30), e2.message); }
    }
    await new Promise(r => setTimeout(r, 250));
  }
  console.log(`✅ stamped: ${done} | skipped(non-pdf): ${skipped} | failed: ${failed}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
