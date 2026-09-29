/**
 * End-to-end API tests over HTTP: the full lifecycle from admin onboarding a
 * dealer, to a beneficiary registering + Aadhaar verification, to ration being
 * issued (online and offline), complaints, inspections, reports and RBAC.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeAadhaar } from '@srms/shared';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://srms:srms@localhost:5432/srms_test';
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_URL,
  APP_SECRET: randomBytes(32).toString('base64url'),
  AADHAAR_ENC_KEY: randomBytes(32).toString('base64'),
  AADHAAR_HASH_PEPPER: 'api-test-pepper-0123456789',
  DEMO_MODE: 'true',
  BOOTSTRAP_ADMIN_EMAIL: 'admin@test.local',
  BOOTSTRAP_ADMIN_PASSWORD: 'Admin-Test-123',
});

const { createPool, createDb } = await import('@srms/db');
const { runMigrations } = await import('@srms/db/migrate');
const { bootstrap } = await import('@srms/db/bootstrap');
const { createApp } = await import('../src/app');
const { deliverQueued } = await import('../src/sms');
const { pool } = await import('../src/db');

const reset = createPool(TEST_URL);
await reset.query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await reset.end();
await runMigrations(TEST_URL);
{
  const p = createPool(TEST_URL);
  await bootstrap(createDb(p), () => undefined);
  await p.end();
}

const app = createApp();
/** A logged-in client of one web app (keeps its own cookie jar). */
const client = (name: 'beneficiary' | 'dealer' | 'official' | 'admin') => {
  const agent = request.agent(app);
  const h = (r: request.Test) => r.set('x-srms-app', name);
  return {
    get: (url: string) => h(agent.get(url)),
    post: (url: string, body?: object) => h(agent.post(url)).send(body ?? {}),
    patch: (url: string, body: object) => h(agent.patch(url)).send(body),
    put: (url: string, body: object) => h(agent.put(url)).send(body),
    raw: (url: string, type: string, data: Buffer) => h(agent.post(url)).set('content-type', type).send(data),
  };
};

const admin = client('admin');
const dealer = client('dealer');
const official = client('official');
const ben = client('beneficiary');
let patna: number;
let gaya: number;
let RICE: number;
let WHEAT: number;
let dealerId: string;
let shopId: string;
let beneficiaryId: string;
let rationCardNo: string;
let firstReceiptId: string;

afterAll(async () => pool.end());

describe('admin onboarding (FR-5)', () => {
  it('logs in and creates an official, a dealer and a shop with monthly quotas', async () => {
    expect((await admin.post('/auth/login', { email: 'admin@test.local', password: 'Admin-Test-123' })).status).toBe(200);
    const districts = (await request(app).get('/public/districts')).body as { id: number; code: string }[];
    patna = districts.find((d) => d.code === 'PAT')!.id;
    gaya = districts.find((d) => d.code === 'GAY')!.id;
    const commodities = (await request(app).get('/public/commodities')).body as { id: number; code: string }[];
    RICE = commodities.find((c) => c.code === 'RICE')!.id;
    WHEAT = commodities.find((c) => c.code === 'WHEAT')!.id;

    const o = await admin.post('/admin/officials', { name: 'DSO Patna', email: 'dso@test.local', mobile: '9000000001', designation: 'District Supply Officer', districtId: patna });
    expect(o.status).toBe(201);
    await official.post('/auth/login', { email: 'dso@test.local', password: o.body.login.temporaryPassword }).expect(200);

    const d = await admin.post('/admin/dealers', { name: 'Test Dealer', email: 'Dealer@Test.local', mobile: '9000000002', licenseNo: 'BR/PAT/T/1', districtId: patna });
    expect(d.status).toBe(201);
    dealerId = d.body.dealer.id;
    await dealer.post('/auth/login', { email: 'dealer@test.local', password: d.body.login.temporaryPassword }).expect(200);

    const s = await admin.post('/admin/shops', { shopCode: 'fps-t-1', name: 'Test Fair Price Shop', address: 'Main Road, Patna', districtId: patna, dealerId });
    expect(s.status).toBe(201);
    expect(s.body.shopCode).toBe('FPS-T-1');
    shopId = s.body.id;
    const q = await admin.put(`/admin/shops/${shopId}/quotas`, { items: [{ commodityId: RICE, monthlyQuota: 100 }, { commodityId: WHEAT, monthlyQuota: 100 }] });
    expect(q.body.map((x: { lowStockThreshold: number }) => x.lowStockThreshold)).toEqual([20, 20]);
  });

  it('enforces the 3-shop and same-district rules with clear errors', async () => {
    for (const code of ['FPS-T-2', 'FPS-T-3']) {
      await admin.post('/admin/shops', { shopCode: code, name: 'Shop', address: 'Patna address', districtId: patna, dealerId }).expect(201);
    }
    const fourth = await admin.post('/admin/shops', { shopCode: 'FPS-T-4', name: 'Shop', address: 'Patna address', districtId: patna, dealerId });
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe('DEALER_SHOP_LIMIT');
    const other = await admin.post('/admin/shops', { shopCode: 'FPS-T-5', name: 'Shop', address: 'Gaya address', districtId: gaya, dealerId });
    expect(other.body.error.code).toBe('SHOP_DISTRICT_MISMATCH');
    const dup = await admin.post('/admin/dealers', { name: 'Dup Dealer', email: 'dealer@test.local', mobile: '9000000003', licenseNo: 'LIC-2', districtId: patna });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe('This email is already in use');
  });

  it('rejects a staff member logging into another role’s app', async () => {
    const r = await client('admin').post('/auth/login', { email: 'dealer@test.local', password: 'whatever' });
    expect(r.status).toBe(401);
  });
});

describe('dealer stock (FR-4)', () => {
  it('records a godown receipt through the ledger', async () => {
    const r = await dealer.post('/dealer/stock/receipts', { shopId, commodityId: RICE, quantity: 100, referenceNo: 'SFC/1' });
    expect(r.status).toBe(201);
    expect(r.body.balanceAfter).toBe(100);
    await dealer.post('/dealer/stock/receipts', { shopId, commodityId: WHEAT, quantity: 100, referenceNo: 'SFC/2' }).expect(201);
  });
});

describe('beneficiary registration and Aadhaar verification (FR-1, FR-2)', () => {
  const aadhaar = makeAadhaar('23456789123');

  it('registers with mobile OTP, then verifies Aadhaar with the mock UIDAI OTP', async () => {
    const otp = (await ben.post('/auth/otp', { mobile: '9123456789' })).body.devOtp;
    expect(otp).toMatch(/^\d{6}$/);
    expect((await ben.post('/auth/otp/verify', { mobile: '9123456789', otp })).body).toEqual({ needsRegistration: true });

    const reg = await ben.post('/auth/register', {
      mobile: '9123456789', otp, name: 'Sita Devi', aadhaar: `${aadhaar.slice(0, 4)} ${aadhaar.slice(4, 8)} ${aadhaar.slice(8)}`,
      address: 'Ward 4, Kankarbagh, Patna', pincode: '800020', districtId: patna, homeShopId: shopId, cardType: 'PHH', gender: 'FEMALE',
      family: [{ name: 'Ram Kumar', relation: 'Spouse' }, { name: 'Aman', relation: 'Son' }, { name: 'Priya', relation: 'Daughter' }],
    });
    expect(reg.status).toBe(201);
    const b = reg.body.user.beneficiary;
    expect(b.verificationStatus).toBe('PENDING');
    expect(b.aadhaarMasked).toBe(`XXXX XXXX ${aadhaar.slice(-4)}`);
    expect(JSON.stringify(reg.body)).not.toContain(aadhaar);
    expect(b.familySize).toBe(4);
    beneficiaryId = b.id;

    expect((await ben.get('/me/entitlement')).body.lines).toEqual([]);
    const aOtp = (await ben.post('/me/aadhaar/otp')).body.devOtp;
    expect((await ben.post('/me/aadhaar/verify', { otp: aOtp === '000000' ? '111111' : '000000' })).status).toBe(400);
    const v = await ben.post('/me/aadhaar/verify', { otp: aOtp });
    expect(v.status).toBe(200);
    expect(v.body.user.beneficiary.verificationStatus).toBe('VERIFIED');
    rationCardNo = v.body.user.beneficiary.rationCardNo;
    expect(rationCardNo).toMatch(/^\d{12}$/);

    const ent = await ben.get('/me/entitlement');
    expect(ent.body.lines.map((l: { code: string; allocated: number }) => [l.code, l.allocated])).toEqual([['RICE', 12], ['WHEAT', 8]]);
  });

  it('refuses a second registration with the same Aadhaar', async () => {
    const other = client('beneficiary');
    const otp = (await other.post('/auth/otp', { mobile: '9123456780' })).body.devOtp;
    const r = await other.post('/auth/register', { mobile: '9123456780', otp, name: 'Someone Else', aadhaar, address: 'Somewhere in Patna', districtId: patna });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DUPLICATE_AADHAAR');
  });

  it('rejects invalid Aadhaar numbers (Verhoeff checksum)', async () => {
    const bad = `${aadhaar.slice(0, 11)}${(Number(aadhaar[11]) + 1) % 10}`;
    const r = await client('beneficiary').post('/auth/register', { mobile: '9123456781', otp: '123456', name: 'X Y', aadhaar: bad, address: 'Somewhere', districtId: patna });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Aadhaar/);
  });
});

describe('ration distribution (FR-3, NFR-2)', () => {
  it('looks up the beneficiary with eligibility, quota and stock', async () => {
    const r = await dealer.get(`/dealer/lookup?shopId=${shopId}&q=${rationCardNo}`);
    expect(r.body.eligible).toBe(true);
    expect(r.body.lines.map((l: { maxIssuable: number }) => l.maxIssuable)).toEqual([12, 8]);
  });

  it('requires the beneficiary OTP and issues ration with a receipt', async () => {
    const noOtp = await dealer.post('/dealer/distributions', { shopId, beneficiaryId, items: [{ commodityId: RICE, quantity: 12 }] });
    expect(noOtp.body.error.code).toBe('OTP_REQUIRED');

    const otp = (await dealer.post('/dealer/auth-otp', { shopId, beneficiaryId })).body.devOtp;
    const r = await dealer.post('/dealer/distributions', { shopId, beneficiaryId, otp, items: [{ commodityId: RICE, quantity: 12 }, { commodityId: WHEAT, quantity: 5 }] });
    expect(r.status).toBe(201);
    expect(r.body.receiptNo).toMatch(/^RCPT-\d{6}-\d{7}$/);
    expect(r.body.items.map((i: { quantity: number }) => i.quantity)).toEqual([12, 5]);
    firstReceiptId = r.body.id;

    const again = await dealer.post('/dealer/distributions', { shopId, beneficiaryId, otp, items: [{ commodityId: WHEAT, quantity: 1 }] });
    expect(again.body.error.code).toBe('OTP_EXPIRED'); // one OTP, one transaction
    const otp2 = (await dealer.post('/dealer/auth-otp', { shopId, beneficiaryId })).body.devOtp;
    const over = await dealer.post('/dealer/distributions', { shopId, beneficiaryId, otp: otp2, items: [{ commodityId: RICE, quantity: 1 }] });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('syncs offline transactions idempotently and flags conflicts', async () => {
    const tx = { shopId, beneficiaryId, items: [{ commodityId: WHEAT, quantity: 3 }], clientRef: crypto.randomUUID(), capturedOfflineAt: new Date(Date.now() - 3_600_000).toISOString() };
    const first = await dealer.post('/dealer/distributions', tx);
    expect(first.status).toBe(201);
    expect(first.body.authMethod).toBe('OFFLINE');
    const replay = await dealer.post('/dealer/distributions', tx);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);

    const conflict = await dealer.post('/dealer/distributions', { ...tx, clientRef: crypto.randomUUID() });
    expect(conflict.status).toBe(409); // wheat quota already used up
  });

  it('shows the beneficiary their history, receipt and SMS', async () => {
    const list = await ben.get('/me/distributions');
    expect(list.body.total).toBe(2);
    const receipt = await ben.get(`/me/distributions/${firstReceiptId}`);
    expect(receipt.body.shop.code).toBe('FPS-T-1');
    const notes = await ben.get('/me/notifications');
    expect(notes.body.items.map((n: { event: string }) => n.event)).toEqual(
      expect.arrayContaining(['REGISTRATION_RECEIVED', 'REGISTRATION_APPROVED', 'RATION_ISSUED']),
    );
  });
});

describe('complaints (FR-9)', () => {
  let complaintId: string;

  it('files a complaint with evidence, routed to the district official', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const up = await ben.raw('/me/attachments', 'image/png', png);
    expect(up.status).toBe(201);
    const c = await ben.post('/me/complaints', { category: 'SHORT_WEIGHT', description: 'I received less wheat than shown on my receipt.', attachmentId: up.body.id });
    expect(c.status).toBe(201);
    expect(c.body.ticketNo).toMatch(/^CMP-/);
    expect(c.body.assignedOfficial.name).toBe('DSO Patna');
    complaintId = c.body.id;
  });

  it('lets the official resolve it (resolution note required) and download the evidence', async () => {
    const list = await official.get('/official/complaints?status=OPEN');
    expect(list.body.items[0].id).toBe(complaintId);
    const noNote = await official.patch(`/official/complaints/${complaintId}`, { status: 'RESOLVED' });
    expect(noNote.body.error.code).toBe('INVALID_TRANSITION');
    const done = await official.patch(`/official/complaints/${complaintId}`, { status: 'RESOLVED', resolution: 'Weighed again at the shop; 1 kg wheat issued.' });
    expect(done.body.status).toBe('RESOLVED');
    expect(done.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual(['OPEN', 'RESOLVED']);
    const file = await official.get(`/official/complaints/${complaintId}/attachment`);
    expect(file.headers['content-type']).toBe('image/png');
  });
});

describe('official monitoring (FR-6, FR-8, R19)', () => {
  it('records an inspection shortage, which shows up as leakage on the dashboard', async () => {
    const insp = await official.post('/official/inspections', { shopId, commodityId: RICE, physicalQuantity: 80, note: 'Counted 80 kg in storage' });
    expect(insp.status).toBe(201);
    expect(insp.body.difference).toBe(-8); // ledger said 88
    const dash = await official.get('/official/dashboard');
    expect(dash.body.kpis.served).toBe(1);
    expect(dash.body.kpis.coveragePct).toBe(100);
    expect(dash.body.kpis.leakagePct).toBe(4); // 8 of 200 kg received
    expect(dash.body.leakageShops[0].shopCode).toBe('FPS-T-1');
    expect(dash.body.trend).toHaveLength(6);
  });

  it('exports the monthly report as Excel', async () => {
    const r = await official.get('/official/reports/monthly?format=xlsx').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.headers['content-type']).toContain('spreadsheetml');
    expect((r.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const json = await official.get('/official/reports/monthly');
    const rice = json.body.lines.find((l: { shopCode: string; code: string }) => l.shopCode === 'FPS-T-1' && l.code === 'RICE');
    expect([rice.received, rice.issued, rice.leakage, rice.closing]).toEqual([100, 12, 8, 80]);
  });

  it('voids a wrong transaction, returning stock and quota', async () => {
    const v = await official.post(`/official/distributions/${firstReceiptId}/void`, { reason: 'Entered for the wrong beneficiary' });
    expect(v.body.status).toBe('VOIDED');
    const ent = await ben.get('/me/entitlement');
    expect(ent.body.lines.find((l: { code: string }) => l.code === 'RICE').remaining).toBe(12);
  });
});

describe('access control', () => {
  it('keeps roles in their lanes', async () => {
    expect((await dealer.get('/official/dashboard')).status).toBe(403);
    expect((await official.get('/admin/overview')).status).toBe(403);
    expect((await ben.get('/dealer/shops')).status).toBe(403);
    expect((await request(app).get('/me/entitlement').set('x-srms-app', 'beneficiary')).status).toBe(401);
    expect((await request(app).get('/auth/me')).status).toBe(401); // no app header → no session
  });

  it('stops a suspended dealer immediately', async () => {
    await admin.patch(`/admin/dealers/${dealerId}`, { status: 'SUSPENDED' }).expect(200);
    expect((await dealer.get('/dealer/shops')).status).toBe(401);
  });

  it('keeps an audit trail of logins and admin changes', async () => {
    const logs = await admin.get('/admin/audit-logs?pageSize=200');
    const actions = new Set(logs.body.items.map((l: { action: string; entity: string }) => `${l.action}:${l.entity}`));
    expect(actions).toContain('LOGIN:users');
    expect(actions).toContain('INSERT:dealers');
    expect(actions).toContain('UPDATE:dealers');
    expect(actions).toContain('EXPORT_REPORT:reports');
  });
});

describe('SMS outbox (FR-7)', () => {
  it('delivers queued messages and redacts OTPs after sending', async () => {
    let sent = 0;
    while (true) {
      const n = await deliverQueued();
      sent += n;
      if (n < 25) break;
    }
    expect(sent).toBeGreaterThan(5);
    const queue = await admin.get('/admin/notifications?status=QUEUED');
    expect(queue.body.total).toBe(0);
    const otps = await admin.get('/admin/notifications?pageSize=200');
    for (const n of otps.body.items.filter((x: { event: string }) => x.event === 'OTP')) expect(n.message).not.toMatch(/\d{6}/);
  });
});

