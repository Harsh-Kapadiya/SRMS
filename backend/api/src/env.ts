import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),
  /** HMAC key for OTP hashes. 32+ random characters. */
  APP_SECRET: z.string().min(32),
  AADHAAR_ENC_KEY: z.string().min(40),
  AADHAAR_HASH_PEPPER: z.string().min(16),
  /** Extra browser origins allowed to call the API directly (the web apps normally proxy /api). */
  CORS_ORIGINS: z.string().default(''),
  /** Demo mode: OTPs are returned in API responses so the system can be tried without SMS. */
  DEMO_MODE: z.stringbool().default(false),
  SMS_PROVIDER: z.enum(['log', 'twilio', 'fast2sms']).default('log'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  FAST2SMS_API_KEY: z.string().optional(),
  WORKER_ENABLED: z.stringbool().default(true),
  /** Proxy hops in front of the API (Vercel rewrite → Render). Used for client IPs / rate limits. */
  TRUST_PROXY: z.coerce.number().int().default(2),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
