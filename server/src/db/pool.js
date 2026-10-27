import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
// Created only when a DB operation is requested; app health check is independent.
let pool;
export function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is missing. Copy server/.env.example to server/.env.');
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}
