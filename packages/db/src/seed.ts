/**
 * DEMO seed — realistic data for Bihar so every dashboard has something to
 * show: 5 officials, 6 dealers, 11 shops, ~90 beneficiaries with families,
 * six months of stock receipts and distributions (all written through the
 * real triggers, so quotas and the stock ledger are consistent), a leaking
 * shop, low-stock alerts, and complaints in every state.
 *
 *   pnpm db:seed           (refuses to run in production unless SEED_DEMO=true)
 *
 * Deterministic: the same data is produced on every run.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { addMonths, istMonthKey, makeAadhaar, type ComplaintCategoryName } from '@srms/shared';
import { createDb, createPool } from './client';
import { bootstrap } from './bootstrap';
import { protectAadhaar } from './crypto';
import { hashPassword } from './password';
import * as s from './schema';

// ─── deterministic randomness ────────────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260929);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const chance = (p: number) => rand() < p;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const DAY = 86_400_000;

/** A timestamp at IST wall-clock time on a given day of a YYYY-MM-01 month. */
function istTime(monthKey: string, day: number, hour: number, minute = 0): Date {
  const [y, m] = monthKey.split('-');
  return new Date(`${y}-${m}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`);
}
const daysInMonth = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

// ─── demo cast ───────────────────────────────────────────────────────────────
export const DEMO_PASSWORDS = {
  admin: 'Admin@12345',
  official: 'Official@12345',
  dealer: 'Dealer@12345',
} as const;
export const DEMO_BENEFICIARY_MOBILE = '9876543210';

const OFFICIALS = [
  { name: 'Anjali Verma', designation: 'Director, Food & Consumer Protection', district: null, email: 'official@srms.demo', mobile: '9431000001' },
  { name: 'Rakesh Sinha', designation: 'District Supply Officer', district: 'PAT', email: 'dso.patna@srms.demo', mobile: '9431000002' },
  { name: 'Priya Kumari', designation: 'District Supply Officer', district: 'GAY', email: 'dso.gaya@srms.demo', mobile: '9431000003' },
  { name: 'Sanjay Mishra', designation: 'District Supply Officer', district: 'NAL', email: 'dso.nalanda@srms.demo', mobile: '9431000004' },
  { name: 'Neha Jha', designation: 'District Supply Officer', district: 'MUZ', email: 'dso.muzaffarpur@srms.demo', mobile: '9431000005' },
] as const;

const DEALERS = [
  { key: 'D1', name: 'Suresh Prasad', district: 'PAT', email: 'dealer@srms.demo', mobile: '9835000001', license: 'BR/PAT/FPS/2019/0142', status: 'ACTIVE' },
  { key: 'D2', name: 'Meena Devi', district: 'PAT', email: 'dealer2@srms.demo', mobile: '9835000002', license: 'BR/PAT/FPS/2020/0317', status: 'ACTIVE' },
  { key: 'D3', name: 'Mohammad Irfan', district: 'GAY', email: 'dealer3@srms.demo', mobile: '9835000003', license: 'BR/GAY/FPS/2018/0088', status: 'ACTIVE' },
  { key: 'D4', name: 'Vinod Kumar Singh', district: 'NAL', email: 'dealer4@srms.demo', mobile: '9835000004', license: 'BR/NAL/FPS/2021/0209', status: 'ACTIVE' },
  { key: 'D5', name: 'Kavita Choudhary', district: 'MUZ', email: 'dealer5@srms.demo', mobile: '9835000005', license: 'BR/MUZ/FPS/2022/0051', status: 'ACTIVE' },
  { key: 'D6', name: 'Ramesh Paswan', district: 'PAT', email: 'dealer6@srms.demo', mobile: '9835000006', license: 'BR/PAT/FPS/2017/0033', status: 'SUSPENDED' },
] as const;

const SHOPS = [
  { code: 'FPS-PAT-0001', dealer: 'D1', name: 'Kankarbagh Fair Price Shop', address: 'Main Road, Kankarbagh, Patna 800020', pin: '800020', lat: 25.5941, lng: 85.164 },
  { code: 'FPS-PAT-0002', dealer: 'D1', name: 'Rajendra Nagar Fair Price Shop', address: 'Road No. 5, Rajendra Nagar, Patna 800016', pin: '800016', lat: 25.605, lng: 85.158 },
  { code: 'FPS-PAT-0003', dealer: 'D1', name: 'Boring Road Fair Price Shop', address: 'Boring Road, Patna 800001', pin: '800001', lat: 25.615, lng: 85.11 },
  { code: 'FPS-PAT-0004', dealer: 'D2', name: 'Danapur Fair Price Shop', address: 'Station Road, Danapur, Patna 801503', pin: '801503', lat: 25.636, lng: 85.047 },
  { code: 'FPS-PAT-0005', dealer: 'D2', name: 'Phulwari Sharif Fair Price Shop', address: 'Phulwari Sharif, Patna 801505', pin: '801505', lat: 25.576, lng: 85.08 },
  { code: 'FPS-GAY-0001', dealer: 'D3', name: 'Bodh Gaya Fair Price Shop', address: 'Domuhan Road, Bodh Gaya 824231', pin: '824231', lat: 24.696, lng: 84.987 },
  { code: 'FPS-GAY-0002', dealer: 'D3', name: 'Sherghati Fair Price Shop', address: 'GT Road, Sherghati, Gaya 824211', pin: '824211', lat: 24.557, lng: 84.792 },
  { code: 'FPS-NAL-0001', dealer: 'D4', name: 'Bihar Sharif Fair Price Shop', address: 'Ramchandrapur, Bihar Sharif 803101', pin: '803101', lat: 25.197, lng: 85.523 },
  { code: 'FPS-NAL-0002', dealer: 'D4', name: 'Rajgir Fair Price Shop', address: 'Kund Road, Rajgir 803116', pin: '803116', lat: 25.028, lng: 85.42 },
  { code: 'FPS-MUZ-0001', dealer: 'D5', name: 'Motijheel Fair Price Shop', address: 'Motijheel, Muzaffarpur 842001', pin: '842001', lat: 26.121, lng: 85.391 },
  { code: 'FPS-PAT-0006', dealer: null, name: 'Patliputra Colony Fair Price Shop', address: 'Patliputra Colony, Patna 800013', pin: '800013', lat: 25.622, lng: 85.101 },
] as const;

/** Shops whose current-month delivery is short → low-stock alerts (R5). */
const SHORT_DELIVERY_SHOPS = new Set(['FPS-PAT-0002', 'FPS-GAY-0002']);
/** Shop with inspection shortages → non-zero leakage KPI. */
const LEAKY_SHOP = 'FPS-PAT-0004';

const MALE = ['Ramesh', 'Sunil', 'Rajesh', 'Manoj', 'Anil', 'Santosh', 'Vijay', 'Ajay', 'Dinesh', 'Pankaj', 'Mukesh', 'Ashok', 'Arvind', 'Umesh', 'Shankar', 'Mahesh', 'Birendra', 'Nagendra', 'Lalan', 'Shambhu', 'Sudhir', 'Ravi', 'Mohammad Salim', 'Imran', 'Abdul Rahman'];
const FEMALE = ['Sunita', 'Rinku', 'Pooja', 'Anita', 'Savitri', 'Kiran', 'Rekha', 'Geeta', 'Suman', 'Manju', 'Priyanka', 'Sarita', 'Usha', 'Lalita', 'Shobha', 'Shabana', 'Nazia'];
const SURNAMES = ['Kumar', 'Prasad', 'Yadav', 'Singh', 'Paswan', 'Mahto', 'Ram', 'Sah', 'Gupta', 'Sharma', 'Mandal', 'Choudhary', 'Rajak', 'Manjhi', 'Thakur'];
const CHILD_M = ['Aman', 'Rahul', 'Rohit', 'Vikash', 'Sonu', 'Monu', 'Aryan', 'Ankit', 'Deepak', 'Sahil'];
const CHILD_F = ['Priya', 'Khushi', 'Anjali', 'Nisha', 'Puja', 'Simran', 'Ritu', 'Neha', 'Soni', 'Kajal'];

const COMPLAINT_TEXT: Record<ComplaintCategoryName, string[]> = {
  SHORT_WEIGHT: [
    'I was given about 2 kg less rice than written on my receipt. The weighing scale at the shop looks tampered.',
    'Wheat was weighed with the bag included, so I received less than my entitlement.',
  ],
  POOR_QUALITY: ['The rice issued this month had stones and insects in it.', 'Wheat was damp and smelled bad.'],
  DENIED_RATION: ['Dealer said stock is finished and asked me to come next month, but other people were given ration after me.'],
  SHOP_CLOSED: ['The shop was closed for three days during the distribution week without any notice.'],
  OVERCHARGING: ['I was charged ₹20 for sugar although the price is ₹13.50 per kg.'],
  DEALER_BEHAVIOUR: ['The dealer misbehaved with my mother when she went to collect the ration.'],
  OTHER: ['My SMS alerts are not coming even though my mobile number is correct.'],
};

// ─── seed ────────────────────────────────────────────────────────────────────
export async function seed(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO !== 'true') {
    throw new Error('Refusing to load demo data in production (set SEED_DEMO=true to override).');
  }
  const pool = createPool();
  const db = createDb(pool);
  try {
    await bootstrap(db, () => undefined);
    const [already] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, 'dealer@srms.demo'));
    if (already) {
      console.log('✔ demo data already present — nothing to do (run `pnpm db:reset` for a clean slate)');
      return;
    }

    const now = new Date();
    const currentMonth = istMonthKey(now);
    const months = [-5, -4, -3, -2, -1, 0].map((n) => addMonths(currentMonth, n));
    const todayIst = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(now));

    const hashes = {
      admin: await hashPassword(DEMO_PASSWORDS.admin),
      official: await hashPassword(DEMO_PASSWORDS.official),
      dealer: await hashPassword(DEMO_PASSWORDS.dealer),
    };

    const summary = await db.transaction(async (tx) => {
      const districtRows = await tx.select().from(s.districts);
      const districtId = (code: string) => districtRows.find((d) => d.code === code)!.id;
      const commodityRows = await tx.select().from(s.commodities);
      const commodityById = new Map(commodityRows.map((c) => [c.id, c]));

      const setActor = async (userId: string | null, role: string | null) => {
        await tx.execute(sql`select set_config('srms.user_id', ${userId ?? ''}, true), set_config('srms.role', ${role ?? ''}, true)`);
      };

      // ── staff ──
      let [admin] = await tx.select().from(s.users).where(eq(s.users.role, 'ADMIN')).limit(1);
      if (!admin) {
        [admin] = await tx
          .insert(s.users)
          .values({ role: 'ADMIN', fullName: 'System Administrator', email: 'admin@srms.demo', passwordHash: hashes.admin })
          .returning();
      }
      await setActor(admin!.id, 'ADMIN');

      const officialByDistrict = new Map<string | null, { id: string; userId: string }>();
      for (const o of OFFICIALS) {
        const [u] = await tx
          .insert(s.users)
          .values({ role: 'OFFICIAL', fullName: o.name, email: o.email, mobile: o.mobile, passwordHash: hashes.official })
          .returning();
        const [off] = await tx
          .insert(s.officials)
          .values({ userId: u!.id, name: o.name, designation: o.designation, districtId: o.district ? districtId(o.district) : null, mobile: o.mobile })
          .returning();
        officialByDistrict.set(o.district, { id: off!.id, userId: u!.id });
      }

      const dealerByKey = new Map<string, { id: string; userId: string; districtId: number }>();
      for (const d of DEALERS) {
        const [u] = await tx
          .insert(s.users)
          .values({ role: 'DEALER', fullName: d.name, email: d.email, mobile: d.mobile, passwordHash: hashes.dealer, status: d.status })
          .returning();
        const [dl] = await tx
          .insert(s.dealers)
          .values({
            userId: u!.id,
            name: d.name,
            licenseNo: d.license,
            licenseValidUntil: '2028-03-31',
            mobile: d.mobile,
            address: `${d.name.split(' ')[0]} Bhawan, ${districtRows.find((x) => x.code === d.district)!.name}`,
            districtId: districtId(d.district),
            status: d.status,
          })
          .returning();
        dealerByKey.set(d.key, { id: dl!.id, userId: u!.id, districtId: dl!.districtId });
      }

      // ── shops (triggers enforce ≤3 per dealer, same district) ──
      const shopRows: (typeof s.shops.$inferSelect & { pin: string })[] = [];
      for (const sh of SHOPS) {
        const districtCode = sh.code.split('-')[1]!;
        const [row] = await tx
          .insert(s.shops)
          .values({
            shopCode: sh.code,
            dealerId: sh.dealer ? dealerByKey.get(sh.dealer)!.id : null,
            name: sh.name,
            address: sh.address,
            districtId: districtId(districtCode),
            latitude: sh.lat,
            longitude: sh.lng,
            status: sh.dealer ? 'ACTIVE' : 'INACTIVE',
          })
          .returning();
        shopRows.push({ ...row!, pin: sh.pin });
      }
      const activeShops = shopRows.filter((x) => x.status === 'ACTIVE');

      // ── beneficiaries ──
      const usedMobiles = new Set<string>([DEMO_BENEFICIARY_MOBILE]);
      const usedAadhaar = new Set<string>();
      const nextMobile = () => {
        let m: string;
        do m = `${pick(['6', '7', '8', '9'])}${String(int(100_000_000, 999_999_999))}`;
        while (usedMobiles.has(m));
        usedMobiles.add(m);
        return m;
      };
      const nextAadhaar = () => {
        let a: string;
        do a = makeAadhaar(`${int(2, 9)}${String(int(0, 9_999_999_999)).padStart(10, '0')}`);
        while (usedAadhaar.has(a));
        usedAadhaar.add(a);
        return a;
      };

      interface Ben { id: string; userId: string; shopId: string; districtId: number; verified: boolean; name: string }
      const bens: Ben[] = [];

      const createBeneficiary = async (opts: {
        shop: (typeof shopRows)[number];
        name?: string;
        gender?: 'MALE' | 'FEMALE';
        mobile?: string;
        cardType?: 'AAY' | 'PHH';
        members?: number;
        outcome: 'VERIFIED' | 'PENDING' | 'REJECTED';
        registeredAt: Date;
      }) => {
        const gender = opts.gender ?? (chance(0.6) ? 'MALE' : 'FEMALE');
        const surname = pick(SURNAMES);
        const first = gender === 'MALE' ? pick(MALE) : pick(FEMALE);
        const name = opts.name ?? (first.includes(' ') ? first : `${first} ${gender === 'FEMALE' && chance(0.5) ? 'Devi' : surname}`);
        const mobile = opts.mobile ?? nextMobile();
        const cardType = opts.cardType ?? (chance(0.2) ? 'AAY' : 'PHH');
        const members = opts.members ?? int(1, 7);
        const [u] = await tx.insert(s.users).values({ role: 'BENEFICIARY', fullName: name, mobile }).returning();
        const [b] = await tx
          .insert(s.beneficiaries)
          .values({
            userId: u!.id,
            ...protectAadhaar(nextAadhaar()),
            name,
            guardianName: `${pick(MALE)} ${surname}`,
            gender,
            dateOfBirth: `${int(1958, 1998)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
            mobile,
            address: `House No. ${int(1, 250)}, Ward ${int(1, 40)}, ${opts.shop.address}`,
            pincode: opts.shop.pin,
            districtId: opts.shop.districtId,
            homeShopId: opts.shop.id,
            cardType,
            registrationDate: opts.registeredAt,
            preferredLanguage: chance(0.55) ? 'hi' : 'en',
          })
          .returning();
        const family: (typeof s.familyMembers.$inferInsert)[] = [
          { beneficiaryId: b!.id, name, relation: 'Self', gender, isHead: true, aadhaarLast4: b!.aadhaarLast4 },
        ];
        const relations = ['Spouse', 'Son', 'Daughter', 'Mother', 'Father', 'Son', 'Daughter'];
        for (let i = 1; i < members; i++) {
          const rel = relations[i - 1]!;
          const g = rel === 'Spouse' ? (gender === 'MALE' ? 'FEMALE' : 'MALE') : ['Son', 'Father'].includes(rel) ? 'MALE' : 'FEMALE';
          const childName = g === 'MALE' ? pick(CHILD_M) : pick(CHILD_F);
          family.push({
            beneficiaryId: b!.id,
            name: rel === 'Spouse' ? (g === 'FEMALE' ? `${pick(FEMALE)} Devi` : `${pick(MALE)} ${surname}`) : `${childName} ${g === 'MALE' ? surname : 'Kumari'}`,
            relation: rel,
            gender: g,
            dateOfBirth: `${rel === 'Mother' || rel === 'Father' ? int(1940, 1960) : rel === 'Spouse' ? int(1960, 1998) : int(2000, 2022)}-0${int(1, 9)}-1${int(0, 9)}`,
            aadhaarLast4: String(int(1000, 9999)),
          });
        }
        await tx.insert(s.familyMembers).values(family);

        const txnRef = `UIDAI-${String(int(10_000_000, 99_999_999))}`;
        if (opts.outcome === 'VERIFIED') {
          await tx
            .update(s.beneficiaries)
            .set({ verificationStatus: 'VERIFIED', verifiedAt: new Date(opts.registeredAt.getTime() + int(1, 5) * DAY) })
            .where(eq(s.beneficiaries.id, b!.id));
          await tx.insert(s.aadhaarVerifications).values({
            beneficiaryId: b!.id, method: 'OTP', purpose: 'AADHAAR_VERIFY', txnRef, result: 'SUCCESS', responseCode: '000', message: 'Authenticated',
          });
        } else if (opts.outcome === 'REJECTED') {
          await tx.insert(s.aadhaarVerifications).values({
            beneficiaryId: b!.id, method: 'OTP', purpose: 'AADHAAR_VERIFY', txnRef, result: 'FAILURE', responseCode: '400', message: 'OTP validation failed',
          });
          await tx
            .update(s.beneficiaries)
            .set({ verificationStatus: 'REJECTED', rejectionReason: 'Aadhaar OTP authentication failed (UIDAI 400)' })
            .where(eq(s.beneficiaries.id, b!.id));
        }
        bens.push({ id: b!.id, userId: u!.id, shopId: opts.shop.id, districtId: opts.shop.districtId, verified: opts.outcome === 'VERIFIED', name });
        return b!;
      };

      const longAgo = () => new Date(now.getTime() - int(240, 420) * DAY);
      // The demo beneficiary — log in with this mobile number.
      await createBeneficiary({
        shop: activeShops[0]!, name: 'Ramesh Kumar', gender: 'MALE', mobile: DEMO_BENEFICIARY_MOBILE,
        cardType: 'PHH', members: 5, outcome: 'VERIFIED', registeredAt: longAgo(),
      });
      for (const shop of activeShops) {
        const count = shop.id === activeShops[0]!.id ? 8 : 9;
        for (let i = 0; i < count; i++) {
          await createBeneficiary({ shop, outcome: 'VERIFIED', registeredAt: longAgo() });
        }
      }
      // Recent registrations awaiting Aadhaar verification, and two failures.
      for (let i = 0; i < 4; i++) {
        await createBeneficiary({ shop: pick(activeShops), outcome: 'PENDING', registeredAt: new Date(now.getTime() - int(1, 9) * DAY) });
      }
      for (let i = 0; i < 2; i++) {
        await createBeneficiary({ shop: pick(activeShops), outcome: 'REJECTED', registeredAt: new Date(now.getTime() - int(3, 12) * DAY) });
      }

      // ── six months of stock receipts and distributions ──
      const stockLevel = new Map<string, number>(); // `${shopId}:${commodityId}` → qty (mirrors the ledger)
      const key = (shopId: string, commodityId: number) => `${shopId}:${commodityId}`;
      const dealerUserByShop = new Map(
        activeShops.map((sh) => {
          const d = [...dealerByKey.values()].find((x) => x.id === sh.dealerId)!;
          return [sh.id, { dealerId: d.id, userId: d.userId }];
        }),
      );
      let distributionCount = 0;

      for (const month of months) {
        const isCurrent = month === currentMonth;
        await tx.execute(sql`select srms_generate_quotas(${month}::date)`);
        const quotas = await tx
          .select({ beneficiaryId: s.beneficiaryQuotas.beneficiaryId, commodityId: s.beneficiaryQuotas.commodityId, allocated: s.beneficiaryQuotas.allocatedQty })
          .from(s.beneficiaryQuotas)
          .where(eq(s.beneficiaryQuotas.quotaMonth, month));
        const quotaByBen = new Map<string, { commodityId: number; allocated: number }[]>();
        for (const q of quotas) {
          const list = quotaByBen.get(q.beneficiaryId) ?? [];
          list.push({ commodityId: q.commodityId, allocated: q.allocated });
          quotaByBen.set(q.beneficiaryId, list);
        }

        // Receipts from the State Food Corporation early in the month.
        for (const shop of activeShops) {
          const dealer = dealerUserByShop.get(shop.id)!;
          const needed = new Map<number, number>();
          for (const b of bens.filter((x) => x.shopId === shop.id && x.verified)) {
            for (const q of quotaByBen.get(b.id) ?? []) needed.set(q.commodityId, (needed.get(q.commodityId) ?? 0) + q.allocated);
          }
          for (const [commodityId, need] of needed) {
            const target = Math.ceil((need * 1.05) / 10) * 10;
            const have = stockLevel.get(key(shop.id, commodityId)) ?? 0;
            let receive = Math.max(0, target - have);
            if (isCurrent && SHORT_DELIVERY_SHOPS.has(shop.shopCode)) receive = Math.round(receive * 0.72);
            if (receive > 0) {
              await setActor(dealer.userId, 'DEALER');
              await tx.insert(s.stockMovements).values({
                shopId: shop.id, commodityId, type: 'RECEIPT', quantity: receive,
                referenceNo: `SFC/${shop.shopCode}/${month.slice(0, 7).replace('-', '')}`,
                note: 'Monthly allocation from State Food Corporation godown',
                createdById: dealer.userId, occurredAt: istTime(month, int(1, 2), 10, int(0, 59)),
              });
              stockLevel.set(key(shop.id, commodityId), round3(have + receive));
            }
            await setActor(admin!.id, 'ADMIN');
            await tx
              .update(s.stock)
              .set({ monthlyQuota: target })
              .where(and(eq(s.stock.shopId, shop.id), eq(s.stock.commodityId, commodityId)));
          }
        }

        // Beneficiaries collect their ration during the month (chronological order).
        const lastDay = isCurrent ? Math.max(3, todayIst - 1) : Math.min(26, daysInMonth(month));
        const visits = bens
          .filter((b) => b.verified && quotaByBen.has(b.id) && chance(isCurrent ? 0.72 : 0.9))
          .map((b) => ({ b, at: istTime(month, int(3, lastDay), int(8, 17), int(0, 59)) }))
          .sort((x, y) => x.at.getTime() - y.at.getTime());

        for (const { b, at } of visits) {
          const dealer = dealerUserByShop.get(b.shopId)!;
          const items = (quotaByBen.get(b.id) ?? [])
            .map((q) => ({
              commodityId: q.commodityId,
              quantity: chance(0.12) ? Math.max(0.5, Math.round(q.allocated * (0.6 + rand() * 0.3) * 2) / 2) : q.allocated,
            }))
            .filter((it) => (stockLevel.get(key(b.shopId, it.commodityId)) ?? 0) >= it.quantity);
          if (items.length === 0) continue; // shop ran out — beneficiary turned away
          await setActor(dealer.userId, 'DEALER');
          const [d] = await tx
            .insert(s.distributions)
            .values({
              beneficiaryId: b.id, shopId: b.shopId, dealerId: dealer.dealerId, issuedAt: at,
              authMethod: chance(0.85) ? 'OTP' : 'BIOMETRIC', authRef: `UIDAI-${String(int(10_000_000, 99_999_999))}`,
              createdById: dealer.userId,
            })
            .returning({ id: s.distributions.id });
          await tx.insert(s.distributionItems).values(items.map((it) => ({ distributionId: d!.id, ...it })));
          for (const it of items) {
            const k = key(b.shopId, it.commodityId);
            stockLevel.set(k, round3(stockLevel.get(k)! - it.quantity));
          }
          distributionCount++;
        }

        // Fire the deferred "receipt SMS" triggers now (instead of at COMMIT) so
        // the notifications exist before we back-date and mark them delivered.
        await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
        await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
        if (!isCurrent) {
          await tx.execute(sql`
            UPDATE notifications SET created_at = ${istTime(month, 25, 18)}
            WHERE event_type = 'LOW_STOCK' AND created_at = now()::timestamptz(3)`);
        }

        // Month-end inspections: the leaky shop shows unexplained shortages.
        if (!isCurrent) {
          const official = officialByDistrict.get('PAT')!;
          await setActor(official.userId, 'OFFICIAL');
          for (const shop of activeShops) {
            for (const commodityId of [...new Set(quotas.map((q) => q.commodityId))]) {
              const k = key(shop.id, commodityId);
              const have = stockLevel.get(k) ?? 0;
              let loss = 0;
              let reason: 'INSPECTION_SHORTAGE' | 'DAMAGE' | null = null;
              if (shop.shopCode === LEAKY_SHOP && commodityById.get(commodityId)!.code !== 'SUGAR' && chance(0.75)) {
                loss = Math.min(have, Math.round(have * (0.3 + rand() * 0.3) * 2) / 2);
                reason = 'INSPECTION_SHORTAGE';
              } else if (chance(0.04)) {
                loss = Math.min(have, Math.round(int(2, 8) * 2) / 2);
                reason = 'DAMAGE';
              }
              if (reason && loss > 0) {
                await tx.insert(s.stockMovements).values({
                  shopId: shop.id, commodityId, type: 'ADJUSTMENT', reason, quantity: -loss,
                  note: reason === 'DAMAGE' ? 'Bags damaged by rain water in storage' : 'Physical verification found stock short of ledger balance',
                  referenceNo: `INSP/${shop.shopCode}/${month.slice(0, 7).replace('-', '')}`,
                  occurredAt: istTime(month, Math.min(28, daysInMonth(month)), 16),
                });
                stockLevel.set(k, round3(have - loss));
              }
            }
          }
        }
      }

      // ── complaints in every state ──
      const plan: { category: keyof typeof COMPLAINT_TEXT; status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED'; shopCode?: string }[] = [
        { category: 'SHORT_WEIGHT', status: 'IN_PROGRESS', shopCode: LEAKY_SHOP },
        { category: 'SHORT_WEIGHT', status: 'OPEN', shopCode: LEAKY_SHOP },
        { category: 'DENIED_RATION', status: 'OPEN', shopCode: 'FPS-PAT-0002' },
        { category: 'POOR_QUALITY', status: 'RESOLVED' },
        { category: 'POOR_QUALITY', status: 'OPEN' },
        { category: 'SHOP_CLOSED', status: 'RESOLVED' },
        { category: 'OVERCHARGING', status: 'IN_PROGRESS' },
        { category: 'DEALER_BEHAVIOUR', status: 'RESOLVED' },
        { category: 'OTHER', status: 'REJECTED' },
        { category: 'DENIED_RATION', status: 'RESOLVED', shopCode: 'FPS-GAY-0002' },
        { category: 'POOR_QUALITY', status: 'IN_PROGRESS' },
        { category: 'OVERCHARGING', status: 'OPEN' },
      ];
      const resolutions: Record<string, string> = {
        RESOLVED: 'Field inspection carried out; dealer warned and the shortfall was issued to the beneficiary.',
        REJECTED: 'SMS delivery logs show all messages were delivered to the registered number; no fault found.',
      };
      const verifiedBens = bens.filter((b) => b.verified);
      for (const p of plan) {
        const shop = p.shopCode ? shopRows.find((x) => x.shopCode === p.shopCode)! : pick(activeShops);
        const ben = verifiedBens.find((b) => b.shopId === shop.id && chance(0.5)) ?? verifiedBens.find((b) => b.shopId === shop.id)!;
        await setActor(ben.userId, 'BENEFICIARY');
        const [c] = await tx
          .insert(s.complaints)
          .values({
            beneficiaryId: ben.id, shopId: shop.id, category: p.category,
            description: pick(COMPLAINT_TEXT[p.category]!),
            createdAt: new Date(now.getTime() - int(2, 50) * DAY - int(0, 600) * 60_000),
          })
          .returning();
        const officialUser = [...officialByDistrict.values()].find((o) => o.id === c!.assignedOfficialId)!;
        await setActor(officialUser.userId, 'OFFICIAL');
        if (p.status !== 'OPEN') {
          await tx.update(s.complaints).set({ status: 'IN_PROGRESS' }).where(eq(s.complaints.id, c!.id));
        }
        if (p.status === 'RESOLVED' || p.status === 'REJECTED') {
          await tx
            .update(s.complaints)
            .set({ status: p.status, resolution: resolutions[p.status] })
            .where(eq(s.complaints.id, c!.id));
        }
      }

      // ── make seeded notifications historical and already delivered ──
      // (so a real SMS gateway never re-sends demo messages)
      await tx.execute(sql`
        UPDATE notifications n SET created_at = d.issue_date
        FROM distributions d WHERE n.payload ->> 'transactionId' = d.transaction_id::text`);
      await tx.execute(sql`
        UPDATE notifications n
        SET created_at = CASE n.event_type
                           WHEN 'REGISTRATION_APPROVED' THEN COALESCE(b.verified_at, b.registration_date)
                           WHEN 'REGISTRATION_REJECTED' THEN b.registration_date + interval '1 day'
                           ELSE b.registration_date
                         END
        FROM beneficiaries b
        WHERE n.beneficiary_id = b.beneficiary_id
          AND n.event_type IN ('REGISTRATION_RECEIVED', 'REGISTRATION_APPROVED', 'REGISTRATION_REJECTED')`);
      await tx.execute(sql`
        UPDATE notifications n SET created_at = c.created_at
        FROM complaints c WHERE n.payload ->> 'complaintId' = c.complaint_id::text AND n.event_type = 'COMPLAINT_FILED'`);
      await tx.execute(sql`
        UPDATE notifications SET delivery_status = 'DELIVERED', provider = 'seed', attempts = 1,
               sent_at = created_at, delivered_at = created_at + interval '4 seconds'`);

      const lowStock = await tx.execute<{ shop_code: string; commodity_name: string }>(
        sql`select shop_code, commodity_name from v_stock_status where is_low order by shop_code`,
      );
      return {
        officials: OFFICIALS.length,
        dealers: DEALERS.length,
        shops: SHOPS.length,
        beneficiaries: bens.length,
        distributions: distributionCount,
        complaints: plan.length,
        lowStock: lowStock.rows.map((r) => `${r.shop_code} ${r.commodity_name}`),
      };
    });

    console.log('✔ demo data loaded');
    console.table(summary);
    console.log(`
Demo logins
  System Admin     admin@srms.demo          ${DEMO_PASSWORDS.admin}   (or BOOTSTRAP_ADMIN_* if set)
  Govt Official    official@srms.demo       ${DEMO_PASSWORDS.official}  (state level)
                   dso.patna@srms.demo      ${DEMO_PASSWORDS.official}  (Patna district)
  Dealer           dealer@srms.demo         ${DEMO_PASSWORDS.dealer}    (3 shops in Patna)
  Beneficiary      mobile ${DEMO_BENEFICIARY_MOBILE}        (OTP is shown on screen in demo mode)
`);
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  seed().catch((err) => {
    console.error('✖ seed failed:', err);
    process.exit(1);
  });
}
