/**
 * FR-6 Government dashboard and FR-8 monthly reports.
 * KPI definitions (docs/database.md):
 *   coverage % = beneficiaries served ÷ verified active beneficiaries
 *   offtake %  = quantity issued ÷ quantity allocated (quotas)
 *   leakage %  = unexplained shortages found at inspection ÷ quantity received
 *   wastage %  = recorded damage/expiry ÷ quantity received
 */
import ExcelJS from 'exceljs';
import { sql, type SQL } from 'drizzle-orm';
import { addMonths } from '@srms/shared';
import { db, num } from './db';

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Month boundaries in IST as timestamps (index-friendly range filters). */
const monthStart = (m: string) => new Date(`${m}T00:00:00+05:30`);

export async function dashboard(month: string, districtId: number | null) {
  const scope = (col: SQL) => (districtId === null ? sql`true` : sql`${col} = ${districtId}`);
  const from = monthStart(month);
  const to = monthStart(addMonths(month, 1));
  const inMonth = sql`d.status = 'COMPLETED' and d.issue_date >= ${from} and d.issue_date < ${to}`;

  const head = (
    await db.execute<Record<string, string>>(sql`
      select
        (select count(*) from beneficiaries b where b.verification_status = 'VERIFIED' and b.status = 'ACTIVE' and ${scope(sql`b.district_id`)}) as verified,
        (select count(*) from beneficiaries b where b.verification_status = 'PENDING' and ${scope(sql`b.district_id`)}) as pending,
        (select count(*) from shops s where s.status = 'ACTIVE' and ${scope(sql`s.district_id`)}) as shops,
        (select count(*) from dealers dl where dl.status = 'ACTIVE' and ${scope(sql`dl.district_id`)}) as dealers,
        (select count(distinct d.beneficiary_id) from distributions d join shops s using (shop_id) where ${inMonth} and ${scope(sql`s.district_id`)}) as served,
        (select count(*) from distributions d join shops s using (shop_id) where ${inMonth} and ${scope(sql`s.district_id`)}) as transactions,
        (select count(*) from distributions d join shops s using (shop_id) where ${inMonth} and d.auth_method = 'OFFLINE' and ${scope(sql`s.district_id`)}) as offline`)
  ).rows[0]!;

  const commodities = (
    await db.execute<Record<string, string>>(sql`
      select c.commodity_id, c.code, c.commodity_name, c.unit,
             coalesce(q.allocated, 0) as allocated, coalesce(q.issued, 0) as issued,
             coalesce(l.received, 0) as received, coalesce(l.wastage, 0) as wastage, coalesce(l.leakage, 0) as leakage,
             coalesce(st.stock, 0) as stock
      from commodities c
      left join (select q.commodity_id, sum(q.allocated_qty) as allocated, sum(q.issued_qty) as issued
                 from beneficiary_quotas q join beneficiaries b using (beneficiary_id)
                 where q.quota_month = ${month}::date and ${scope(sql`b.district_id`)} group by 1) q using (commodity_id)
      left join (select commodity_id, sum(received) as received, sum(wastage) as wastage, sum(leakage) as leakage
                 from v_shop_month_ledger where month = ${month}::date and ${scope(sql`district_id`)} group by 1) l using (commodity_id)
      left join (select commodity_id, sum(quantity_available) as stock from v_stock_status where ${scope(sql`district_id`)} group by 1) st using (commodity_id)
      where c.is_active order by c.sort_order`)
  ).rows.map((r) => ({
    commodityId: num(r.commodity_id), code: r.code!, name: r.commodity_name!, unit: r.unit!,
    allocated: num(r.allocated), issued: num(r.issued), received: num(r.received), wastage: num(r.wastage), leakage: num(r.leakage), stock: num(r.stock),
    offtakePct: pct(num(r.issued), num(r.allocated)),
  }));

  const trend = (
    await db.execute<Record<string, string>>(sql`
      with months as (select generate_series(${addMonths(month, -5)}::date, ${month}::date, interval '1 month')::date as m)
      select m.m::text as month,
        (select count(distinct d.beneficiary_id) from distributions d join shops s using (shop_id)
          where d.status = 'COMPLETED' and d.issue_date >= (m.m::timestamp at time zone 'Asia/Kolkata')
            and d.issue_date < ((m.m + interval '1 month')::timestamp at time zone 'Asia/Kolkata') and ${scope(sql`s.district_id`)}) as served,
        (select coalesce(sum(q.allocated_qty), 0) from beneficiary_quotas q join beneficiaries b using (beneficiary_id)
          where q.quota_month = m.m and ${scope(sql`b.district_id`)}) as allocated,
        (select coalesce(sum(q.issued_qty), 0) from beneficiary_quotas q join beneficiaries b using (beneficiary_id)
          where q.quota_month = m.m and ${scope(sql`b.district_id`)}) as issued,
        (select coalesce(sum(received), 0) from v_shop_month_ledger where month = m.m and ${scope(sql`district_id`)}) as received,
        (select coalesce(sum(leakage), 0) from v_shop_month_ledger where month = m.m and ${scope(sql`district_id`)}) as leakage
      from months m order by m.m`)
  ).rows.map((r) => ({
    month: r.month!,
    served: num(r.served),
    coveragePct: pct(num(r.served), num(head.verified)),
    allocated: num(r.allocated),
    issued: num(r.issued),
    offtakePct: pct(num(r.issued), num(r.allocated)),
    leakagePct: pct(num(r.leakage), num(r.received)),
  }));

  const districts =
    districtId !== null
      ? []
      : (
          await db.execute<Record<string, string>>(sql`
            select ds.id, ds.name, ds.name_hi,
              (select count(*) from beneficiaries b where b.district_id = ds.id and b.verification_status = 'VERIFIED' and b.status = 'ACTIVE') as verified,
              (select count(distinct d.beneficiary_id) from distributions d join shops s using (shop_id) where ${inMonth} and s.district_id = ds.id) as served,
              (select coalesce(sum(received), 0) from v_shop_month_ledger where month = ${month}::date and district_id = ds.id) as received,
              (select coalesce(sum(issued), 0) from v_shop_month_ledger where month = ${month}::date and district_id = ds.id) as issued,
              (select coalesce(sum(leakage), 0) from v_shop_month_ledger where month = ${month}::date and district_id = ds.id) as leakage,
              (select count(*) from v_stock_status where district_id = ds.id and is_low) as low_stock,
              (select count(*) from complaints c join shops s using (shop_id) where s.district_id = ds.id and c.status in ('OPEN', 'IN_PROGRESS')) as open_complaints
            from districts ds
            where exists (select 1 from shops s where s.district_id = ds.id)
            order by ds.name`)
        ).rows.map((r) => ({
          districtId: num(r.id), name: r.name!, nameHi: r.name_hi ?? null,
          verified: num(r.verified), served: num(r.served), coveragePct: pct(num(r.served), num(r.verified)),
          received: num(r.received), issued: num(r.issued), leakage: num(r.leakage), leakagePct: pct(num(r.leakage), num(r.received)),
          lowStock: num(r.low_stock), openComplaints: num(r.open_complaints),
        }));

  const lowStock = (
    await db.execute<Record<string, string>>(sql`
      select v.shop_id, v.shop_code, v.shop_name, v.commodity_name, v.unit, v.quantity_available, v.low_stock_threshold, v.pct_of_quota, dl.name as dealer_name
      from v_stock_status v left join dealers dl on dl.dealer_id = v.dealer_id
      where v.is_low and ${scope(sql`v.district_id`)} order by v.pct_of_quota nulls first limit 20`)
  ).rows.map((r) => ({
    shopId: r.shop_id!, shopCode: r.shop_code!, shopName: r.shop_name!, commodity: r.commodity_name!, unit: r.unit!, dealer: r.dealer_name ?? null,
    quantityAvailable: num(r.quantity_available), threshold: num(r.low_stock_threshold), pctOfQuota: num(r.pct_of_quota),
  }));

  const leakageShops = (
    await db.execute<Record<string, string>>(sql`
      select l.shop_id, l.shop_code, s.shop_name, dl.name as dealer_name, sum(l.received) as received, sum(l.leakage) as leakage
      from v_shop_month_ledger l join shops s using (shop_id) left join dealers dl on dl.dealer_id = s.dealer_id
      where l.month between ${addMonths(month, -2)}::date and ${month}::date and ${scope(sql`l.district_id`)}
      group by 1, 2, 3, 4 having sum(l.leakage) > 0 order by sum(l.leakage) / nullif(sum(l.received), 0) desc limit 10`)
  ).rows.map((r) => ({
    shopId: r.shop_id!, shopCode: r.shop_code!, shopName: r.shop_name!, dealer: r.dealer_name ?? null,
    received: num(r.received), leakage: num(r.leakage), leakagePct: pct(num(r.leakage), num(r.received)),
  }));

  const complaintScope = scope(sql`coalesce(s.district_id, b.district_id)`);
  const c = (
    await db.execute<Record<string, string>>(sql`
      select
        count(*) filter (where c.status = 'OPEN') as open,
        count(*) filter (where c.status = 'IN_PROGRESS') as in_progress,
        count(*) filter (where c.status = 'RESOLVED' and c.resolved_at >= ${from} and c.resolved_at < ${to}) as resolved_month,
        count(*) filter (where c.created_at >= ${from} and c.created_at < ${to}) as filed_month,
        avg(extract(epoch from c.resolved_at - c.created_at) / 3600) filter (where c.status = 'RESOLVED') as avg_hours
      from complaints c join beneficiaries b using (beneficiary_id) left join shops s on s.shop_id = c.shop_id
      where ${complaintScope}`)
  ).rows[0]!;
  const byCategory = (
    await db.execute<Record<string, string>>(sql`
      select c.category, count(*) as n from complaints c join beneficiaries b using (beneficiary_id) left join shops s on s.shop_id = c.shop_id
      where c.status in ('OPEN', 'IN_PROGRESS') and ${complaintScope} group by 1 order by 2 desc`)
  ).rows.map((r) => ({ category: r.category!, count: num(r.n) }));

  const received = commodities.reduce((a, x) => a + x.received, 0);
  const allocated = commodities.reduce((a, x) => a + x.allocated, 0);
  const issued = commodities.reduce((a, x) => a + x.issued, 0);
  return {
    month,
    districtId,
    kpis: {
      verifiedBeneficiaries: num(head.verified),
      pendingVerification: num(head.pending),
      activeShops: num(head.shops),
      activeDealers: num(head.dealers),
      served: num(head.served),
      transactions: num(head.transactions),
      offlineTransactions: num(head.offline),
      coveragePct: pct(num(head.served), num(head.verified)),
      allocated: r3(allocated),
      issued: r3(issued),
      offtakePct: pct(issued, allocated),
      received: r3(received),
      leakagePct: pct(commodities.reduce((a, x) => a + x.leakage, 0), received),
      wastagePct: pct(commodities.reduce((a, x) => a + x.wastage, 0), received),
      lowStockItems: lowStock.length,
    },
    commodities,
    trend,
    districts,
    lowStock,
    leakageShops,
    complaints: {
      open: num(c.open),
      inProgress: num(c.in_progress),
      filedThisMonth: num(c.filed_month),
      resolvedThisMonth: num(c.resolved_month),
      avgResolutionHours: c.avg_hours === null ? null : Math.round(num(c.avg_hours)),
      openByCategory: byCategory,
    },
  };
}

/** FR-8: shop-wise and district-wise monthly report with opening/closing stock and variances. */
export async function monthlyReport(month: string, districtId: number | null) {
  const scope = districtId === null ? sql`true` : sql`s.district_id = ${districtId}`;
  const from = monthStart(month);
  const to = monthStart(addMonths(month, 1));

  const lines = (
    await db.execute<Record<string, string>>(sql`
      select ds.name as district, s.shop_id, s.shop_code, s.shop_name, dl.name as dealer, c.code, c.commodity_name, c.unit,
        (select coalesce(sum(m.quantity), 0) from stock_movements m where m.shop_id = s.shop_id and m.commodity_id = c.commodity_id and m.occurred_at < ${from}) as opening,
        coalesce(l.received, 0) as received, coalesce(l.issued, 0) as issued, coalesce(l.reversed, 0) as reversed,
        coalesce(l.wastage, 0) as wastage, coalesce(l.leakage, 0) as leakage, coalesce(l.excess, 0) as excess,
        (select coalesce(sum(m.quantity), 0) from stock_movements m where m.shop_id = s.shop_id and m.commodity_id = c.commodity_id and m.occurred_at < ${to}) as closing,
        (select coalesce(sum(q.allocated_qty), 0) from beneficiary_quotas q join beneficiaries b using (beneficiary_id)
          where b.home_shop_id = s.shop_id and q.commodity_id = c.commodity_id and q.quota_month = ${month}::date) as allocated
      from shops s
      join districts ds on ds.id = s.district_id
      left join dealers dl on dl.dealer_id = s.dealer_id
      join stock st on st.shop_id = s.shop_id
      join commodities c on c.commodity_id = st.commodity_id
      left join v_shop_month_ledger l on l.shop_id = s.shop_id and l.commodity_id = c.commodity_id and l.month = ${month}::date
      where ${scope}
      order by ds.name, s.shop_code, c.sort_order`)
  ).rows.map((r) => {
    const allocated = num(r.allocated);
    const issued = num(r.issued) - num(r.reversed);
    return {
      district: r.district!, shopId: r.shop_id!, shopCode: r.shop_code!, shopName: r.shop_name!, dealer: r.dealer ?? '—',
      commodity: r.commodity_name!, code: r.code!, unit: r.unit!,
      opening: num(r.opening), received: num(r.received), issued: r3(issued), wastage: num(r.wastage), leakage: num(r.leakage),
      excess: num(r.excess), closing: num(r.closing), allocated,
      undistributed: r3(Math.max(0, allocated - issued)),
      offtakePct: pct(issued, allocated),
    };
  });

  const shopStats = (
    await db.execute<Record<string, string>>(sql`
      select s.shop_id,
        (select count(*) from beneficiaries b where b.home_shop_id = s.shop_id and b.verification_status = 'VERIFIED' and b.status = 'ACTIVE') as home,
        (select count(distinct d.beneficiary_id) from distributions d where d.shop_id = s.shop_id and d.status = 'COMPLETED' and d.issue_date >= ${from} and d.issue_date < ${to}) as served,
        (select count(*) from distributions d where d.shop_id = s.shop_id and d.status = 'COMPLETED' and d.issue_date >= ${from} and d.issue_date < ${to}) as transactions
      from shops s where ${scope}`)
  ).rows;
  const statsByShop = new Map(shopStats.map((r) => [r.shop_id!, { home: num(r.home), served: num(r.served), transactions: num(r.transactions) }]));

  const shops = [...new Map(lines.map((l) => [l.shopId, l])).values()].map((l) => {
    const st = statsByShop.get(l.shopId) ?? { home: 0, served: 0, transactions: 0 };
    return { district: l.district, shopId: l.shopId, shopCode: l.shopCode, shopName: l.shopName, dealer: l.dealer, ...st, coveragePct: pct(st.served, st.home) };
  });

  const byDistrict = new Map<string, { district: string; shops: number; home: number; served: number; transactions: number; received: number; issued: number; allocated: number; leakage: number; wastage: number }>();
  for (const s of shops) {
    const d = byDistrict.get(s.district) ?? { district: s.district, shops: 0, home: 0, served: 0, transactions: 0, received: 0, issued: 0, allocated: 0, leakage: 0, wastage: 0 };
    d.shops++;
    d.home += s.home;
    d.served += s.served;
    d.transactions += s.transactions;
    byDistrict.set(s.district, d);
  }
  for (const l of lines) {
    const d = byDistrict.get(l.district)!;
    d.received += l.received;
    d.issued += l.issued;
    d.allocated += l.allocated;
    d.leakage += l.leakage;
    d.wastage += l.wastage;
  }
  const districts = [...byDistrict.values()].map((d) => ({
    ...d,
    received: r3(d.received), issued: r3(d.issued), allocated: r3(d.allocated), leakage: r3(d.leakage), wastage: r3(d.wastage),
    coveragePct: pct(d.served, d.home), offtakePct: pct(d.issued, d.allocated), leakagePct: pct(d.leakage, d.received),
  }));
  return { month, districtId, generatedAt: new Date().toISOString(), shops, lines, districts };
}

export async function reportToXlsx(report: Awaited<ReturnType<typeof monthlyReport>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SRMS';
  wb.created = new Date();
  const sheet = (name: string, columns: { header: string; key: string; width?: number }[], rows: object[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map((c) => ({ width: 14, ...c }));
    ws.addRows(rows);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  };
  sheet('District-wise', [
    { header: 'District', key: 'district', width: 18 }, { header: 'Shops', key: 'shops' }, { header: 'Beneficiaries', key: 'home' },
    { header: 'Served', key: 'served' }, { header: 'Coverage %', key: 'coveragePct' }, { header: 'Transactions', key: 'transactions' },
    { header: 'Allocated', key: 'allocated' }, { header: 'Received', key: 'received' }, { header: 'Issued', key: 'issued' },
    { header: 'Offtake %', key: 'offtakePct' }, { header: 'Wastage', key: 'wastage' }, { header: 'Leakage', key: 'leakage' }, { header: 'Leakage %', key: 'leakagePct' },
  ], report.districts);
  sheet('Shop-wise', [
    { header: 'District', key: 'district', width: 16 }, { header: 'Shop code', key: 'shopCode' }, { header: 'Shop', key: 'shopName', width: 30 },
    { header: 'Dealer', key: 'dealer', width: 22 }, { header: 'Beneficiaries', key: 'home' }, { header: 'Served', key: 'served' },
    { header: 'Coverage %', key: 'coveragePct' }, { header: 'Transactions', key: 'transactions' },
  ], report.shops);
  sheet('Stock ledger', [
    { header: 'District', key: 'district', width: 16 }, { header: 'Shop code', key: 'shopCode' }, { header: 'Commodity', key: 'commodity' },
    { header: 'Unit', key: 'unit', width: 8 }, { header: 'Opening', key: 'opening' }, { header: 'Received', key: 'received' },
    { header: 'Issued', key: 'issued' }, { header: 'Wastage', key: 'wastage' }, { header: 'Leakage', key: 'leakage' }, { header: 'Excess', key: 'excess' },
    { header: 'Closing', key: 'closing' }, { header: 'Allocated', key: 'allocated' }, { header: 'Undistributed', key: 'undistributed' }, { header: 'Offtake %', key: 'offtakePct' },
  ], report.lines);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
