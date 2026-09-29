import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle — same query API as Database. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Tx;

/**
 * Create a connection pool. On Neon use the pooled ("-pooler") URL at runtime;
 * migrations use DIRECT_URL (see migrate.ts).
 */
export function createPool(url: string | undefined = process.env.DATABASE_URL): pg.Pool {
  if (!url) throw new Error('DATABASE_URL is not set');
  return new pg.Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: process.env.DB_APP_NAME ?? 'srms',
  });
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}
