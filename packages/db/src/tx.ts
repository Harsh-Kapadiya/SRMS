import { sql } from 'drizzle-orm';
import type { RoleName } from '@srms/shared';
import type { Database, Tx } from './client';

export interface Actor {
  userId: string;
  role: RoleName;
}

/**
 * Run `fn` in a transaction stamped with the acting user, so DB triggers can
 * write audit_logs / ledger rows with the correct user_id and role
 * (SRS NFR-4: audit logging of all stock and distribution changes).
 */
export function withActor<T>(db: Database, actor: Actor | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if (actor) {
      await tx.execute(
        sql`select set_config('srms.user_id', ${actor.userId}, true), set_config('srms.role', ${actor.role}, true)`,
      );
    }
    return fn(tx);
  });
}

/** Set a transaction-local srms.* flag (e.g. suppress_notifications for bulk imports). */
export async function setTxFlag(tx: Tx, name: 'suppress_notifications', on: boolean): Promise<void> {
  await tx.execute(sql`select set_config(${'srms.' + name}, ${on ? 'on' : 'off'}, true)`);
}
