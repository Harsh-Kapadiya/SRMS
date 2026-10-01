import { createHash } from 'node:crypto';
import express, { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { aadhaarVerifications, attachments, beneficiaries, complaints, shops, withActor } from '@srms/database';
import { RULES, aadhaarVerifySchema, complaintCreateSchema, istMonthKey, monthSchema, pageSchema, updateProfileSchema } from '@srms/shared';
import { z } from 'zod';
import { db, iso, num } from '../db';
import { HttpError, actor, me, notFound, pageOf, parse, requireRole } from '../http';
import { checkOtp, sendOtp } from '../otp';
import { profileFor } from '../profile';
import { entitlement, listDistributions, receipt, shopStock } from '../ration';

/** Beneficiary app: FR-1, FR-2, FR-3 (history/receipts), FR-7 (notifications), FR-9. */
export const beneficiaryRouter = Router();
beneficiaryRouter.use(requireRole('BENEFICIARY'));

const myBeneficiary = async (req: express.Request) => {
  const [b] = await db.select().from(beneficiaries).where(eq(beneficiaries.id, me(req).beneficiaryId!));
  if (!b) throw notFound('Beneficiary');
  return b;
};

beneficiaryRouter.patch('/', async (req, res) => {
  const body = parse(updateProfileSchema, req.body);
  const b = await myBeneficiary(req);
  if (body.homeShopId) {
    const [shop] = await db.select().from(shops).where(eq(shops.id, body.homeShopId));
    if (!shop || shop.status !== 'ACTIVE' || shop.districtId !== b.districtId) {
      throw new HttpError(422, 'Choose an active ration shop in your district', 'SHOP_DISTRICT_MISMATCH');
    }
  }
  await withActor(db, actor(req), (tx) => tx.update(beneficiaries).set(body).where(eq(beneficiaries.id, b.id)));
  res.json({ user: await profileFor(me(req).id) });
});

// ─── FR-2 Aadhaar authentication (mock UIDAI) ─────────────────────────────────

beneficiaryRouter.post('/aadhaar/otp', async (req, res) => {
  const b = await myBeneficiary(req);
  if (b.verificationStatus === 'VERIFIED') throw new HttpError(409, 'Aadhaar is already verified', 'ALREADY_VERIFIED');
  const sent = await sendOtp('AADHAAR_VERIFY', b.id, b.mobile);
  res.json({ sent: true, sentTo: `******${b.mobile.slice(-4)}`, ...sent });
});

beneficiaryRouter.post('/aadhaar/verify', async (req, res) => {
  const { otp } = parse(aadhaarVerifySchema, req.body);
  const b = await myBeneficiary(req);
  if (b.verificationStatus === 'VERIFIED') throw new HttpError(409, 'Aadhaar is already verified', 'ALREADY_VERIFIED');
  let challengeId: string;
  try {
    challengeId = await checkOtp('AADHAAR_VERIFY', b.id, otp);
  } catch (err) {
    await db.insert(aadhaarVerifications).values({
      beneficiaryId: b.id, method: 'OTP', purpose: 'AADHAAR_VERIFY', txnRef: 'MOCK-UIDAI', result: 'FAILURE',
      responseCode: '400', message: (err as Error).message.slice(0, 300),
    });
    throw err;
  }
  await withActor(db, actor(req), async (tx) => {
    await tx.insert(aadhaarVerifications).values({
      beneficiaryId: b.id, method: 'OTP', purpose: 'AADHAAR_VERIFY', txnRef: challengeId, result: 'SUCCESS', responseCode: '000', message: 'Authenticated (mock UIDAI)',
    });
    // Trigger: assigns ration card no., generates this month's quota, queues "approved" SMS.
    await tx.update(beneficiaries).set({ verificationStatus: 'VERIFIED' }).where(eq(beneficiaries.id, b.id));
  });
  res.json({ user: await profileFor(me(req).id) });
});

// ─── entitlement, history, receipts ──────────────────────────────────────────

beneficiaryRouter.get('/entitlement', async (req, res) => {
  const { month } = z.object({ month: monthSchema.default(istMonthKey()) }).parse(req.query);
  const b = await myBeneficiary(req);
  const lines = b.verificationStatus === 'VERIFIED' ? await entitlement(b.id, month) : [];
  // "Is my ration available at my shop?" — stock at the home shop (R7).
  const stock = b.homeShopId && month === istMonthKey() ? await shopStock(b.homeShopId) : [];
  res.json({
    month,
    verified: b.verificationStatus === 'VERIFIED',
    lines: lines.map((l) => ({ ...l, availableAtShop: (stock.find((s) => s.commodityId === l.commodityId)?.quantityAvailable ?? 0) >= l.remaining })),
  });
});

beneficiaryRouter.get('/distributions', async (req, res) => {
  const p = pageSchema.parse(req.query);
  const { limit, offset } = pageOf(p);
  res.json({ ...p, ...(await listDistributions(sql`d.beneficiary_id = ${me(req).beneficiaryId}`, limit, offset)) });
});

beneficiaryRouter.get('/distributions/:id', async (req, res) => {
  const r = await receipt(z.uuid().parse(req.params.id));
  if (r.beneficiary.id !== me(req).beneficiaryId) throw notFound('Receipt');
  res.json(r);
});

// ─── FR-7 notifications ──────────────────────────────────────────────────────

beneficiaryRouter.get('/notifications', async (req, res) => {
  const p = pageSchema.parse(req.query);
  const { limit, offset } = pageOf(p);
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select notification_id, event_type, message, delivery_status, created_at, read_at, count(*) over () as total
    from notifications
    where (beneficiary_id = ${me(req).beneficiaryId} or recipient_user_id = ${me(req).id}) and event_type <> 'OTP'
    order by created_at desc limit ${limit} offset ${offset}`);
  res.json({
    ...p,
    total: num(rows[0]?.total),
    unread: num((await db.execute<{ n: string }>(sql`
      select count(*) as n from notifications
      where (beneficiary_id = ${me(req).beneficiaryId} or recipient_user_id = ${me(req).id}) and event_type <> 'OTP' and read_at is null`)).rows[0]?.n),
    items: rows.map((r) => ({
      id: r.notification_id, event: r.event_type, message: r.message, deliveryStatus: r.delivery_status,
      createdAt: iso(r.created_at), readAt: iso(r.read_at),
    })),
  });
});

beneficiaryRouter.post('/notifications/read', async (req, res) => {
  await db.execute(sql`
    update notifications set read_at = now()
    where (beneficiary_id = ${me(req).beneficiaryId} or recipient_user_id = ${me(req).id}) and read_at is null`);
  res.json({ ok: true });
});

// ─── FR-9 complaints ─────────────────────────────────────────────────────────

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Evidence upload: raw body (image or PDF, ≤ 1 MB) → attachment id for the complaint. */
beneficiaryRouter.post('/attachments', express.raw({ type: ALLOWED_TYPES, limit: RULES.MAX_ATTACHMENT_BYTES }), async (req, res) => {
  const type = req.get('content-type')?.split(';')[0] ?? '';
  if (!ALLOWED_TYPES.includes(type) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new HttpError(415, 'Upload a JPEG, PNG, WebP image or a PDF', 'UNSUPPORTED_FILE');
  }
  const name = String(req.get('x-file-name') ?? 'evidence').replace(/[^\w.\- ]/g, '_').slice(0, 200);
  const [a] = await db
    .insert(attachments)
    .values({ uploadedById: me(req).id, fileName: name, mimeType: type, sizeBytes: req.body.length, sha256: createHash('sha256').update(req.body).digest('hex'), data: req.body })
    .returning({ id: attachments.id });
  res.status(201).json({ id: a!.id });
});

beneficiaryRouter.post('/complaints', async (req, res) => {
  const body = parse(complaintCreateSchema, req.body);
  const b = await myBeneficiary(req);
  if (body.attachmentId) {
    const [a] = await db.select({ by: attachments.uploadedById }).from(attachments).where(eq(attachments.id, body.attachmentId));
    if (a?.by !== me(req).id) throw notFound('Attachment');
  }
  const [c] = await withActor(db, actor(req), (tx) =>
    tx.insert(complaints).values({ ...body, shopId: body.shopId ?? b.homeShopId ?? undefined, beneficiaryId: b.id }).returning(),
  );
  res.status(201).json(await complaintDetail(c!.id));
});

beneficiaryRouter.get('/complaints', async (req, res) => {
  const rows = await db
    .select({
      id: complaints.id, ticketNo: complaints.ticketNo, category: complaints.category, status: complaints.status,
      description: complaints.description, createdAt: complaints.createdAt, resolvedAt: complaints.resolvedAt,
    })
    .from(complaints)
    .where(eq(complaints.beneficiaryId, me(req).beneficiaryId!))
    .orderBy(desc(complaints.createdAt));
  res.json(rows);
});

beneficiaryRouter.get('/complaints/:id', async (req, res) => {
  const c = await complaintDetail(z.uuid().parse(req.params.id));
  if (c.beneficiaryId !== me(req).beneficiaryId) throw notFound('Complaint');
  res.json(c);
});

/** Reopen a resolved/rejected complaint if the beneficiary is not satisfied. */
beneficiaryRouter.post('/complaints/:id/reopen', async (req, res) => {
  const { note } = z.object({ note: z.string().trim().min(5).max(2000) }).parse(req.body);
  const id = z.uuid().parse(req.params.id);
  const [c] = await db.select().from(complaints).where(and(eq(complaints.id, id), eq(complaints.beneficiaryId, me(req).beneficiaryId!)));
  if (!c) throw notFound('Complaint');
  await withActor(db, actor(req), async (tx) => {
    await tx.update(complaints).set({ status: 'OPEN' }).where(eq(complaints.id, id));
    await tx.execute(sql`insert into complaint_events (complaint_id, actor_user_id, from_status, to_status, note)
                         values (${id}, ${me(req).id}, 'OPEN', 'OPEN', ${'Reopened by beneficiary: ' + note})`);
  });
  res.json(await complaintDetail(id));
});

/** Complaint with its status history — shared with the official app. */
export async function complaintDetail(id: string) {
  const c = await db.query.complaints.findFirst({
    where: eq(complaints.id, id),
    with: {
      shop: { columns: { id: true, shopCode: true, name: true, districtId: true } },
      dealer: { columns: { id: true, name: true, licenseNo: true } },
      beneficiary: { columns: { id: true, name: true, rationCardNo: true, mobile: true, districtId: true } },
      assignedOfficial: { columns: { id: true, name: true, designation: true } },
      attachment: { columns: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
      events: { with: { actor: { columns: { fullName: true, role: true } } }, orderBy: (e, { asc }) => [asc(e.createdAt)] },
    },
  });
  if (!c) throw notFound('Complaint');
  return c;
}
