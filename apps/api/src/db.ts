import { createDb, createPool } from '@srms/db';
import { env } from './env';

export const pool = createPool(env.DATABASE_URL);
export const db = createDb(pool);

/** Postgres returns numeric/bigint as strings in raw queries. */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** Postgres timestamptz text ("2026-09-29 18:12:38.8+00") → ISO-8601 string for JSON. */
export const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(String(v).replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString();
