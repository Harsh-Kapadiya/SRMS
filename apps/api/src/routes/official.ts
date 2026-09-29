import { Router, type Request } from 'express';
import { eq, sql } from 'drizzle-orm';
import { attachments, beneficiaries, complaints, distributions, shops, stockMovements, withActor } from '@srms/db';
import {
  beneficiaryReviewSchema, complaintUpdateSchema, inspectionSchema, istMonthKey, maskAadhaar, monthSchema, pageSchema, voidSchema,
} from '@srms/shared';
import { z } from 'zod';
import { db, iso, num } from '../db';
import { HttpError, actor, audit, forbidden, me, notFound, pageOf, parse, requireRole } from '../http';
import { listDistributions, receipt, shopStock } from '../ration';
import { dashboard, monthlyReport, reportToXlsx } from '../reports';
import { complaintDetail } from './beneficiary';

/** Govt Official app: FR-6 dashboard, FR-8 reports, FR-9 complaint resolution, stock inspections. */
export const officialRouter = Router();
officialRouter.use(requireRole('OFFICIAL'));

/** District officers see only their district; state-level officers may pick one (or all). */
function districtScope(req: Request): number | null {
  const own = me(req).districtId;
  const asked = z.coerce.number().int().positive().optional().parse(req.query.districtId);
  if (own !== null) {
    if (asked !== undefined && asked !== own) throw forbidden('You can only view your own district');
    return own;
  }
  return asked ?? null;
}
const inScope = (districtId: number | null, col: ReturnType<typeof sql>) => (districtId === null ? sql`true` : sql`${col} = ${districtId}`);
function assertDistrict(req: Request, districtId: number | null | undefined) {
  const own = me(req).districtId;
  if (own !== null && districtId !== own) throw forbidden('This record is outside your district');
}

officialRouter.get('/dashboard', async (req, res) => {
  const { month } = z.object({ month: monthSchema.default(istMonthKey()) }).parse(req.query);
  res.json(await dashboard(month, districtScope(req)));
});

officialRouter.get('/reports/monthly', async (req, res) => {
  const { month, format } = z.object({ month: monthSchema.default(istMonthKey()), format: z.enum(['json', 'xlsx']).default('json') }).parse(req.query);
  const report = await monthlyReport(month, districtScope(req));
  await audit(req, 'EXPORT_REPORT', 'reports', month, { format, districtId: report.districtId });
  if (format === 'xlsx') {
    res.set('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('content-disposition', `attachment; filename="srms-report-${month.slice(0, 7)}.xlsx"`);
    res.send(await reportToXlsx(report));
    return;
  }
  res.json(report);
});

// ─── shops & stock ───────────────────────────────────────────────────────────

officialRouter.get('/shops', async (req, res) => {
  const d = districtScope(req);
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select s.shop_id, s.shop_code, s.shop_name, s.address, s.status, s.district_id, ds.name as district, dl.name as dealer, dl.mobile as dealer_mobile,
      (select count(*) from v_stock_status v where v.shop_id = s.shop_id and v.is_low) as low_stock,
      (select count(*) from beneficiaries b where b.home_shop_id = s.shop_id and b.verification_status = 'VERIFIED') as beneficiaries,
      (select count(*) from complaints c where c.shop_id = s.shop_id and c.status in ('OPEN', 'IN_PROGRESS')) as open_complaints
    from shops s join districts ds on ds.id = s.district_id left join dealers dl on dl.dealer_id = s.dealer_id
    where ${inScope(d, sql`s.district_id`)} order by ds.name, s.shop_code`);
  res.json(rows.map((r) => ({
    id: r.shop_id, shopCode: r.shop_code, name: r.shop_name, address: r.address, status: r.status, districtId: num(r.district_id), district: r.district,
    dealer: r.dealer, dealerMobile: r.dealer_mobile, lowStock: num(r.low_stock), beneficiaries: num(r.beneficiaries), openComplaints: num(r.open_complaints),
  })));
});

officialRouter.get('/shops/:id', async (req, res) => {
  const [shop] = await db.select().from(shops).where(eq(shops.id, z.uuid().parse(req.params.id)));
  if (!shop) throw notFound('Shop');
  assertDistrict(req, shop.districtId);
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select m.id, m.type, m.reason, m.quantity, m.balance_after, m.reference_no, m.note, m.occurred_at, c.commodity_name, c.unit, u.full_name as by
    from stock_movements m join commodities c using (commodity_id) left join users u on u.id = m.created_by_id
    where m.shop_id = ${shop.id} and m.type <> 'ISSUE' order by m.id desc limit 100`);
  res.json({
    shop,
    stock: await shopStock(shop.id),
    movements: rows.map((r) => ({
      id: num(r.id), type: r.type, reason: r.reason, quantity: num(r.quantity), balanceAfter: num(r.balance_after), referenceNo: r.reference_no,
      note: r.note, occurredAt: iso(r.occurred_at), commodity: r.commodity_name, unit: r.unit, by: r.by,
    })),
  });
});

/**
 * Physical stock verification. The difference between counted and ledger stock
 * becomes an INSPECTION_SHORTAGE / INSPECTION_EXCESS adjustment — this is what
 * the leakage KPI measures (R19).
 */
officialRouter.post('/inspections', async (req, res) => {
  const body = parse(inspectionSchema, req.body);
  const [shop] = await db.select().from(shops).where(eq(shops.id, body.shopId));
  if (!shop) throw notFound('Shop');
  assertDistrict(req, shop.districtId);
  const result = await withActor(db, actor(req), async (tx) => {
    const { rows } = await tx.execute<{ q: string }>(sql`
      select quantity_available as q from stock where shop_id = ${shop.id} and commodity_id = ${body.commodityId} for update`);
    const ledger = num(rows[0]?.q);
    const diff = Math.round((body.physicalQuantity - ledger) * 1000) / 1000;
    if (diff === 0) return { ledger, physical: body.physicalQuantity, difference: 0, adjustment: null };
    const [m] = await tx
      .insert(stockMovements)
      .values({
        shopId: shop.id, commodityId: body.commodityId, type: 'ADJUSTMENT',
        reason: diff < 0 ? 'INSPECTION_SHORTAGE' : 'INSPECTION_EXCESS', quantity: diff,
        referenceNo: `INSP/${shop.shopCode}/${new Date().toISOString().slice(0, 10)}`, note: body.note,
      })
      .returning();
    return { ledger, physical: body.physicalQuantity, difference: diff, adjustment: m };
  });
  res.status(201).json(result);
});

// ─── distributions ───────────────────────────────────────────────────────────

officialRouter.get('/distributions', async (req, res) => {
  const d = districtScope(req);
  const p = pageSchema.extend({ month: monthSchema.optional(), shopId: z.uuid().optional(), offline: z.stringbool().optional() }).parse(req.query);
  const { limit, offset } = pageOf(p);
  const where = sql.join(
    [
      inScope(d, sql`s.district_id`),
      p.shopId ? sql`d.shop_id = ${p.shopId}` : sql`true`,
      p.month ? sql`srms_month(d.issue_date) = ${p.month}::date` : sql`true`,
      p.offline ? sql`d.auth_method = 'OFFLINE'` : sql`true`,
    ],
    sql` and `,
  );
  res.json({ ...p, ...(await listDistributions(where, limit, offset)) });
});

officialRouter.get('/distributions/:id', async (req, res) => {
  const r = await receipt(z.uuid().parse(req.params.id));
  const [shop] = await db.select({ districtId: shops.districtId }).from(shops).where(eq(shops.id, r.shop.id));
  assertDistrict(req, shop?.districtId);
  res.json(r);
});

/** Void a wrong transaction: quota and stock are returned through the ledger (DB trigger). */
officialRouter.post('/distributions/:id/void', async (req, res) => {
  const { reason } = parse(voidSchema, req.body);
  const id = z.uuid().parse(req.params.id);
  const r = await receipt(id);
  const [shop] = await db.select({ districtId: shops.districtId }).from(shops).where(eq(shops.id, r.shop.id));
  assertDistrict(req, shop?.districtId);
  await withActor(db, actor(req), (tx) => tx.update(distributions).set({ status: 'VOIDED' }).where(eq(distributions.id, id)));
  await audit(req, 'VOID', 'distributions', id, { reason, receiptNo: r.receiptNo });
  res.json(await receipt(id));
});

// ─── beneficiaries ───────────────────────────────────────────────────────────

officialRouter.get('/beneficiaries', async (req, res) => {
  const d = districtScope(req);
  const p = pageSchema
    .extend({ status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional(), q: z.string().trim().max(60).optional(), shopId: z.uuid().optional() })
    .parse(req.query);
  const { limit, offset } = pageOf(p);
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select b.beneficiary_id, b.registration_no, b.ration_card_no, b.name, b.mobile, b.aadhaar_last4, b.card_type, b.verification_status,
           b.status, b.registration_date, ds.name as district, s.shop_code, s.shop_name,
           (select count(*) from family_members f where f.beneficiary_id = b.beneficiary_id) as family_size,
           count(*) over () as total
    from beneficiaries b join districts ds on ds.id = b.district_id left join shops s on s.shop_id = b.home_shop_id
    where ${inScope(d, sql`b.district_id`)}
      and ${p.status ? sql`b.verification_status = ${p.status}` : sql`true`}
      and ${p.shopId ? sql`b.home_shop_id = ${p.shopId}` : sql`true`}
      and ${p.q ? sql`(b.name ilike ${'%' + p.q + '%'} or b.ration_card_no = ${p.q} or b.registration_no = ${p.q.toUpperCase()} or b.mobile = ${p.q})` : sql`true`}
    order by b.registration_date desc limit ${limit} offset ${offset}`);
  res.json({
    ...p,
    total: num(rows[0]?.total),
    items: rows.map((r) => ({
      id: r.beneficiary_id, registrationNo: r.registration_no, rationCardNo: r.ration_card_no, name: r.name,
      mobileMasked: `******${String(r.mobile).slice(-4)}`, aadhaarMasked: maskAadhaar(String(r.aadhaar_last4)), cardType: r.card_type,
      verificationStatus: r.verification_status, status: r.status, registeredAt: iso(r.registration_date), district: r.district,
      shopCode: r.shop_code, shopName: r.shop_name, familySize: Math.max(1, num(r.family_size)),
    })),
  });
});

officialRouter.patch('/beneficiaries/:id', async (req, res) => {
  const body = parse(beneficiaryReviewSchema, req.body);
  const id = z.uuid().parse(req.params.id);
  const [b] = await db.select().from(beneficiaries).where(eq(beneficiaries.id, id));
  if (!b) throw notFound('Beneficiary');
  assertDistrict(req, b.districtId);
  if (body.homeShopId) {
    const [shop] = await db.select().from(shops).where(eq(shops.id, body.homeShopId));
    if (!shop || shop.districtId !== b.districtId) throw new HttpError(422, 'Shop must be in the beneficiary’s district', 'SHOP_DISTRICT_MISMATCH');
  }
  await withActor(db, actor(req), async (tx) => {
    await tx.update(beneficiaries).set(body).where(eq(beneficiaries.id, id));
    if (body.status) await tx.execute(sql`update users set status = ${body.status} where id = ${b.userId}`);
  });
  res.json({ ok: true });
});

// ─── complaints (FR-9) ───────────────────────────────────────────────────────

officialRouter.get('/complaints', async (req, res) => {
  const d = districtScope(req);
  const p = pageSchema
    .extend({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']).optional(), mine: z.stringbool().optional() })
    .parse(req.query);
  const { limit, offset } = pageOf(p);
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select c.complaint_id, c.ticket_no, c.category, c.status, c.description, c.created_at, c.resolved_at,
           b.name as beneficiary, s.shop_code, s.shop_name, o.name as assigned_to, (c.attachment_id is not null) as has_attachment,
           count(*) over () as total
    from complaints c join beneficiaries b using (beneficiary_id)
    left join shops s on s.shop_id = c.shop_id left join officials o on o.official_id = c.assigned_official_id
    where ${inScope(d, sql`coalesce(s.district_id, b.district_id)`)}
      and ${p.status ? sql`c.status = ${p.status}` : sql`true`}
      and ${p.mine ? sql`c.assigned_official_id = ${me(req).officialId}` : sql`true`}
    order by (c.status in ('OPEN', 'IN_PROGRESS')) desc, c.created_at desc limit ${limit} offset ${offset}`);
  res.json({
    ...p,
    total: num(rows[0]?.total),
    items: rows.map((r) => ({
      id: r.complaint_id, ticketNo: r.ticket_no, category: r.category, status: r.status, description: r.description,
      createdAt: iso(r.created_at), resolvedAt: iso(r.resolved_at), beneficiary: r.beneficiary, shopCode: r.shop_code, shopName: r.shop_name,
      assignedTo: r.assigned_to, hasAttachment: r.has_attachment,
    })),
  });
});

async function scopedComplaint(req: Request) {
  const c = await complaintDetail(z.uuid().parse(req.params.id));
  assertDistrict(req, c.shop?.districtId ?? c.beneficiary.districtId);
  return c;
}

officialRouter.get('/complaints/:id', async (req, res) => {
  const c = await scopedComplaint(req);
  res.json({ ...c, beneficiary: { ...c.beneficiary, mobile: `******${c.beneficiary.mobile.slice(-4)}` } });
});

officialRouter.get('/complaints/:id/attachment', async (req, res) => {
  const c = await scopedComplaint(req);
  if (!c.attachment) throw notFound('Attachment');
  const [a] = await db.select().from(attachments).where(eq(attachments.id, c.attachment.id));
  res.set('content-type', a!.mimeType);
  res.set('content-disposition', `inline; filename="${a!.fileName}"`);
  res.set('x-content-type-options', 'nosniff');
  res.send(a!.data);
});

/** Move a complaint through OPEN → IN_PROGRESS → RESOLVED / REJECTED, optionally with a note. */
officialRouter.patch('/complaints/:id', async (req, res) => {
  const body = parse(complaintUpdateSchema, req.body);
  const c = await scopedComplaint(req);
  if (!body.status && !body.note) throw new HttpError(422, 'Nothing to update', 'VALIDATION');
  await withActor(db, actor(req), async (tx) => {
    if (body.status && body.status !== c.status) {
      await tx
        .update(complaints)
        .set({ status: body.status, resolution: body.resolution ?? c.resolution, assignedOfficialId: c.assignedOfficialId ?? me(req).officialId })
        .where(eq(complaints.id, c.id));
    }
    if (body.note) {
      const status = body.status ?? c.status;
      await tx.execute(sql`insert into complaint_events (complaint_id, actor_user_id, from_status, to_status, note)
                           values (${c.id}, ${me(req).id}, ${status}, ${status}, ${body.note})`);
    }
  });
  res.json(await complaintDetail(c.id));
});

officialRouter.get('/notifications', async (req, res) => {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select notification_id, event_type, message, payload, created_at, read_at from notifications
    where recipient_user_id = ${me(req).id} order by created_at desc limit 50`);
  res.json(rows.map((r) => ({ id: r.notification_id, event: r.event_type, message: r.message, payload: r.payload, createdAt: iso(r.created_at), readAt: iso(r.read_at) })));
});
