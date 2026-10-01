/**
 * DEV ONLY: drop everything so migrations can be re-applied from scratch.
 * Refuses to run in production or against a non-local database unless
 * ALLOW_DB_RESET=true is set explicitly.
 */
import 'dotenv/config';
import { createPool } from './client';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '';
const isLocal = /@(localhost|127\.0\.0\.1|postgres)(:|\/)/.test(url);

if (process.env.NODE_ENV === 'production' || (!isLocal && process.env.ALLOW_DB_RESET !== 'true')) {
  console.error('✖ Refusing to reset a production / remote database. Set ALLOW_DB_RESET=true if you really mean it.');
  process.exit(1);
}

const pool = createPool(url);
try {
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  console.log('✔ database reset');
} finally {
  await pool.end();
}
