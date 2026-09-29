import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { and, eq, sql } from 'drizzle-orm';
import { beneficiaries, familyMembers, hashPassword, passwordProblems, shops, users, verifyPassword, withActor } from '@srms/db';
import { protectAadhaar } from '@srms/db/crypto';
import { changePasswordSchema, otpLoginSchema, otpRequestSchema, registerSchema, staffLoginSchema } from '@srms/shared';
import { db } from './db';
import { env } from './env';
import { APP_ROLE, HttpError, appFromRequest, audit, endSession, parse, requireRole, startSession } from './http';
import { checkOtp, sendOtp } from './otp';
import { profileFor } from './profile';

export const authRouter = Router();

// Unknown emails still pay for one hash, so response time doesn't reveal which accounts exist.
const DUMMY_HASH = hashPassword('timing-equaliser-not-a-real-password');

// Brute-force protection for everything under /auth (per client IP).
authRouter.use(
  rateLimit({ windowMs: 10 * 60_000, limit: env.NODE_ENV === 'test' ? 10_000 : 60, standardHeaders: 'draft-8', legacyHeaders: false }),
);

const beneficiaryApp = (req: Parameters<typeof appFromRequest>[0]) => {
  if (appFromRequest(req) !== 'beneficiary') throw new HttpError(400, 'OTP login is only for the beneficiary app', 'BAD_APP');
};

/** Step 1 (login or registration): send an OTP to the mobile number. */
authRouter.post('/otp', async (req, res) => {
  beneficiaryApp(req);
  const { mobile } = parse(otpRequestSchema, req.body);
  res.json({ sent: true, ...(await sendOtp('LOGIN', mobile, mobile)) });
});

/**
 * Step 2: verify the OTP. Registered → logged in. Not registered → the OTP is
 * kept alive and the app shows the registration form (POST /auth/register).
 */
authRouter.post('/otp/verify', async (req, res) => {
  beneficiaryApp(req);
  const { mobile, otp } = parse(otpLoginSchema, req.body);
  const [user] = await db.select().from(users).where(and(eq(users.role, 'BENEFICIARY'), eq(users.mobile, mobile)));
  await checkOtp('LOGIN', mobile, otp, Boolean(user));
  if (!user) {
    res.json({ needsRegistration: true });
    return;
  }
  if (user.status !== 'ACTIVE') throw new HttpError(403, 'This account is suspended. Please contact your district supply office.', 'SUSPENDED');
  await startSession(req, res, user.id, 'beneficiary');
  await audit(req, 'LOGIN', 'users', user.id, { app: 'beneficiary' }, user.id, 'BENEFICIARY');
  res.json({ user: await profileFor(user.id) });
});

/** FR-1: register a beneficiary (status PENDING until Aadhaar verification). */
authRouter.post('/register', async (req, res) => {
  beneficiaryApp(req);
  const body = parse(registerSchema, req.body);

  if (body.homeShopId) {
    const [shop] = await db.select().from(shops).where(eq(shops.id, body.homeShopId));
    if (!shop || shop.status !== 'ACTIVE') throw new HttpError(422, 'Selected ration shop is not active', 'SHOP_INACTIVE');
    if (shop.districtId !== body.districtId) throw new HttpError(422, 'Selected ration shop is not in your district', 'SHOP_DISTRICT_MISMATCH');
  }
  const aadhaar = protectAadhaar(body.aadhaar);
  const [dupe] = await db.select({ id: beneficiaries.id }).from(beneficiaries).where(eq(beneficiaries.aadhaarHash, aadhaar.aadhaarHash));
  if (dupe) throw new HttpError(409, 'This Aadhaar number is already registered', 'DUPLICATE_AADHAAR');
  await checkOtp('LOGIN', body.mobile, body.otp);

  const userId = await withActor(db, null, async (tx) => {
    const [user] = await tx.insert(users).values({ role: 'BENEFICIARY', fullName: body.name, mobile: body.mobile }).returning();
    await tx.execute(sql`select set_config('srms.user_id', ${user!.id}, true), set_config('srms.role', 'BENEFICIARY', true)`);
    const [ben] = await tx
      .insert(beneficiaries)
      .values({
        userId: user!.id,
        ...aadhaar,
        name: body.name,
        guardianName: body.guardianName,
        gender: body.gender,
        dateOfBirth: body.dateOfBirth,
        mobile: body.mobile,
        address: body.address,
        pincode: body.pincode,
        districtId: body.districtId,
        homeShopId: body.homeShopId,
        cardType: body.cardType,
        preferredLanguage: body.preferredLanguage,
      })
      .returning();
    await tx.insert(familyMembers).values([
      { beneficiaryId: ben!.id, name: body.name, relation: 'Self', gender: body.gender, dateOfBirth: body.dateOfBirth, aadhaarLast4: aadhaar.aadhaarLast4, isHead: true },
      ...body.family.map((f) => ({ beneficiaryId: ben!.id, ...f })),
    ]);
    return user!.id;
  });
  await startSession(req, res, userId, 'beneficiary');
  res.status(201).json({ user: await profileFor(userId) });
});

/** Staff login (dealer / official / admin), each only into their own app. */
authRouter.post('/login', async (req, res) => {
  const app = appFromRequest(req);
  if (app === 'beneficiary') throw new HttpError(400, 'Beneficiaries log in with mobile OTP', 'BAD_APP');
  const { email, password } = parse(staffLoginSchema, req.body);
  const [user] = await db.select().from(users).where(eq(users.email, email));

  const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH)) && Boolean(user?.passwordHash);
  if (!user || !ok || user.role !== APP_ROLE[app]) {
    await audit(req, 'LOGIN_FAILED', 'users', user?.id, { app, email }, user?.id, user?.role);
    throw new HttpError(401, 'Incorrect email or password', 'BAD_CREDENTIALS');
  }
  if (user.status !== 'ACTIVE') throw new HttpError(403, 'This account is not active. Please contact the system administrator.', 'SUSPENDED');
  await startSession(req, res, user.id, app);
  await audit(req, 'LOGIN', 'users', user.id, { app }, user.id, user.role);
  res.json({ user: await profileFor(user.id) });
});

authRouter.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Please log in', 'UNAUTHENTICATED');
  res.json({ user: await profileFor(req.user.id) });
});

authRouter.post('/change-password', requireRole('DEALER', 'OFFICIAL', 'ADMIN'), async (req, res) => {
  const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
  const problems = passwordProblems(newPassword);
  if (problems.length) throw new HttpError(422, `Password needs ${problems.join(', ')}`, 'WEAK_PASSWORD');
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.id));
  if (!user?.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new HttpError(401, 'Current password is incorrect', 'BAD_CREDENTIALS');
  }
  await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, user.id));
  // Log out every other session of this user.
  await db.execute(sql`delete from sessions where user_id = ${user.id} and id <> ${req.user!.sessionId}`);
  await audit(req, 'PASSWORD_CHANGED', 'users', user.id);
  res.json({ ok: true });
});
