/**
 * Production bootstrap — idempotent, safe to run on every deploy:
 *   districts, commodities, entitlement rules, default settings, and the first
 *   System Admin (from BOOTSTRAP_ADMIN_* env vars) if no admin exists yet.
 *
 *   pnpm db:bootstrap
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { createDb, createPool, type Database } from './client';
import { hashPassword, passwordProblems } from './password';
import { commodities, districts, entitlementRules, settings, users } from './schema';
import { COMMODITIES, DEFAULT_SETTINGS, DISTRICTS, ENTITLEMENTS, STATE_NAME } from './data/reference';

export async function bootstrap(db: Database, log: (msg: string) => void = console.log): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(districts)
      .values(DISTRICTS.map((d) => ({ ...d, state: STATE_NAME })))
      .onConflictDoUpdate({
        target: districts.code,
        set: { name: sql`excluded.name`, nameHi: sql`excluded.name_hi` },
      });

    await tx
      .insert(commodities)
      .values(COMMODITIES.map((c) => ({ ...c })))
      .onConflictDoNothing({ target: commodities.code });

    const commodityRows = await tx.select({ id: commodities.id, code: commodities.code }).from(commodities);
    const idByCode = new Map(commodityRows.map((c) => [c.code, c.id]));
    await tx
      .insert(entitlementRules)
      .values(
        ENTITLEMENTS.map((e) => ({
          commodityId: idByCode.get(e.commodity)!,
          cardType: e.cardType,
          qtyPerMember: e.qtyPerMember,
          qtyPerFamily: e.qtyPerFamily,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(settings)
      .values(DEFAULT_SETTINGS.map((s) => ({ key: s.key, value: s.value, description: s.description })))
      .onConflictDoNothing({ target: settings.key });
  });
  log(`✔ reference data: ${DISTRICTS.length} districts, ${COMMODITIES.length} commodities, ${ENTITLEMENTS.length} entitlement rules`);

  const [existingAdmin] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'ADMIN')).limit(1);
  if (existingAdmin) {
    log('✔ system admin already exists — skipped');
    return;
  }
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    log('! no admin exists and BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD are not set — skipped');
    return;
  }
  const problems = passwordProblems(password);
  if (problems.length) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD needs ${problems.join(', ')}`);
  await db.insert(users).values({
    role: 'ADMIN',
    fullName: process.env.BOOTSTRAP_ADMIN_NAME ?? 'System Administrator',
    email,
    passwordHash: await hashPassword(password),
  });
  log(`✔ created system admin ${email}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const pool = createPool();
  bootstrap(createDb(pool))
    .catch((err) => {
      console.error('✖ bootstrap failed:', err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
