/**
 * One-time passwords for: beneficiary login/registration (LOGIN), mock UIDAI
 * Aadhaar verification (AADHAAR_VERIFY) and point-of-sale authentication at
 * the shop (DISTRIBUTION_AUTH). Only an HMAC of the code is stored.
 *
 * ponytail: the real UIDAI API needs an AUA/KUA licence; this mock sends the
 * OTP to the beneficiary's registered mobile instead. Swap `sendOtp` for the
 * UIDAI Auth API call when a licence is available.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { RULES } from '@srms/shared';
import { db } from './db';
import { env } from './env';
import { HttpError } from './http';

type Purpose = 'LOGIN' | 'AADHAAR_VERIFY' | 'DISTRIBUTION_AUTH';

const hmac = (purpose: Purpose, target: string, code: string) =>
  createHmac('sha256', env.APP_SECRET).update(`${purpose}:${target}:${code}`).digest('hex');

const MESSAGES: Record<Purpose, (code: string) => string> = {
  LOGIN: (c) => `${c} is your SRMS login OTP. It is valid for 5 minutes. Do not share it with anyone.`,
  AADHAAR_VERIFY: (c) => `${c} is your Aadhaar authentication OTP for SRMS ration card verification (UIDAI demo). Valid for 5 minutes.`,
  DISTRIBUTION_AUTH: (c) => `${c} is your OTP to collect ration at the shop. Share it with the dealer only when you receive your ration.`,
};

/**
 * Create an OTP and queue it as SMS. Returns the code only in DEMO_MODE (so the
 * system can be tried without an SMS gateway).
 */
export async function sendOtp(purpose: Purpose, target: string, mobile: string): Promise<{ devOtp?: string }> {
  const { rows } = await db.execute<{ n: string }>(sql`
    select count(*) as n from otp_challenges
    where purpose = ${purpose} and target = ${target} and created_at > now() - interval '10 minutes'`);
  if (Number(rows[0]!.n) >= 5) throw new HttpError(429, 'Too many OTP requests. Please wait 10 minutes.', 'OTP_RATE_LIMIT');

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.execute(sql`
    insert into otp_challenges (purpose, target, code_hash, expires_at, max_attempts)
    values (${purpose}, ${target}, ${hmac(purpose, target, code)},
            now() + make_interval(secs => ${RULES.OTP_TTL_SECONDS}), ${RULES.OTP_MAX_ATTEMPTS})`);
  await db.execute(sql`
    insert into notifications (mobile, event_type, message) values (${mobile}, 'OTP', ${MESSAGES[purpose](code)})`);
  return env.DEMO_MODE ? { devOtp: code } : {};
}

/**
 * Check an OTP against the latest live challenge. With consume=false the OTP
 * stays usable (the registration flow checks it, then consumes on submit).
 * Returns the challenge id (used as the auth reference).
 */
export async function checkOtp(purpose: Purpose, target: string, code: string, consume = true): Promise<string> {
  const { rows } = await db.execute<{ id: string; code_hash: string; attempts: number; max_attempts: number }>(sql`
    select id, code_hash, attempts, max_attempts from otp_challenges
    where purpose = ${purpose} and target = ${target} and consumed_at is null and expires_at > now()
    order by created_at desc limit 1`);
  const ch = rows[0];
  if (!ch) throw new HttpError(400, 'OTP expired or not requested. Please request a new OTP.', 'OTP_EXPIRED');
  if (ch.attempts >= ch.max_attempts) throw new HttpError(429, 'Too many wrong attempts. Please request a new OTP.', 'OTP_LOCKED');

  const ok = timingSafeEqual(Buffer.from(ch.code_hash), Buffer.from(hmac(purpose, target, code)));
  if (!ok) {
    await db.execute(sql`update otp_challenges set attempts = attempts + 1 where id = ${ch.id}`);
    throw new HttpError(400, 'Incorrect OTP', 'OTP_INVALID');
  }
  if (consume) {
    const upd = await db.execute(sql`update otp_challenges set consumed_at = now() where id = ${ch.id} and consumed_at is null`);
    if (upd.rowCount === 0) throw new HttpError(400, 'OTP already used', 'OTP_EXPIRED');
  }
  return ch.id;
}
