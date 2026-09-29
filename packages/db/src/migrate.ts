/**
 * Apply pending SQL migrations (idempotent). Used locally and on deploy:
 *   pnpm db:deploy
 * Uses DIRECT_URL (non-pooled) when present — required on Neon.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createPool } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(url = process.env.DIRECT_URL ?? process.env.DATABASE_URL): Promise<void> {
  const pool = createPool(url);
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.join(here, '..', 'migrations') });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const started = Date.now();
  runMigrations()
    .then(() => console.log(`✔ migrations applied in ${Date.now() - started} ms`))
    .catch((err) => {
      console.error('✖ migration failed:', err);
      process.exit(1);
    });
}
