// Daily database backups to R2 — protects against volume loss/redeploys.
// Keeps one file per day (sulaksh-YYYY-MM-DD.db); prunes anything older
// than BACKUP_RETENTION_DAYS (default 30).
//
// Uses better-sqlite3's db.backup(), which copies the database INCLUDING
// anything sitting in the -wal file. Reading sulaksh.db directly would risk
// a stale/torn snapshot, since this app runs in WAL journal mode.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET, uploadObject } = require('./r2');

async function listBackups() {
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: 'backups/',
    MaxKeys: 500,
  }));
  return (res.Contents || [])
    .filter(o => o.Key.endsWith('.db'))
    .sort((a, b) => String(a.Key).localeCompare(String(b.Key)));
}

async function backupNow(db) {
  // db.backup() writes a fully consistent snapshot to a temp file.
  const tmp = path.join(os.tmpdir(), `sulaksh-snapshot-${Date.now()}.db`);
  try {
    await db.backup(tmp);
    const buf = fs.readFileSync(tmp);
    const day = new Date().toISOString().slice(0, 10);
    const key = `backups/sulaksh-${day}.db`;
    await uploadObject(key, buf, 'application/x-sqlite3');
    // prune old ones beyond retention
    const retention = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
    const cutoff = new Date(Date.now() - retention * 86400000).toISOString().slice(0, 10);
    for (const o of await listBackups()) {
      const m = String(o.Key).match(/sulaksh-(\d{4}-\d{2}-\d{2})\.db$/);
      if (m && m[1] < cutoff) {
        try { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: o.Key })); } catch (e) {}
      }
    }
    return { key, bytes: buf.length };
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

function schedule(db) {
  if (!process.env.STORAGE_BUCKET) return;
  const run = async () => {
    try {
      const r = await backupNow(db);
      console.log('[backup] DB backed up →', r.key, `(${(r.bytes / 1024).toFixed(0)} KB)`);
    } catch (e) {
      console.error('[backup] failed:', e.message);
    }
  };
  setTimeout(run, 15 * 1000);            // shortly after boot
  setInterval(run, 12 * 60 * 60 * 1000); // then twice daily
}

module.exports = { backupNow, schedule };
