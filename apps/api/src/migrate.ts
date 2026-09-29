/**
 * Deploy step (Render pre-start): apply migrations, then idempotent bootstrap
 * (reference data + first admin). Safe to run on every deploy.
 *   node dist/migrate.js
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@srms/db';
import { bootstrap } from '@srms/db/bootstrap';
import { runMigrations } from '@srms/db/migrate';

const here = path.dirname(fileURLToPath(import.meta.url)); // apps/api/src or apps/api/dist
const folder = process.env.MIGRATIONS_DIR ?? path.resolve(here, '../../../packages/db/migrations');

try {
  await runMigrations(process.env.DIRECT_URL ?? process.env.DATABASE_URL, folder);
  console.log('✔ migrations applied');
  const pool = createPool();
  try {
    await bootstrap(createDb(pool));
  } finally {
    await pool.end();
  }
} catch (err) {
  console.error('✖ deploy migration failed:', err);
  process.exit(1);
}
