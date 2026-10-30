import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { makeAadhaar } from '@srms/shared';
import { createDb, createPool, type Database } from '../src/client';
import { bootstrap } from '../src/bootstrap';
import { parseDbError } from '../src/errors';
import { protectAadhaar } from '../src/crypto';
import { runMigrations } from '../src/migrate';
import * as s from '../src/schema';

export const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://srms:srms@localhost:5432/srms_test';

process.env.AADHAAR_ENC_KEY ??= randomBytes(32).toString('base64');
process.env.AADHAAR_HASH_PEPPER ??= 'test-pepper-0123456789';

export async function freshDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  const admin = createPool(TEST_URL);
  await admin.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await admin.query('DROP SCHEMA public CASCADE');
  await admin.query('CREATE SCHEMA public');
  await admin.end();
  await runMigrations(TEST_URL);
  const pool = createPool(TEST_URL);
  const db = createDb(pool);
  delete process.env.BOOTSTRAP_ADMIN_EMAIL;
  await bootstrap(db, () => undefined);
  return { db, close: () => pool.end() };
}

let seq = 0;
const uniq = () => ++seq;
const mobile = () => `9${String(100_000_000 + uniq()).padStart(9, '0')}`;
const aadhaar = () => makeAadhaar(`${2 + (seq % 7)}${String(1_000_000_000 + uniq() * 7919).slice(-10)}`);

export async function districtId(db: Database, code: string): Promise<number> {
  const [d] = await db.select().from(s.districts).where(eq(s.districts.code, code));
  return d!.id;
}

export async function commodityId(db: Database, code: string): Promise<number> {
  const [c] = await db.select().from(s.commodities).where(eq(s.commodities.code, code));
  return c!.id;
}

export async function makeDealer(db: Database, districtCode = 'PAT', status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
  const n = uniq();
  const [u] = await db
    .insert(s.users)
    .values({ role: 'DEALER', fullName: `Dealer ${n}`, email: `dealer${n}@test.local`, passwordHash: 'x' })
    .returning();
  const [d] = await db
    .insert(s.dealers)
    .values({ userId: u!.id, name: `Dealer ${n}`, licenseNo: `LIC-${n}`, mobile: mobile(), districtId: await districtId(db, districtCode), status })
    .returning();
  return d!;
}

export async function makeShop(db: Database, dealerId: string | null, districtCode = 'PAT') {
  const n = uniq();
  const [shop] = await db
    .insert(s.shops)
    .values({ shopCode: `T-${n}`, dealerId, name: `Shop ${n}`, address: 'Test address', districtId: await districtId(db, districtCode) })
    .returning();
  return shop!;
}

export async function makeBeneficiary(
  db: Database,
  opts: { shopId?: string; districtCode?: string; members?: number; verified?: boolean; cardType?: 'AAY' | 'PHH' } = {},
) {
  const m = mobile();
  const [u] = await db.insert(s.users).values({ role: 'BENEFICIARY', fullName: 'Test Beneficiary', mobile: m }).returning();
  const [b] = await db
    .insert(s.beneficiaries)
    .values({
      userId: u!.id,
      ...protectAadhaar(aadhaar()),
      name: 'Test Beneficiary',
      mobile: m,
      address: 'Test address',
      districtId: await districtId(db, opts.districtCode ?? 'PAT'),
      homeShopId: opts.shopId,
      cardType: opts.cardType ?? 'PHH',
    })
    .returning();
  const members = opts.members ?? 4;
  await db.insert(s.familyMembers).values(
    Array.from({ length: members }, (_, i) => ({ beneficiaryId: b!.id, name: `Member ${i}`, relation: i === 0 ? 'Self' : 'Son', isHead: i === 0 })),
  );
  if (opts.verified !== false) {
    await db.update(s.beneficiaries).set({ verificationStatus: 'VERIFIED' }).where(eq(s.beneficiaries.id, b!.id));
  }
  const [fresh] = await db.select().from(s.beneficiaries).where(eq(s.beneficiaries.id, b!.id));
  return fresh!;
}

export async function receive(db: Database, shopId: string, commodity: number, quantity: number) {
  await db.insert(s.stockMovements).values({ shopId, commodityId: commodity, type: 'RECEIPT', quantity });
}

export async function stockOf(db: Database, shopId: string, commodity: number) {
  const r = await db.execute<{ quantity_available: string; low_stock_alerted_at: Date | null; low_stock_threshold: string }>(
    sql`select quantity_available, low_stock_alerted_at, low_stock_threshold from stock where shop_id = ${shopId} and commodity_id = ${commodity}`,
  );
  return r.rows[0];
}

/** Issue ration the way the API does: header + items in one transaction. */
export async function issue(
  db: Database,
  args: { beneficiaryId: string; shopId: string; dealerId: string; items: { commodityId: number; quantity: number }[] },
) {
  return db.transaction(async (tx) => {
    const [d] = await tx
      .insert(s.distributions)
      .values({ beneficiaryId: args.beneficiaryId, shopId: args.shopId, dealerId: args.dealerId, authMethod: 'OTP' })
      .returning();
    if (args.items.length) {
      await tx.insert(s.distributionItems).values(args.items.map((it) => ({ distributionId: d!.id, ...it })));
    }
    return d!;
  });
}

/** Resolve the SRMS rule code a promise rejects with. */
export async function ruleCode(p: PromiseLike<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    return parseDbError(err)?.code ?? `UNEXPECTED: ${(err as Error).message}`;
  }
}
