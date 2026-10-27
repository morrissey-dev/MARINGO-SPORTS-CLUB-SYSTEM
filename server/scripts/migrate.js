import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getPool } from '../src/db/pool.js';

const dir = fileURLToPath(new URL('../../database/migrations/', import.meta.url));
const pool = getPool();
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('mscms_migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY, checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const files = (await readdir(dir)).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
    for (const file of files) {
      const sql = await readFile(path.join(dir,file),'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = await client.query('SELECT checksum FROM schema_migrations WHERE filename=$1',[file]);
      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum) throw new Error(`Already-applied migration has changed: ${file}`);
        console.log('Already applied:',file);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename, checksum) VALUES($1,$2)',[file,checksum]);
      console.log('Applied:',file);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
} catch(e) {
  console.error('Migration failed:',e.message);
  process.exitCode=1;
} finally {
  await pool.end();
}
