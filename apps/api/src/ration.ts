/**
 * LLD Module 2 — Ration Distribution: 2.1 verify eligibility → 2.2 check
 * monthly quota → 2.3 validate stock → 2.4 issue & update stock → 2.5 receipt.
 * The API checks everything up front for clear messages; the database triggers
 * re-check inside the transaction, so nothing can slip through (see docs/database.md).
 */
import { sql, type SQL } from 'drizzle-orm';
import { distributionItems, distributions, withActor, type Actor } from '@srms/db';
import { istMonthKey, maskAadhaar } from '@srms/shared';
import { db, iso, num } from './db';
import { HttpError, notFound } from './http';

export interface EntitlementLine {
  commodityId: number;
  code: string;
  name: string;
  nameHi: string | null;
  unit: string;
  pricePerUnit: number;
  allocated: number;
  issued: number;
  remaining: number;
}

/** 2.2 Monthly quota per commodity (created on demand for the current month). */
export async function entitlement(beneficiaryId: string, month = istMonthKey()): Promise<EntitlementLine[]> {
  if (month === istMonthKey()) await db.execute(sql`select srms_generate_quotas(${month}::date, ${beneficiaryId}::uuid)`);
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select c.commodity_id, c.code, c.commodity_name, c.commodity_name_hi, c.unit, c.price_per_unit,
           q.allocated_qty, q.issued_qty, q.remaining_qty
    from beneficiary_quotas q join commodities c using (commodity_id)
    where q.beneficiary_id = ${beneficiaryId} and q.quota_month = ${month}::date
    order by c.sort_order`);
  return rows.map((r) => ({
    commodityId: num(r.commodity_id),
    code: String(r.code),
    name: String(r.commodity_name),
    nameHi: (r.commodity_name_hi as string) ?? null,
    unit: String(r.unit),
    pricePerUnit: num(r.price_per_unit),
    allocated: num(r.allocated_qty),
    issued: num(r.issued_qty),
    remaining: num(r.remaining_qty),
  }));
}

/** Current stock per commodity at a shop. */
export async function shopStock(shopId: string) {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select commodity_id, commodity_code, commodity_name, unit, quantity_available, monthly_quota, low_stock_threshold, is_low, pct_of_quota
    from v_stock_status where shop_id = ${shopId} order by commodity_id`);
  return rows.map((r) => ({
    commodityId: num(r.commodity_id),
    code: String(r.commodity_code),
    name: String(r.commodity_name),
    unit: String(r.unit),
    quantityAvailable: num(r.quantity_available),
    monthlyQuota: num(r.monthly_quota),
    lowStockThreshold: num(r.low_stock_threshold),
    isLow: Boolean(r.is_low),
    pctOfQuota: r.pct_of_quota === null ? null : num(r.pct_of_quota),
  }));
}

export interface IssueInput {
  shopId: string;
  dealerId: string;
  beneficiaryId: string;
  items: { commodityId: number; quantity: number }[];
  authMethod: 'OTP' | 'OFFLINE';
  authRef?: string;
  clientRef?: string;
  issuedAt?: Date;
  capturedOfflineAt?: Date;
}

/** 2.4 Issue & update stock — one DB transaction; returns the receipt (2.5). */
export async function issueRation(actor: Actor, input: IssueInput) {
  if (input.clientRef) {
    // Offline sync retries are idempotent: the same clientRef returns the same receipt.
    const { rows } = await db.execute<{ id: string }>(sql`select transaction_id as id from distributions where client_ref = ${input.clientRef}`);
    if (rows[0]) return { ...(await receipt(rows[0].id)), duplicate: true };
  }
  const merged = new Map<number, number>();
  for (const it of input.items) merged.set(it.commodityId, (merged.get(it.commodityId) ?? 0) + it.quantity);

  const id = await withActor(db, actor, async (tx) => {
    const [d] = await tx
      .insert(distributions)
      .values({
        beneficiaryId: input.beneficiaryId,
        shopId: input.shopId,
        dealerId: input.dealerId,
        authMethod: input.authMethod,
        authRef: input.authRef,
        clientRef: input.clientRef,
        issuedAt: input.issuedAt ?? new Date(),
        capturedOfflineAt: input.capturedOfflineAt,
        syncedAt: input.capturedOfflineAt ? new Date() : undefined,
        createdById: actor.userId,
      })
      .returning({ id: distributions.id });
    await tx.insert(distributionItems).values([...merged].map(([commodityId, quantity]) => ({ distributionId: d!.id, commodityId, quantity })));
    return d!.id;
  });
  return { ...(await receipt(id)), duplicate: false };
}

/** 2.5 Printable / digital receipt. */
export async function receipt(id: string) {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select d.transaction_id, d.receipt_id, d.issue_date, d.status, d.auth_method, d.captured_offline_at,
           b.beneficiary_id, b.name as beneficiary_name, b.ration_card_no, b.card_type, b.aadhaar_last4,
           s.shop_id, s.shop_code, s.shop_name, s.address as shop_address, dl.name as dealer_name, dl.license_id,
           ds.name as district_name
    from distributions d
    join beneficiaries b using (beneficiary_id)
    join shops s on s.shop_id = d.shop_id
    join dealers dl on dl.dealer_id = d.dealer_id
    join districts ds on ds.id = s.district_id
    where d.transaction_id = ${id}`);
  const h = rows[0];
  if (!h) throw notFound('Receipt');
  const items = await db.execute<Record<string, unknown>>(sql`
    select i.commodity_id, c.code, c.commodity_name, c.commodity_name_hi, c.unit, i.quantity, i.unit_price, i.amount
    from distribution_items i join commodities c using (commodity_id)
    where i.transaction_id = ${id} order by c.sort_order`);
  const lines = items.rows.map((r) => ({
    commodityId: num(r.commodity_id),
    code: String(r.code),
    name: String(r.commodity_name),
    nameHi: (r.commodity_name_hi as string) ?? null,
    unit: String(r.unit),
    quantity: num(r.quantity),
    unitPrice: num(r.unit_price),
    amount: num(r.amount),
  }));
  return {
    id: String(h.transaction_id),
    receiptNo: String(h.receipt_id),
    issuedAt: iso(h.issue_date)!,
    status: String(h.status),
    authMethod: String(h.auth_method),
    capturedOfflineAt: iso(h.captured_offline_at),
    beneficiary: {
      id: String(h.beneficiary_id),
      name: String(h.beneficiary_name),
      rationCardNo: (h.ration_card_no as string) ?? null,
      cardType: String(h.card_type),
      aadhaarMasked: maskAadhaar(String(h.aadhaar_last4)),
    },
    shop: { id: String(h.shop_id), code: String(h.shop_code), name: String(h.shop_name), address: String(h.shop_address), district: String(h.district_name) },
    dealer: { name: String(h.dealer_name), licenseNo: String(h.license_id) },
    items: lines,
    totalAmount: Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100,
  };
}

/** Paged list of distributions with their items, filtered by a SQL condition on `d`/`s`. */
export async function listDistributions(where: SQL, limit: number, offset: number) {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select d.transaction_id, d.receipt_id, d.issue_date, d.status, d.auth_method, d.captured_offline_at,
           b.name as beneficiary_name, b.ration_card_no, s.shop_code, s.shop_name,
           coalesce(json_agg(json_build_object('code', c.code, 'name', c.commodity_name, 'unit', c.unit, 'quantity', i.quantity)
                    order by c.sort_order), '[]') as items,
           count(*) over () as total
    from distributions d
    join beneficiaries b using (beneficiary_id)
    join shops s on s.shop_id = d.shop_id
    join distribution_items i on i.transaction_id = d.transaction_id
    join commodities c on c.commodity_id = i.commodity_id
    where ${where}
    group by d.transaction_id, b.beneficiary_id, s.shop_id
    order by d.issue_date desc
    limit ${limit} offset ${offset}`);
  return {
    total: num(rows[0]?.total),
    items: rows.map((r) => ({
      id: String(r.transaction_id),
      receiptNo: String(r.receipt_id),
      issuedAt: iso(r.issue_date)!,
      status: String(r.status),
      authMethod: String(r.auth_method),
      offline: r.captured_offline_at !== null,
      beneficiaryName: String(r.beneficiary_name),
      rationCardNo: (r.ration_card_no as string) ?? null,
      shopCode: String(r.shop_code),
      shopName: String(r.shop_name),
      items: (r.items as { code: string; name: string; unit: string; quantity: string }[]).map((i) => ({ ...i, quantity: num(i.quantity) })),
    })),
  };
}

export const assert = (cond: unknown, status: number, message: string, code: string): void => {
  if (!cond) throw new HttpError(status, message, code);
};
