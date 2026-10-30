/**
 * Integration tests: every business rule from the SRS that the database
 * enforces. Runs against a throw-away database (TEST_DATABASE_URL).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { istMonthKey } from '@srms/shared';
import type { Database } from '../src/client';
import { decryptAadhaar } from '../src/crypto';
import * as s from '../src/schema';
import {
  commodityId,
  freshDatabase,
  issue,
  makeBeneficiary,
  makeDealer,
  makeShop,
  receive,
  ruleCode,
  stockOf,
} from './helpers';

let db: Database;
let close: () => Promise<void>;
let RICE: number;
let WHEAT: number;
let SUGAR: number;

beforeAll(async () => {
  ({ db, close } = await freshDatabase());
  RICE = await commodityId(db, 'RICE');
  WHEAT = await commodityId(db, 'WHEAT');
  SUGAR = await commodityId(db, 'SUGAR');
});
afterAll(async () => close());

describe('FR-5 / R11 — dealer & shop management', () => {
  it('allows up to 3 active shops per dealer and rejects the 4th', async () => {
    const dealer = await makeDealer(db);
    for (let i = 0; i < 3; i++) await makeShop(db, dealer.id);
    expect(await ruleCode(makeShop(db, dealer.id))).toBe('DEALER_SHOP_LIMIT');
  });

  it('counts only ACTIVE shops, so a deactivated shop frees a slot', async () => {
    const dealer = await makeDealer(db);
    const shops = await Promise.all([1, 2, 3].map(() => makeShop(db, dealer.id)));
    await db.update(s.shops).set({ status: 'INACTIVE' }).where(eq(s.shops.id, shops[0]!.id));
    expect(await ruleCode(makeShop(db, dealer.id))).toBeNull();
  });

  it('rejects a shop outside the dealer’s district', async () => {
    const dealer = await makeDealer(db, 'PAT');
    expect(await ruleCode(makeShop(db, dealer.id, 'GAY'))).toBe('SHOP_DISTRICT_MISMATCH');
  });

  it('rejects assigning a shop to a suspended dealer', async () => {
    const dealer = await makeDealer(db, 'PAT', 'SUSPENDED');
    expect(await ruleCode(makeShop(db, dealer.id))).toBe('DEALER_INACTIVE');
  });

  it('respects an admin-changed limit from the settings table', async () => {
    await db.update(s.settings).set({ value: 1 }).where(eq(s.settings.key, 'max_shops_per_dealer'));
    const dealer = await makeDealer(db);
    await makeShop(db, dealer.id);
    expect(await ruleCode(makeShop(db, dealer.id))).toBe('DEALER_SHOP_LIMIT');
    await db.update(s.settings).set({ value: 3 }).where(eq(s.settings.key, 'max_shops_per_dealer'));
  });
});

describe('FR-1 / FR-2 / R8 — registration, verification and SMS', () => {
  it('queues only "registration received" on insert, then "approved" + ration card on verification', async () => {
    const b = await makeBeneficiary(db, { verified: false });
    expect(b.registrationNo).toMatch(/^REG\d{11}$/);
    expect(b.rationCardNo).toBeNull();
    let events = await db.select({ e: s.notifications.event }).from(s.notifications).where(eq(s.notifications.beneficiaryId, b.id));
    expect(events.map((x) => x.e)).toEqual(['REGISTRATION_RECEIVED']);

    await db.update(s.beneficiaries).set({ verificationStatus: 'VERIFIED' }).where(eq(s.beneficiaries.id, b.id));
    const [v] = await db.select().from(s.beneficiaries).where(eq(s.beneficiaries.id, b.id));
    expect(v!.rationCardNo).toMatch(/^\d{12}$/);
    expect(v!.verifiedAt).not.toBeNull();
    events = await db.select({ e: s.notifications.event }).from(s.notifications).where(eq(s.notifications.beneficiaryId, b.id));
    expect(events.map((x) => x.e).sort()).toEqual(['REGISTRATION_APPROVED', 'REGISTRATION_RECEIVED']);
  });

  it('generates this month’s quota from card type × family size on verification', async () => {
    const phh = await makeBeneficiary(db, { members: 4 });
    const aay = await makeBeneficiary(db, { members: 6, cardType: 'AAY' });
    const month = istMonthKey();
    const q = await db
      .select({ b: s.beneficiaryQuotas.beneficiaryId, c: s.beneficiaryQuotas.commodityId, qty: s.beneficiaryQuotas.allocatedQty })
      .from(s.beneficiaryQuotas)
      .where(eq(s.beneficiaryQuotas.quotaMonth, month));
    const get = (b: string, c: number) => q.find((x) => x.b === b && x.c === c)?.qty;
    expect(get(phh.id, RICE)).toBe(12); // 3 kg × 4 members
    expect(get(phh.id, WHEAT)).toBe(8); // 2 kg × 4 members
    expect(get(phh.id, SUGAR)).toBeUndefined();
    expect(get(aay.id, RICE)).toBe(21); // 35 kg per AAY family, split 21 + 14
    expect(get(aay.id, WHEAT)).toBe(14);
    expect(get(aay.id, SUGAR)).toBe(1);
  });

  it('never stores the Aadhaar number in plain text and blocks duplicates via the hash', async () => {
    const b = await makeBeneficiary(db);
    const raw = await db.execute<{ row: string }>(sql`select row_to_json(b)::text as row from beneficiaries b where beneficiary_id = ${b.id}`);
    const plain = decryptAadhaar(b.aadhaarEnc);
    expect(plain).toMatch(/^[2-9]\d{11}$/);
    expect(raw.rows[0]!.row).not.toContain(plain);
    const dup = db.insert(s.users).values({ role: 'BENEFICIARY', fullName: 'Dup', mobile: '6000000001' }).returning().then(([u]) =>
      db.insert(s.beneficiaries).values({
        userId: u!.id, aadhaarEnc: 'x', aadhaarHash: b.aadhaarHash, aadhaarLast4: '0000',
        name: 'Dup', mobile: '6000000001', address: 'x', districtId: b.districtId,
      }),
    );
    expect(await ruleCode(dup)).toBe('UNIQUE_VIOLATION');
  });

  it('rejects a profile pointing at a user of the wrong role', async () => {
    const [u] = await db.insert(s.users).values({ role: 'BENEFICIARY', fullName: 'Not a dealer', mobile: '6000000002' }).returning();
    const p = db.insert(s.dealers).values({ userId: u!.id, name: 'x', licenseNo: 'LIC-ROLE', mobile: '6000000002', districtId: 1 });
    expect(await ruleCode(p)).toBe('ROLE_MISMATCH');
  });
});

describe('FR-3 — ration distribution (eligibility → quota → stock → atomic issue)', () => {
  async function setup(stockKg = 100) {
    const dealer = await makeDealer(db);
    const shop = await makeShop(db, dealer.id);
    await receive(db, shop.id, RICE, stockKg);
    await receive(db, shop.id, WHEAT, stockKg);
    const ben = await makeBeneficiary(db, { shopId: shop.id, members: 4 });
    return { dealer, shop, ben };
  }

  it('issues ration: deducts stock + quota, numbers the receipt, writes the ledger and queues the SMS', async () => {
    const { dealer, shop, ben } = await setup();
    const d = await issue(db, { beneficiaryId: ben.id, shopId: shop.id, dealerId: dealer.id, items: [{ commodityId: RICE, quantity: 12 }, { commodityId: WHEAT, quantity: 5 }] });
    expect(d.receiptNo).toMatch(/^RCPT-\d{6}-\d{7}$/);
    expect(Number((await stockOf(db, shop.id, RICE))!.quantity_available)).toBe(88);
    const [q] = await db.select().from(s.beneficiaryQuotas).where(and(eq(s.beneficiaryQuotas.beneficiaryId, ben.id), eq(s.beneficiaryQuotas.commodityId, WHEAT)));
    expect([q!.issuedQty, q!.remainingQty]).toEqual([5, 3]);
    const ledger = await db.select().from(s.stockMovements).where(eq(s.stockMovements.distributionId, d.id));
    expect(ledger.map((m) => [m.type, m.quantity, m.balanceAfter]).sort()).toEqual([['ISSUE', -12, 88], ['ISSUE', -5, 95]]);
    const [sms] = await db.select().from(s.notifications).where(and(eq(s.notifications.beneficiaryId, ben.id), eq(s.notifications.event, 'RATION_ISSUED')));
    expect(sms!.message).toContain(d.receiptNo);
    expect(sms!.message).toContain('Rice 12 kg');
  });

  it('rejects over-quota issue and rolls back the whole transaction', async () => {
    const { dealer, shop, ben } = await setup();
    const code = await ruleCode(issue(db, { beneficiaryId: ben.id, shopId: shop.id, dealerId: dealer.id, items: [{ commodityId: WHEAT, quantity: 2 }, { commodityId: RICE, quantity: 13 }] }));
    expect(code).toBe('QUOTA_EXCEEDED');
    expect(Number((await stockOf(db, shop.id, WHEAT))!.quantity_available)).toBe(100); // wheat line rolled back too
    const [q] = await db.select().from(s.beneficiaryQuotas).where(and(eq(s.beneficiaryQuotas.beneficiaryId, ben.id), eq(s.beneficiaryQuotas.commodityId, WHEAT)));
    expect(q!.issuedQty).toBe(0);
  });

  it('rejects issue beyond available shop stock', async () => {
    const { dealer, shop, ben } = await setup(10);
    expect(await ruleCode(issue(db, { beneficiaryId: ben.id, shopId: shop.id, dealerId: dealer.id, items: [{ commodityId: RICE, quantity: 12 }] }))).toBe('INSUFFICIENT_STOCK');
  });

  it('rejects unverified beneficiaries, wrong dealers, and empty receipts', async () => {
    const { dealer, shop } = await setup();
    const pending = await makeBeneficiary(db, { shopId: shop.id, verified: false });
    expect(await ruleCode(issue(db, { beneficiaryId: pending.id, shopId: shop.id, dealerId: dealer.id, items: [{ commodityId: RICE, quantity: 1 }] }))).toBe('BENEFICIARY_NOT_ELIGIBLE');

    const ben = await makeBeneficiary(db, { shopId: shop.id });
    const other = await makeDealer(db);
    expect(await ruleCode(issue(db, { beneficiaryId: ben.id, shopId: shop.id, dealerId: other.id, items: [{ commodityId: RICE, quantity: 1 }] }))).toBe('DEALER_SHOP_MISMATCH');
    expect(await ruleCode(issue(db, { beneficiaryId: ben.id, shopId: shop.id, dealerId: dealer.id, items: [] }))).toBe('INVALID_MOVEMENT');
  });

  it('rejects commodities outside the card’s entitlement (PHH has no sugar)', async () => {
    const { dealer, shop, ben } = await setup();
    await receive(db, shop.id, SUGAR, 10);
    expect(await ruleCode(issue(db, { beneficiaryId: ben.id, shopId: shop.id, dealerId: dealer.id, items: [{ commodityId: SUGAR, quantity: 1 }] }))).toBe('NO_QUOTA');
  });

  it('keeps distributions immutable; voiding returns quota and stock through the ledger', async () => {
    const { dealer, shop, ben } = await setup();
    const d = await issue(db, { beneficiaryId: ben.id, shopId: shop.id, dealerId: dealer.id, items: [{ commodityId: RICE, quantity: 10 }] });
    expect(await ruleCode(db.update(s.distributions).set({ issuedAt: new Date('2020-01-01') }).where(eq(s.distributions.id, d.id)))).toBe('IMMUTABLE_RECORD');
    expect(await ruleCode(db.delete(s.distributions).where(eq(s.distributions.id, d.id)))).toBe('IMMUTABLE_RECORD');

    await db.update(s.distributions).set({ status: 'VOIDED' }).where(eq(s.distributions.id, d.id));
    expect(Number((await stockOf(db, shop.id, RICE))!.quantity_available)).toBe(100);
    const [q] = await db.select().from(s.beneficiaryQuotas).where(and(eq(s.beneficiaryQuotas.beneficiaryId, ben.id), eq(s.beneficiaryQuotas.commodityId, RICE)));
    expect(q!.issuedQty).toBe(0);
    expect(await ruleCode(db.update(s.distributions).set({ status: 'COMPLETED' }).where(eq(s.distributions.id, d.id)))).toBe('INVALID_TRANSITION');
  });
});

describe('FR-4 / R5 / R19 — stock ledger and low-stock alerts', () => {
  it('blocks direct edits of stock quantities (ledger only)', async () => {
    const dealer = await makeDealer(db);
    const shop = await makeShop(db, dealer.id);
    await receive(db, shop.id, RICE, 50);
    expect(await ruleCode(db.update(s.stock).set({ quantityAvailable: 5000 }).where(eq(s.stock.shopId, shop.id)))).toBe('STOCK_DIRECT_UPDATE');
    expect(await ruleCode(db.update(s.stockMovements).set({ quantity: 5000 }).where(eq(s.stockMovements.shopId, shop.id)))).toBe('IMMUTABLE_RECORD');
    expect(await ruleCode(db.insert(s.stockMovements).values({ shopId: shop.id, commodityId: RICE, type: 'ADJUSTMENT', reason: 'DAMAGE', quantity: -60 }))).toBe('INSUFFICIENT_STOCK');
  });

  it('alerts the dealer once when stock falls below 20% of the monthly quota, and re-arms after a receipt', async () => {
    const dealer = await makeDealer(db);
    const shop = await makeShop(db, dealer.id);
    await receive(db, shop.id, RICE, 100);
    await db.update(s.stock).set({ monthlyQuota: 100 }).where(eq(s.stock.shopId, shop.id));
    expect(Number((await stockOf(db, shop.id, RICE))!.low_stock_threshold)).toBe(20);

    const alerts = async () =>
      (await db.select().from(s.notifications).where(and(eq(s.notifications.event, 'LOW_STOCK'), eq(s.notifications.recipientUserId, dealer.userId)))).length;

    await db.insert(s.stockMovements).values({ shopId: shop.id, commodityId: RICE, type: 'ADJUSTMENT', reason: 'DAMAGE', quantity: -75 }); // 25 left
    expect(await alerts()).toBe(0);
    await db.insert(s.stockMovements).values({ shopId: shop.id, commodityId: RICE, type: 'ADJUSTMENT', reason: 'DAMAGE', quantity: -10 }); // 15 < 20
    expect(await alerts()).toBe(1);
    await db.insert(s.stockMovements).values({ shopId: shop.id, commodityId: RICE, type: 'ADJUSTMENT', reason: 'DAMAGE', quantity: -5 }); // still low
    expect(await alerts()).toBe(1);
    await receive(db, shop.id, RICE, 90); // back to 100 → re-armed
    await db.insert(s.stockMovements).values({ shopId: shop.id, commodityId: RICE, type: 'ADJUSTMENT', reason: 'DAMAGE', quantity: -85 });
    expect(await alerts()).toBe(2);
  });
});

describe('FR-9 — complaints', () => {
  it('routes to the district official, logs history, enforces transitions and resolution notes', async () => {
    const [patna] = await db.select().from(s.districts).where(eq(s.districts.code, 'PAT'));
    const [u] = await db.insert(s.users).values({ role: 'OFFICIAL', fullName: 'DSO Patna', email: 'dso@test.local', passwordHash: 'x' }).returning();
    const [official] = await db.insert(s.officials).values({ userId: u!.id, name: 'DSO Patna', designation: 'DSO', districtId: patna!.id }).returning();

    const dealer = await makeDealer(db);
    const shop = await makeShop(db, dealer.id);
    const ben = await makeBeneficiary(db, { shopId: shop.id });
    const [c] = await db.insert(s.complaints).values({ beneficiaryId: ben.id, shopId: shop.id, category: 'SHORT_WEIGHT', description: 'Less rice given' }).returning();
    expect(c!.ticketNo).toMatch(/^CMP-\d{4}-\d{6}$/);
    expect(c!.assignedOfficialId).toBe(official!.id);
    expect(c!.dealerId).toBe(dealer.id);

    expect(await ruleCode(db.update(s.complaints).set({ status: 'RESOLVED' }).where(eq(s.complaints.id, c!.id)))).toBe('INVALID_TRANSITION');
    await db.update(s.complaints).set({ status: 'RESOLVED', resolution: 'Shortfall issued after inspection' }).where(eq(s.complaints.id, c!.id));
    const [done] = await db.select().from(s.complaints).where(eq(s.complaints.id, c!.id));
    expect(done!.resolvedAt).not.toBeNull();
    const events = await db.select().from(s.complaintEvents).where(eq(s.complaintEvents.complaintId, c!.id));
    expect(events.map((e) => e.toStatus)).toEqual(['OPEN', 'RESOLVED']);
  });
});

describe('NFR-4 — audit log', () => {
  it('records who changed what, hides secrets, and cannot be altered', async () => {
    const dealer = await makeDealer(db);
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('srms.user_id', ${dealer.userId}, true), set_config('srms.role', 'ADMIN', true)`);
      await tx.update(s.dealers).set({ status: 'SUSPENDED' }).where(eq(s.dealers.id, dealer.id));
    });
    const [log] = await db
      .select()
      .from(s.auditLogs)
      .where(and(eq(s.auditLogs.entity, 'dealers'), eq(s.auditLogs.entityId, dealer.id), eq(s.auditLogs.action, 'UPDATE')));
    expect(log!.userId).toBe(dealer.userId);
    expect(log!.role).toBe('ADMIN');
    expect(log!.changeSummary).toEqual({ status: { from: 'ACTIVE', to: 'SUSPENDED' } });

    const benLogs = await db.execute<{ c: string }>(sql`select change_summary::text as c from audit_logs where entity = 'beneficiaries' limit 20`);
    for (const r of benLogs.rows) expect(r.c).not.toMatch(/aadhaar_(enc|hash)/);

    expect(await ruleCode(db.update(s.auditLogs).set({ action: 'X' }).where(eq(s.auditLogs.id, log!.id)))).toBe('IMMUTABLE_RECORD');
    expect(await ruleCode(db.delete(s.auditLogs).where(eq(s.auditLogs.id, log!.id)))).toBe('IMMUTABLE_RECORD');
  });
});
