/**
 * Request schemas — the API contract. The API validates every request body /
 * query with these, and the web apps reuse them for form validation.
 */
import { z } from 'zod';
import { isValidAadhaar, isValidMobile, normalizeAadhaar } from './aadhaar';
import { CARD_TYPES, COMPLAINT_CATEGORIES } from './constants';

export const mobileSchema = z.string().trim().refine(isValidMobile, 'Enter a valid 10-digit mobile number');
export const otpSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit OTP');
export const aadhaarSchema = z
  .string()
  .transform(normalizeAadhaar)
  .refine(isValidAadhaar, 'Enter a valid 12-digit Aadhaar number');
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, 'Use YYYY-MM').transform((m) => m.slice(0, 7) + '-01');
/** Quantities in kg/litre: positive, max 3 decimals. */
export const qtySchema = z.coerce.number().positive().max(100_000).refine((n) => Math.round(n * 1000) === n * 1000, 'Max 3 decimals');
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

// ─── auth ─────────────────────────────────────────────────────────────────────
export const APPS = ['beneficiary', 'dealer', 'official', 'admin'] as const;
export type AppName = (typeof APPS)[number];

export const otpRequestSchema = z.object({ mobile: mobileSchema });
export const otpLoginSchema = z.object({ mobile: mobileSchema, otp: otpSchema });
export const staffLoginSchema = z.object({ email: z.email().transform((e) => e.toLowerCase()), password: z.string().min(1).max(200) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(200) });

export const familyMemberSchema = z.object({
  name: z.string().trim().min(2).max(120),
  relation: z.string().trim().min(2).max(40),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dateOfBirth: z.iso.date().optional(),
});

/** FR-1: name, address, mobile, Aadhaar, family details (+ mobile OTP to prove ownership). */
export const registerSchema = z.object({
  mobile: mobileSchema,
  otp: otpSchema,
  name: z.string().trim().min(2).max(120),
  guardianName: z.string().trim().max(120).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dateOfBirth: z.iso.date().optional(),
  aadhaar: aadhaarSchema,
  address: z.string().trim().min(5).max(300),
  pincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code').optional(),
  districtId: z.coerce.number().int().positive(),
  homeShopId: z.uuid().optional(),
  cardType: z.enum(CARD_TYPES).default('PHH'),
  preferredLanguage: z.enum(['en', 'hi']).default('en'),
  family: z.array(familyMemberSchema).max(20).default([]),
});

// ─── beneficiary ──────────────────────────────────────────────────────────────
export const aadhaarVerifySchema = z.object({ otp: otpSchema });
export const updateProfileSchema = z.object({
  preferredLanguage: z.enum(['en', 'hi']).optional(),
  address: z.string().trim().min(5).max(300).optional(),
  homeShopId: z.uuid().optional(),
});
export const complaintCreateSchema = z.object({
  category: z.enum(COMPLAINT_CATEGORIES),
  description: z.string().trim().min(10).max(2000),
  shopId: z.uuid().optional(),
  attachmentId: z.uuid().optional(),
});

// ─── dealer ───────────────────────────────────────────────────────────────────
export const distributionItemSchema = z.object({ commodityId: z.coerce.number().int().positive(), quantity: qtySchema });
/** FR-3. Online issues carry the beneficiary's OTP; offline ones carry clientRef + capturedOfflineAt. */
export const distributionCreateSchema = z.object({
  shopId: z.uuid(),
  beneficiaryId: z.uuid(),
  items: z.array(distributionItemSchema).min(1).max(20),
  otp: otpSchema.optional(),
  clientRef: z.uuid().optional(),
  capturedOfflineAt: z.iso.datetime({ offset: true }).optional(),
});
export const stockReceiptSchema = z.object({
  shopId: z.uuid(),
  commodityId: z.coerce.number().int().positive(),
  quantity: qtySchema,
  referenceNo: z.string().trim().min(2).max(60),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().trim().max(300).optional(),
  clientRef: z.uuid().optional(),
});

// ─── official ─────────────────────────────────────────────────────────────────
export const complaintUpdateSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']).optional(),
  resolution: z.string().trim().min(5).max(2000).optional(),
  note: z.string().trim().min(2).max(2000).optional(),
});
/** Physical stock verification: the difference to the ledger becomes an adjustment (leakage signal). */
export const inspectionSchema = z.object({
  shopId: z.uuid(),
  commodityId: z.coerce.number().int().positive(),
  physicalQuantity: z.coerce.number().min(0).max(1_000_000),
  note: z.string().trim().min(3).max(300),
});
export const voidSchema = z.object({ reason: z.string().trim().min(5).max(300) });
export const beneficiaryReviewSchema = z.object({
  cardType: z.enum(CARD_TYPES).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  homeShopId: z.uuid().nullable().optional(),
});

// ─── admin ────────────────────────────────────────────────────────────────────
const staffBase = {
  name: z.string().trim().min(2).max(120),
  email: z.email().transform((e) => e.toLowerCase()),
  mobile: mobileSchema,
};
export const dealerCreateSchema = z.object({
  ...staffBase,
  licenseNo: z.string().trim().min(3).max(40),
  licenseValidUntil: z.iso.date().optional(),
  districtId: z.coerce.number().int().positive(),
  address: z.string().trim().max(300).optional(),
});
export const dealerUpdateSchema = dealerCreateSchema
  .omit({ email: true })
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional() });
export const officialCreateSchema = z.object({
  ...staffBase,
  designation: z.string().trim().min(2).max(80),
  districtId: z.coerce.number().int().positive().nullable().default(null),
});
export const officialUpdateSchema = officialCreateSchema.omit({ email: true }).partial();
export const shopCreateSchema = z.object({
  shopCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/, 'Letters, digits and hyphens only'),
  name: z.string().trim().min(3).max(120),
  address: z.string().trim().min(5).max(300),
  districtId: z.coerce.number().int().positive(),
  dealerId: z.uuid().nullable().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});
export const shopUpdateSchema = shopCreateSchema
  .omit({ shopCode: true })
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
export const shopQuotasSchema = z.object({
  items: z.array(z.object({ commodityId: z.coerce.number().int().positive(), monthlyQuota: z.coerce.number().min(0).max(10_000_000) })).min(1),
});
export const commoditySchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z_]{2,20}$/),
  name: z.string().trim().min(2).max(60),
  nameHi: z.string().trim().max(60).optional(),
  unit: z.enum(['KG', 'LITRE', 'PACKET']).default('KG'),
  pricePerUnit: z.coerce.number().min(0).max(100_000).default(0),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});
export const entitlementSchema = z.object({
  rules: z.array(
    z.object({
      commodityId: z.coerce.number().int().positive(),
      cardType: z.enum(CARD_TYPES),
      qtyPerMember: z.coerce.number().min(0).max(1000),
      qtyPerFamily: z.coerce.number().min(0).max(1000),
      isActive: z.boolean().default(true),
    }),
  ),
});
export const settingsUpdateSchema = z
  .object({
    low_stock_pct: z.number().int().min(1).max(90),
    max_shops_per_dealer: z.number().int().min(1).max(20),
    otp_ttl_seconds: z.number().int().min(60).max(1800),
    require_pos_otp: z.boolean(),
    offline_max_hours: z.number().int().min(1).max(720),
    sms_enabled: z.boolean(),
    state_name: z.string().trim().min(2).max(60),
  })
  .partial();
export const userStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']) });
