/**
 * Business constants from the finalised SRS (Software Requirement Analysis,
 * Step 2 corrections). The database reads the live values from the `settings`
 * table; these are the defaults written by bootstrap and used for UI copy.
 */
export const RULES = {
  /** R5 (corrected): alert when available stock < 20% of the shop's monthly quota. */
  LOW_STOCK_PCT: 20,
  /** R11 (corrected): a dealer may run at most 3 shops, all in their own district. */
  MAX_SHOPS_PER_DEALER: 3,
  /** OTP lifetime for login / Aadhaar verification / point-of-sale auth. */
  OTP_TTL_SECONDS: 300,
  OTP_MAX_ATTEMPTS: 5,
  /** NFR-3: 95% of transactions within 3 s. Used as the API latency budget. */
  RESPONSE_BUDGET_MS: 3000,
  /** Complaint evidence upload cap. */
  MAX_ATTACHMENT_BYTES: 1_000_000,
} as const;

/** All ration months are computed in Indian Standard Time. */
export const TIMEZONE = 'Asia/Kolkata';

export const ROLES = ['BENEFICIARY', 'DEALER', 'OFFICIAL', 'ADMIN'] as const;
export type RoleName = (typeof ROLES)[number];

export const CARD_TYPES = ['AAY', 'PHH'] as const;
export type CardTypeName = (typeof CARD_TYPES)[number];

export const COMPLAINT_CATEGORIES = [
  'DEALER_BEHAVIOUR',
  'SHORT_WEIGHT',
  'POOR_QUALITY',
  'OVERCHARGING',
  'SHOP_CLOSED',
  'DENIED_RATION',
  'OTHER',
] as const;
export type ComplaintCategoryName = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'] as const;
export type ComplaintStatusName = (typeof COMPLAINT_STATUSES)[number];

/**
 * Error codes raised by database triggers. Postgres messages start with
 * "SRMS_<CODE>:" so the API can translate them into 4xx responses.
 */
export const DB_ERROR_CODES = {
  DEALER_SHOP_LIMIT: 409,
  SHOP_DISTRICT_MISMATCH: 422,
  DEALER_INACTIVE: 409,
  INSUFFICIENT_STOCK: 409,
  STOCK_DIRECT_UPDATE: 403,
  NO_QUOTA: 409,
  QUOTA_EXCEEDED: 409,
  BENEFICIARY_NOT_ELIGIBLE: 409,
  SHOP_INACTIVE: 409,
  DEALER_SHOP_MISMATCH: 403,
  IMMUTABLE_RECORD: 403,
  INVALID_TRANSITION: 409,
  INVALID_MOVEMENT: 422,
  ROLE_MISMATCH: 422,
} as const;
export type DbErrorCode = keyof typeof DB_ERROR_CODES;
