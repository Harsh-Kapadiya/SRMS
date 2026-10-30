/**
 * Apply pending SQL migrations (idempotent). Used locally and on deploy:
 *   pnpm db:deploy   (src/cli.ts)
 * Uses DIRECT_URL (non-pooled) when present — required on Neon.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createPool } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(
  url = process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  migrationsFolder = path.join(here, '..', 'migrations'),
): Promise<void> {
  const pool = createPool(url);
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
