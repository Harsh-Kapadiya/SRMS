import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { asc, eq, sql } from 'drizzle-orm';
import {
  commodities, dealers, entitlementRules, hashPassword, officials, settings, shops, stock, users, withActor,
} from '@srms/db';
import {
  commoditySchema, dealerCreateSchema, dealerUpdateSchema, entitlementSchema, istMonthKey, monthSchema, officialCreateSchema,
  officialUpdateSchema, pageSchema, settingsUpdateSchema, shopCreateSchema, shopQuotasSchema, shopUpdateSchema, userStatusSchema,
} from '@srms/shared';
import { z } from 'zod';
import { db, iso, num } from '../db';
import { HttpError, actor, audit, me, notFound, pageOf, parse, requireRole } from '../http';

/** System Admin app: FR-5 dealer & shop management, users, configuration, audit (NFR-4). */
export const adminRouter = Router();
adminRouter.use(requireRole('ADMIN'));

/** One-time password shown to the admin once, to hand over to the new staff member. */
const tempPassword = () => `Srms-${randomBytes(6).toString('base64url')}9a`;
const idParam = (v: unknown) => z.uuid().parse(v);

adminRouter.get('/overview', async (_req, res) => {
  const { rows } = await db.execute<Record<string, string>>(sql`
    select
      (select count(*) from dealers where status = 'ACTIVE') as dealers,
      (select count(*) from shops where status = 'ACTIVE') as shops,
      (select count(*) from shops where dealer_id is null or status <> 'ACTIVE') as shops_unassigned,
      (select count(*) from officials) as officials,
      (select count(*) from beneficiaries where verification_status = 'VERIFIED') as beneficiaries,
      (select count(*) from beneficiaries where verification_status = 'PENDING') as pending,
      (select count(*) from notifications where delivery_status = 'QUEUED') as sms_queued,
      (select count(*) from notifications where delivery_status = 'FAILED' and created_at > now() - interval '7 days') as sms_failed,
      (select count(*) from audit_logs where timestamp > now() - interval '24 hours') as audit_24h,
      (select count(*) from audit_logs where action = 'LOGIN_FAILED' and timestamp > now() - interval '24 hours') as failed_logins_24h`);
  const r = rows[0]!;
  res.json(Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()), num(v)])));
});

// ─── dealers (FR-5) ──────────────────────────────────────────────────────────

adminRouter.get('/dealers', async (_req, res) => {
  const rows = await db.query.dealers.findMany({
    with: { district: true, user: { columns: { email: true, status: true, lastLoginAt: true } }, shops: { columns: { id: true, shopCode: true, name: true, status: true } } },
    orderBy: (d, { asc: a }) => [a(d.name)],
  });
  res.json(rows);
});

adminRouter.post('/dealers', async (req, res) => {
  const body = parse(dealerCreateSchema, req.body);
  const password = tempPassword();
  const dealer = await withActor(db, actor(req), async (tx) => {
    const [u] = await tx.insert(users).values({ role: 'DEALER', fullName: body.name, email: body.email, mobile: body.mobile, passwordHash: await hashPassword(password) }).returning();
    const [d] = await tx
      .insert(dealers)
      .values({ userId: u!.id, name: body.name, licenseNo: body.licenseNo, licenseValidUntil: body.licenseValidUntil, mobile: body.mobile, districtId: body.districtId, address: body.address })
      .returning();
    return d!;
  });
  res.status(201).json({ dealer, login: { email: body.email, temporaryPassword: password } });
});

adminRouter.patch('/dealers/:id', async (req, res) => {
  const body = parse(dealerUpdateSchema, req.body);
  const id = idParam(req.params.id);
  const [d] = await db.select().from(dealers).where(eq(dealers.id, id));
  if (!d) throw notFound('Dealer');
  await withActor(db, actor(req), async (tx) => {
    await tx.update(dealers).set(body).where(eq(dealers.id, id));
    const userPatch = { ...(body.name ? { fullName: body.name } : {}), ...(body.mobile ? { mobile: body.mobile } : {}), ...(body.status ? { status: body.status } : {}) };
    if (Object.keys(userPatch).length) await tx.update(users).set(userPatch).where(eq(users.id, d.userId));
    if (body.status && body.status !== 'ACTIVE') await tx.execute(sql`delete from sessions where user_id = ${d.userId}`);
  });
  res.json(await db.query.dealers.findFirst({ where: eq(dealers.id, id), with: { district: true, shops: true } }));
});

// ─── officials ───────────────────────────────────────────────────────────────

adminRouter.get('/officials', async (_req, res) => {
  res.json(
    await db.query.officials.findMany({
      with: { district: true, user: { columns: { email: true, status: true, lastLoginAt: true } } },
      orderBy: (o, { asc: a }) => [a(o.name)],
    }),
  );
});

adminRouter.post('/officials', async (req, res) => {
  const body = parse(officialCreateSchema, req.body);
  const password = tempPassword();
  const official = await withActor(db, actor(req), async (tx) => {
    const [u] = await tx.insert(users).values({ role: 'OFFICIAL', fullName: body.name, email: body.email, mobile: body.mobile, passwordHash: await hashPassword(password) }).returning();
    const [o] = await tx.insert(officials).values({ userId: u!.id, name: body.name, designation: body.designation, districtId: body.districtId, mobile: body.mobile }).returning();
    return o!;
  });
  res.status(201).json({ official, login: { email: body.email, temporaryPassword: password } });
});

adminRouter.patch('/officials/:id', async (req, res) => {
  const body = parse(officialUpdateSchema, req.body);
  const id = idParam(req.params.id);
  const [o] = await db.select().from(officials).where(eq(officials.id, id));
  if (!o) throw notFound('Official');
  await withActor(db, actor(req), async (tx) => {
    await tx.update(officials).set(body).where(eq(officials.id, id));
    if (body.name || body.mobile) await tx.update(users).set({ ...(body.name ? { fullName: body.name } : {}), ...(body.mobile ? { mobile: body.mobile } : {}) }).where(eq(users.id, o.userId));
  });
  res.json(await db.query.officials.findFirst({ where: eq(officials.id, id), with: { district: true } }));
});

// ─── shops & monthly allocation ──────────────────────────────────────────────

adminRouter.get('/shops', async (_req, res) => {
  res.json(
    await db.query.shops.findMany({
      with: { district: true, dealer: { columns: { id: true, name: true, licenseNo: true, status: true } }, stock: { with: { commodity: { columns: { code: true, name: true, unit: true } } } } },
      orderBy: (s, { asc: a }) => [a(s.shopCode)],
    }),
  );
});

// Dealer limit (max 3, same district) is enforced by the database trigger → 409/422 with a clear message.
adminRouter.post('/shops', async (req, res) => {
  const body = parse(shopCreateSchema, req.body);
  const [s] = await withActor(db, actor(req), (tx) => tx.insert(shops).values(body).returning());
  res.status(201).json(s);
});

adminRouter.patch('/shops/:id', async (req, res) => {
  const body = parse(shopUpdateSchema, req.body);
  const id = idParam(req.params.id);
  const [s] = await withActor(db, actor(req), (tx) => tx.update(shops).set(body).where(eq(shops.id, id)).returning());
  if (!s) throw notFound('Shop');
  res.json(s);
});

/** Monthly allocation per commodity (drives the 20% low-stock threshold). */
adminRouter.put('/shops/:id/quotas', async (req, res) => {
  const { items } = parse(shopQuotasSchema, req.body);
  const shopId = idParam(req.params.id);
  await withActor(db, actor(req), async (tx) => {
    for (const it of items) {
      await tx
        .insert(stock)
        .values({ shopId, commodityId: it.commodityId, monthlyQuota: it.monthlyQuota })
        .onConflictDoUpdate({ target: [stock.shopId, stock.commodityId], set: { monthlyQuota: it.monthlyQuota } });
    }
  });
  res.json(await db.query.stock.findMany({ where: eq(stock.shopId, shopId), with: { commodity: true } }));
});

// ─── commodities & entitlements ──────────────────────────────────────────────

adminRouter.get('/commodities', async (_req, res) => {
  res.json(await db.select().from(commodities).orderBy(asc(commodities.sortOrder)));
});

adminRouter.post('/commodities', async (req, res) => {
  const body = parse(commoditySchema, req.body);
  const [c] = await withActor(db, actor(req), (tx) => tx.insert(commodities).values(body).returning());
  res.status(201).json(c);
});

adminRouter.patch('/commodities/:id', async (req, res) => {
  const body = parse(commoditySchema.omit({ code: true }).partial(), req.body);
  const id = z.coerce.number().int().parse(req.params.id);
  const [c] = await withActor(db, actor(req), (tx) => tx.update(commodities).set(body).where(eq(commodities.id, id)).returning());
  if (!c) throw notFound('Commodity');
  res.json(c);
});

adminRouter.get('/entitlements', async (_req, res) => {
  res.json(await db.query.entitlementRules.findMany({ with: { commodity: true } }));
});

/** Takes effect for quotas generated from now on (existing months are not rewritten). */
adminRouter.put('/entitlements', async (req, res) => {
  const { rules } = parse(entitlementSchema, req.body);
  await withActor(db, actor(req), async (tx) => {
    for (const r of rules) {
      await tx
        .insert(entitlementRules)
        .values(r)
        .onConflictDoUpdate({ target: [entitlementRules.commodityId, entitlementRules.cardType], set: { qtyPerMember: r.qtyPerMember, qtyPerFamily: r.qtyPerFamily, isActive: r.isActive } });
    }
  });
  res.json(await db.query.entitlementRules.findMany({ with: { commodity: true } }));
});

adminRouter.post('/quotas/generate', async (req, res) => {
  const { month } = z.object({ month: monthSchema.default(istMonthKey()) }).parse(req.body ?? {});
  const { rows } = await db.execute<{ n: number }>(sql`select srms_generate_quotas(${month}::date) as n`);
  await audit(req, 'GENERATE_QUOTAS', 'beneficiary_quotas', month, { created: rows[0]!.n });
  res.json({ month, created: rows[0]!.n });
});

// ─── settings ────────────────────────────────────────────────────────────────

adminRouter.get('/settings', async (_req, res) => {
  res.json(await db.select().from(settings).orderBy(asc(settings.key)));
});

adminRouter.patch('/settings', async (req, res) => {
  const body = parse(settingsUpdateSchema, req.body);
  await withActor(db, actor(req), async (tx) => {
    for (const [key, value] of Object.entries(body)) {
      await tx.update(settings).set({ value, updatedById: me(req).id }).where(eq(settings.key, key));
    }
  });
  res.json(await db.select().from(settings).orderBy(asc(settings.key)));
});

// ─── users ───────────────────────────────────────────────────────────────────

adminRouter.get('/users', async (req, res) => {
  const p = pageSchema.extend({ role: z.enum(['BENEFICIARY', 'DEALER', 'OFFICIAL', 'ADMIN']).optional(), q: z.string().trim().max(60).optional() }).parse(req.query);
  const { limit, offset } = pageOf(p);
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select id, role, full_name, email, mobile, status, last_login_at, created_at, count(*) over () as total
    from users
    where ${p.role ? sql`role = ${p.role}` : sql`true`}
      and ${p.q ? sql`(full_name ilike ${'%' + p.q + '%'} or email ilike ${'%' + p.q + '%'} or mobile = ${p.q})` : sql`true`}
    order by created_at desc limit ${limit} offset ${offset}`);
  res.json({
    ...p,
    total: num(rows[0]?.total),
    items: rows.map((r) => ({
      id: r.id, role: r.role, fullName: r.full_name, email: r.email, mobile: r.mobile, status: r.status,
      lastLoginAt: iso(r.last_login_at), createdAt: iso(r.created_at),
    })),
  });
});

adminRouter.patch('/users/:id/status', async (req, res) => {
  const { status } = parse(userStatusSchema, req.body);
  const id = idParam(req.params.id);
  if (id === me(req).id) throw new HttpError(422, 'You cannot change your own status', 'SELF');
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw notFound('User');
  await withActor(db, actor(req), async (tx) => {
    await tx.update(users).set({ status }).where(eq(users.id, id));
    if (u.role === 'DEALER') await tx.update(dealers).set({ status }).where(eq(dealers.userId, id));
    if (u.role === 'BENEFICIARY') await tx.execute(sql`update beneficiaries set status = ${status} where user_id = ${id}`);
    if (status !== 'ACTIVE') await tx.execute(sql`delete from sessions where user_id = ${id}`);
  });
  res.json({ ok: true });
});

adminRouter.post('/users/:id/reset-password', async (req, res) => {
  const id = idParam(req.params.id);
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u || u.role === 'BENEFICIARY') throw notFound('Staff user');
  const password = tempPassword();
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, id));
  await db.execute(sql`delete from sessions where user_id = ${id}`);
  await audit(req, 'PASSWORD_RESET', 'users', id);
  res.json({ email: u.email, temporaryPassword: password });
});

// ─── audit & SMS delivery ────────────────────────────────────────────────────

adminRouter.get('/audit-logs', async (req, res) => {
  const p = pageSchema
    .extend({ entity: z.string().max(60).optional(), action: z.string().max(40).optional(), userId: z.uuid().optional(), entityId: z.string().max(64).optional() })
    .parse(req.query);
  const { limit, offset } = pageOf(p);
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select a.log_id, a.user_id, a.role, a.action, a.entity, a.entity_id, a.change_summary, a.ip, a.timestamp, u.full_name,
           count(*) over () as total
    from audit_logs a left join users u on u.id = a.user_id
    where ${p.entity ? sql`a.entity = ${p.entity}` : sql`true`}
      and ${p.action ? sql`a.action = ${p.action}` : sql`true`}
      and ${p.userId ? sql`a.user_id = ${p.userId}` : sql`true`}
      and ${p.entityId ? sql`a.entity_id = ${p.entityId}` : sql`true`}
    order by a.log_id desc limit ${limit} offset ${offset}`);
  res.json({
    ...p,
    total: num(rows[0]?.total),
    items: rows.map((r) => ({
      id: num(r.log_id), userId: r.user_id, userName: r.full_name ?? 'System', role: r.role, action: r.action, entity: r.entity,
      entityId: r.entity_id, changes: r.change_summary, ip: r.ip, at: iso(r.timestamp),
    })),
  });
});

adminRouter.get('/notifications', async (req, res) => {
  const p = pageSchema.extend({ status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'FAILED']).optional() }).parse(req.query);
  const { limit, offset } = pageOf(p);
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select notification_id, event_type, channel, mobile, message, delivery_status, provider, attempts, last_error, created_at, sent_at,
           count(*) over () as total
    from notifications where ${p.status ? sql`delivery_status = ${p.status}` : sql`true`}
    order by created_at desc limit ${limit} offset ${offset}`);
  res.json({
    ...p,
    total: num(rows[0]?.total),
    items: rows.map((r) => ({
      id: r.notification_id, event: r.event_type, channel: r.channel, mobile: r.mobile ? `******${String(r.mobile).slice(-4)}` : null,
      message: r.message, status: r.delivery_status, provider: r.provider, attempts: num(r.attempts), lastError: r.last_error,
      createdAt: iso(r.created_at), sentAt: iso(r.sent_at),
    })),
  });
});

/** Retry failed SMS (e.g. after fixing gateway credentials). */
adminRouter.post('/notifications/retry', async (req, res) => {
  const { rowCount } = await db.execute(sql`
    update notifications set delivery_status = 'QUEUED', attempts = 0, last_error = null
    where delivery_status = 'FAILED' and event_type <> 'OTP' and created_at > now() - interval '7 days'`);
  await audit(req, 'RETRY_SMS', 'notifications', null, { count: rowCount });
  res.json({ requeued: rowCount ?? 0 });
});
