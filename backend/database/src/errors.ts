import { DB_ERROR_CODES, type DbErrorCode } from '@srms/shared';

export interface DbRuleError {
  /** SRMS rule code (e.g. QUOTA_EXCEEDED) or a generic Postgres class. */
  code: DbErrorCode | 'UNIQUE_VIOLATION' | 'FOREIGN_KEY_VIOLATION' | 'CHECK_VIOLATION';
  status: number;
  message: string;
  /** Constraint name for unique/FK/check violations. */
  constraint?: string;
}

interface PgLikeError {
  code?: string;
  message?: string;
  hint?: string;
  constraint?: string;
  detail?: string;
  cause?: unknown;
}

/** Drizzle wraps driver errors (DrizzleQueryError); walk the cause chain to the pg error. */
function findPgError(err: unknown): PgLikeError | null {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur && typeof cur === 'object'; depth++) {
    const e = cur as PgLikeError;
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    cur = e.cause;
  }
  return null;
}

/**
 * Translate a database error into an API-friendly rule error, or null if it
 * is not a known/expected condition (then it's a 500).
 */
export function parseDbError(err: unknown): DbRuleError | null {
  const pgErr = findPgError(err);
  if (!pgErr) return null;

  if (pgErr.code === 'P0001' && pgErr.message?.startsWith('SRMS_')) {
    const code = (pgErr.hint ?? pgErr.message.slice(5).split(':')[0]) as DbErrorCode;
    const message = pgErr.message.replace(/^SRMS_[A-Z_]+:\s*/, '');
    return { code, status: DB_ERROR_CODES[code] ?? 422, message };
  }
  switch (pgErr.code) {
    case '23505':
      return { code: 'UNIQUE_VIOLATION', status: 409, message: 'Record already exists', constraint: pgErr.constraint };
    case '23503':
      return { code: 'FOREIGN_KEY_VIOLATION', status: 422, message: 'Referenced record does not exist or is still in use', constraint: pgErr.constraint };
    case '23514':
      return { code: 'CHECK_VIOLATION', status: 422, message: 'Value violates a data rule', constraint: pgErr.constraint };
    default:
      return null;
  }
}
