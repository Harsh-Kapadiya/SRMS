import { Router, type Request } from 'express';
import { eq, or, sql } from 'drizzle-orm';
import { beneficiaries, shops, stockMovements, withActor } from '@srms/db';
import { distributionCreateSchema, istMonthKey, maskAadhaar, pageSchema, stockReceiptSchema } from '@srms/shared';
import { z } from 'zod';
import { db, iso, num } from '../db';
import { HttpError, actor, forbidden, me, notFound, pageOf, parse, requireRole } from '../http';
import { checkOtp, sendOtp } from '../otp';
import { entitlement, issueRation, listDistributions, receipt, shopStock } from '../ration';

/** Dealer app: FR-3 ration distribution, FR-4 stock, R5 low-stock alerts, R7 ration-ready SMS, NFR-2 offline sync. */
export const dealerRouter = Router();
dealerRouter.use(requireRole('DEALER'));

/** R16: a dealer can only act on shops assigned to them. */
async function ownShop(req: Request, shopId: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.id, z.uuid().parse(shopId)));
  if (!shop || shop.dealerId !== me(req).dealerId) throw forbidden('This shop is not assigned to you');
  return shop;
}

async function requirePosOtp(): Promise<boolean> {
  const { rows } = await db.execute<{ v: boolean }>(
    sql`select coalesce((select (value #>> '{}')::boolean from settings where key = 'require_pos_otp'), true) as v`,
  );
  return rows[0]!.v;
}

dealerRouter.get('/shops', async (req, res) => {
  const rows = await db.select().from(shops).where(eq(shops.dealerId, me(req).dealerId!));
  const month = istMonthKey();
  const out = [];
  for (const s of rows) {
    const { rows: stats } = await db.execute<{ today: string; month_txns: string; served: string; home: string }>(sql`
      select
        (select count(*) from distributions where shop_id = ${s.id} and status = 'COMPLETED'
           and (issue_date at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date) as today,
        (select count(*) from distributions where shop_id = ${s.id} and status = 'COMPLETED' and srms_month(issue_date) = ${month}::date) as month_txns,
        (select count(distinct beneficiary_id) from distributions where shop_id = ${s.id} and status = 'COMPLETED' and srms_month(issue_date) = ${month}::date) as served,
        (select count(*) from beneficiaries where home_shop_id = ${s.id} and verification_status = 'VERIFIED' and status = 'ACTIVE') as home`);
    const st = stats[0]!;
    out.push({
      ...s,
      stock: await shopStock(s.id),
      stats: { today: num(st.today), monthTransactions: num(st.month_txns), servedThisMonth: num(st.served), homeBeneficiaries: num(st.home) },
    });
  }
  res.json(out);
});

dealerRouter.get('/shops/:id/stock', async (req, res) => {
  const shop = await ownShop(req, req.params.id as string);
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select m.id, m.type, m.reason, m.quantity, m.balance_after, m.reference_no, m.note, m.occurred_at, c.commodity_name, c.unit
    from stock_movements m join commodities c using (commodity_id)
    where m.shop_id = ${shop.id} order by m.id desc limit 50`);
  res.json({
    stock: await shopStock(shop.id),
    movements: rows.map((r) => ({
      id: num(r.id), type: r.type, reason: r.reason, quantity: num(r.quantity), balanceAfter: num(r.balance_after),
      referenceNo: r.reference_no, note: r.note, occurredAt: iso(r.occurred_at), commodity: r.commodity_name, unit: r.unit,
    })),
  });
});

/**
 * Home beneficiaries with this month's remaining quota — the dealer app caches
 * this so ration can still be recorded when the shop is offline (NFR-2).
 */
dealerRouter.get('/shops/:id/roster', async (req, res) => {
  const shop = await ownShop(req, req.params.id as string);
  const month = istMonthKey();
  await db.execute(sql`select srms_generate_quotas(${month}::date)`);
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select b.beneficiary_id, b.name, b.ration_card_no, b.card_type, b.mobile, b.aadhaar_last4,
           coalesce(json_agg(json_build_object('commodityId', q.commodity_id, 'allocated', q.allocated_qty, 'remaining', q.remaining_qty))
                    filter (where q.quota_id is not null), '[]') as quota
    from beneficiaries b
    left join beneficiary_quotas q on q.beneficiary_id = b.beneficiary_id and q.quota_month = ${month}::date
    where b.home_shop_id = ${shop.id} and b.verification_status = 'VERIFIED' and b.status = 'ACTIVE'
    group by b.beneficiary_id order by b.name`);
  res.json({
    month,
    generatedAt: new Date().toISOString(),
    beneficiaries: rows.map((r) => ({
      id: r.beneficiary_id, name: r.name, rationCardNo: r.ration_card_no, cardType: r.card_type,
      mobileMasked: `******${String(r.mobile).slice(-4)}`, aadhaarMasked: maskAadhaar(String(r.aadhaar_last4)),
      quota: (r.quota as { commodityId: number; allocated: string; remaining: string }[]).map((q) => ({ commodityId: q.commodityId, allocated: num(q.allocated), remaining: num(q.remaining) })),
    })),
  });
});

/**
 * 2.1 + 2.2 + 2.3 in one call: who is this, are they eligible, what is left of
 * their quota, and can this shop cover it? Search by ration card no.,
 * registration no. or mobile.
 */
dealerRouter.get('/lookup', async (req, res) => {
  const { shopId, q } = z.object({ shopId: z.uuid(), q: z.string().trim().min(4).max(20) }).parse(req.query);
  const shop = await ownShop(req, shopId);
  const [b] = await db
    .select()
    .from(beneficiaries)
    .where(or(eq(beneficiaries.rationCardNo, q), eq(beneficiaries.registrationNo, q.toUpperCase()), eq(beneficiaries.mobile, q)))
    .limit(1);
  if (!b) throw notFound('Beneficiary');

  const eligible = b.verificationStatus === 'VERIFIED' && b.status === 'ACTIVE';
  const lines = eligible ? await entitlement(b.id) : [];
  const stock = await shopStock(shop.id);
  const family = await db.execute<{ n: string }>(sql`select count(*) as n from family_members where beneficiary_id = ${b.id}`);
  res.json({
    beneficiary: {
      id: b.id, name: b.name, rationCardNo: b.rationCardNo, registrationNo: b.registrationNo, cardType: b.cardType,
      aadhaarMasked: maskAadhaar(b.aadhaarLast4), mobileMasked: `******${b.mobile.slice(-4)}`,
      familySize: Math.max(1, num(family.rows[0]?.n)), homeShopId: b.homeShopId, portability: b.homeShopId !== shop.id,
    },
    eligible,
    reason: eligible ? null : b.verificationStatus !== 'VERIFIED' ? `Aadhaar verification is ${b.verificationStatus.toLowerCase()}` : `Account is ${b.status.toLowerCase()}`,
    requireOtp: await requirePosOtp(),
    lines: lines.map((l) => {
      const inStock = stock.find((s) => s.commodityId === l.commodityId)?.quantityAvailable ?? 0;
      return { ...l, inStock, maxIssuable: Math.min(l.remaining, inStock) };
    }),
  });
});

/** Point-of-sale authentication: OTP to the beneficiary's registered mobile (mock UIDAI, SRS R2). */
dealerRouter.post('/auth-otp', async (req, res) => {
  const { shopId, beneficiaryId } = z.object({ shopId: z.uuid(), beneficiaryId: z.uuid() }).parse(req.body);
  await ownShop(req, shopId);
  const [b] = await db.select().from(beneficiaries).where(eq(beneficiaries.id, beneficiaryId));
  if (!b) throw notFound('Beneficiary');
  res.json({ sent: true, sentTo: `******${b.mobile.slice(-4)}`, ...(await sendOtp('DISTRIBUTION_AUTH', b.id, b.mobile)) });
});

/**
 * FR-3 issue ration. Online: needs the beneficiary's OTP. Offline (NFR-2): the
 * app queues the transaction with clientRef + capturedOfflineAt and replays it
 * here when back online; replays are idempotent and are re-validated against
 * quota and stock (a conflict comes back as 409 for the dealer to review).
 */
dealerRouter.post('/distributions', async (req, res) => {
  const body = parse(distributionCreateSchema, req.body);
  await ownShop(req, body.shopId);
  const offline = Boolean(body.capturedOfflineAt);
  if (offline && !body.clientRef) throw new HttpError(422, 'Offline transactions need a clientRef', 'VALIDATION');

  let authRef: string | undefined;
  if (!offline && (await requirePosOtp())) {
    if (!body.otp) throw new HttpError(422, 'Beneficiary OTP is required', 'OTP_REQUIRED');
    authRef = await checkOtp('DISTRIBUTION_AUTH', body.beneficiaryId, body.otp);
  }
  const capturedAt = body.capturedOfflineAt ? new Date(body.capturedOfflineAt) : undefined;
  const result = await issueRation(actor(req), {
    shopId: body.shopId,
    dealerId: me(req).dealerId!,
    beneficiaryId: body.beneficiaryId,
    items: body.items,
    authMethod: offline ? 'OFFLINE' : 'OTP',
    authRef,
    clientRef: body.clientRef,
    issuedAt: capturedAt,
    capturedOfflineAt: capturedAt,
  });
  if (authRef) {
    await db.execute(sql`
      insert into aadhaar_verifications (beneficiary_id, method, purpose, txn_ref, result, response_code, message)
      values (${body.beneficiaryId}, 'OTP', 'DISTRIBUTION_AUTH', ${authRef}, 'SUCCESS', '000', ${'Receipt ' + result.receiptNo})`);
  }
  res.status(result.duplicate ? 200 : 201).json(result);
});

dealerRouter.get('/distributions', async (req, res) => {
  const p = pageSchema.extend({ shopId: z.uuid().optional() }).parse(req.query);
  if (p.shopId) await ownShop(req, p.shopId);
  const { limit, offset } = pageOf(p);
  const where = p.shopId ? sql`d.shop_id = ${p.shopId}` : sql`d.dealer_id = ${me(req).dealerId}`;
  res.json({ ...p, ...(await listDistributions(where, limit, offset)) });
});

dealerRouter.get('/distributions/:id', async (req, res) => {
  const r = await receipt(z.uuid().parse(req.params.id));
  await ownShop(req, r.shop.id);
  res.json(r);
});

/** FR-4: record stock received from the godown (State Food Corporation challan). */
dealerRouter.post('/stock/receipts', async (req, res) => {
  const body = parse(stockReceiptSchema, req.body);
  await ownShop(req, body.shopId);
  if (body.clientRef) {
    const [dup] = await db.select().from(stockMovements).where(eq(stockMovements.clientRef, body.clientRef));
    if (dup) return void res.json({ id: dup.id, balanceAfter: dup.balanceAfter, duplicate: true });
  }
  const [m] = await withActor(db, actor(req), (tx) =>
    tx
      .insert(stockMovements)
      .values({
        shopId: body.shopId, commodityId: body.commodityId, type: 'RECEIPT', quantity: body.quantity,
        referenceNo: body.referenceNo, note: body.note, clientRef: body.clientRef,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
      })
      .returning(),
  );
  res.status(201).json({ id: m!.id, balanceAfter: m!.balanceAfter, stock: await shopStock(body.shopId) });
});

/** R7: tell home beneficiaries who haven't collected yet that ration has arrived. Once per month each. */
dealerRouter.post('/shops/:id/notify-ready', async (req, res) => {
  const shop = await ownShop(req, req.params.id as string);
  const month = istMonthKey();
  const { rowCount } = await db.execute(sql`
    insert into notifications (recipient_user_id, beneficiary_id, mobile, event_type, message, payload)
    select b.user_id, b.beneficiary_id, b.mobile, 'RATION_READY',
           ${`SRMS: Ration for this month has arrived at ${shop.name} (${shop.shopCode}). Please collect it with your ration card.`},
           jsonb_build_object('shopId', ${shop.id}::text, 'month', ${month}::text)
    from beneficiaries b
    where b.home_shop_id = ${shop.id} and b.verification_status = 'VERIFIED' and b.status = 'ACTIVE'
      and not exists (select 1 from distributions d where d.beneficiary_id = b.beneficiary_id
                      and d.status = 'COMPLETED' and srms_month(d.issue_date) = ${month}::date)
      and not exists (select 1 from notifications n where n.beneficiary_id = b.beneficiary_id
                      and n.event_type = 'RATION_READY' and n.payload ->> 'month' = ${month}::text)`);
  res.json({ notified: rowCount ?? 0 });
});

dealerRouter.get('/notifications', async (req, res) => {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select notification_id, event_type, message, payload, created_at, read_at
    from notifications where recipient_user_id = ${me(req).id} and event_type <> 'OTP'
    order by created_at desc limit 50`);
  res.json(rows.map((r) => ({ id: r.notification_id, event: r.event_type, message: r.message, payload: r.payload, createdAt: iso(r.created_at), readAt: iso(r.read_at) })));
});

dealerRouter.post('/notifications/read', async (req, res) => {
  await db.execute(sql`update notifications set read_at = now() where recipient_user_id = ${me(req).id} and read_at is null`);
  res.json({ ok: true });
});

