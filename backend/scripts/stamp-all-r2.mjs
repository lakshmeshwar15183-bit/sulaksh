#!/usr/bin/env node
// One-time batch stamper — stamps every PDF under materials/ in R2.
import 'dotenv/config';
import fs from 'node:fs';
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createRequire } from 'node:module';
const _r = createRequire(import.meta.url);
const { stampPdf } = _r('../src/stamp.js');

const BUCKET = process.env.STORAGE_BUCKET;
const s3 = new S3Client({
  region: process.env.STORAGE_REGION || 'auto',
  endpoint: process.env.STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
  },
});
const getBuf = async Key => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }))).Body.transformToByteArray());
const put = async (Key, Body, CT) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body, ContentType: CT }));

const PROG='scripts/stamp-progress.txt';
const doneKeys=new Set(fs.existsSync(PROG)?fs.readFileSync(PROG,'utf8').split('\n').filter(Boolean):[]);

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
    if (doneKeys.has(Key)) { skipped++; continue; }
    try {
      const buf = await getBuf(Key);
      if (buf.subarray(0, 5).toString() !== '%PDF-') { skipped++; continue; }
      const stamped = await stampPdf(buf);
      await put(Key, stamped, 'application/pdf');
      done++; fs.appendFileSync(PROG, Key + '\n');
      if (done % 25 === 0) console.log(`   … ${done} stamped`);
    } catch (e) {
      failed++; console.log('FAIL', Key.slice(-35), e.message);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`✅ stamped: ${done} | skipped: ${skipped} | failed: ${failed}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
