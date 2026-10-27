import 'dotenv/config';
import { getPool } from '../src/db/pool.js';

let pool;
try {
  pool = getPool();
  const result = await pool.query('SELECT 1 AS connected');
  if (result.rows[0]?.connected !== 1) throw new Error('Unexpected query result');
  console.log('PostgreSQL connection successful (SELECT 1).');
} catch (error) {
  console.error('PostgreSQL connection failed:', error.message);
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
