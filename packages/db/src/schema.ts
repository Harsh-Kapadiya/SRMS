/**
 * =============================================================================
 * Smart Ration Distribution Monitoring System (SRMS) — database schema
 *
 * Derived from the LLD "Database Layouts & Table Column Specifications"
 * (Beneficiary, Dealer, Shop, Commodity, Stock, BeneficiaryQuota,
 * Distribution, Complaint, Notification, AuditLog) and DFD data stores D1–D7,
 * extended with what production needs: authentication, sessions/OTP,
 * districts, entitlement rules, an immutable stock ledger and complaint
 * history.
 *
 * Rules that must never be bypassed (≤3 shops per dealer in the dealer's own
 * district, quota limits, non-negative stock, ledger-only stock changes, the
 * 20% low-stock alert, immutable audit/ledger rows) are enforced INSIDE
 * Postgres by triggers in migrations/0001_business_rules.sql.
 *
 * Naming: camelCase in TypeScript, snake_case in SQL.
 * =============================================================================
 */
import { relations, sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Column helpers ──────────────────────────────────────────────────────────

const tstz = (name: string) => timestamp(name, { withTimezone: true, precision: 3, mode: 'date' });
const createdAt = () => tstz('created_at').notNull().defaultNow();
const updatedAt = () =>
  tstz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Quantities in the commodity's unit (kg / litre), 3 decimals. */
const qty = (name: string, precision = 12) =>
  numeric(name, { precision, scale: 3, mode: 'number' });
const money = (name: string) => numeric(name, { precision: 10, scale: 2, mode: 'number' });
const mobile = (name = 'mobile') => varchar(name, { length: 10 });

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// ─── Enums ───────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum('role', ['BENEFICIARY', 'DEALER', 'OFFICIAL', 'ADMIN']);
export const accountStatusEnum = pgEnum('account_status', ['ACTIVE', 'INACTIVE', 'SUSPENDED']);
export const verificationStatusEnum = pgEnum('verification_status', [
  'PENDING',
  'VERIFIED',
  'REJECTED',
]);
/** NFSA ration card categories: Antyodaya Anna Yojana, Priority Household. */
export const cardTypeEnum = pgEnum('card_type', ['AAY', 'PHH']);
export const genderEnum = pgEnum('gender', ['MALE', 'FEMALE', 'OTHER']);
export const shopStatusEnum = pgEnum('shop_status', ['ACTIVE', 'INACTIVE']);
export const unitEnum = pgEnum('unit', ['KG', 'LITRE', 'PACKET']);
export const stockMovementTypeEnum = pgEnum('stock_movement_type', [
  'RECEIPT',
  'ISSUE',
  'ADJUSTMENT',
]);
export const adjustmentReasonEnum = pgEnum('adjustment_reason', [
  'DAMAGE',
  'EXPIRY',
  'INSPECTION_SHORTAGE',
  'INSPECTION_EXCESS',
  'CORRECTION',
  'VOID_REVERSAL',
]);
export const authMethodEnum = pgEnum('auth_method', ['OTP', 'BIOMETRIC', 'OFFLINE', 'MANUAL']);
export const distributionStatusEnum = pgEnum('distribution_status', ['COMPLETED', 'VOIDED']);
export const complaintCategoryEnum = pgEnum('complaint_category', [
  'DEALER_BEHAVIOUR',
  'SHORT_WEIGHT',
  'POOR_QUALITY',
  'OVERCHARGING',
  'SHOP_CLOSED',
  'DENIED_RATION',
  'OTHER',
]);
export const complaintStatusEnum = pgEnum('complaint_status', [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'REJECTED',
]);
export const notificationEventEnum = pgEnum('notification_event', [
  'REGISTRATION_RECEIVED',
  'REGISTRATION_APPROVED',
  'REGISTRATION_REJECTED',
  'RATION_READY',
  'RATION_ISSUED',
  'LOW_STOCK',
  'COMPLAINT_FILED',
  'COMPLAINT_UPDATED',
  'OTP',
  'GENERIC',
]);
export const notificationChannelEnum = pgEnum('notification_channel', ['SMS', 'IN_APP']);
export const deliveryStatusEnum = pgEnum('delivery_status', [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
]);
export const otpPurposeEnum = pgEnum('otp_purpose', [
  'LOGIN',
  'AADHAAR_VERIFY',
  'DISTRIBUTION_AUTH',
]);
export const aadhaarAuthResultEnum = pgEnum('aadhaar_auth_result', ['SUCCESS', 'FAILURE']);

// ─── Identity & access ───────────────────────────────────────────────────────

/**
 * Every login identity. Beneficiaries sign in with mobile + OTP; staff
 * (dealer, official, admin) sign in with email + password.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    role: roleEnum('role').notNull(),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    email: varchar('email', { length: 254 }).unique(),
    mobile: mobile(),
    passwordHash: text('password_hash'),
    status: accountStatusEnum('status').notNull().default('ACTIVE'),
    lastLoginAt: tstz('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('users_role_mobile_key').on(t.role, t.mobile),
    index('users_role_status_idx').on(t.role, t.status),
    check('users_email_lower_chk', sql`${t.email} = lower(${t.email})`),
    check('users_mobile_chk', sql`${t.mobile} ~ '^[6-9][0-9]{9}$'`),
    check(
      'users_login_method_chk',
      sql`(${t.role} = 'BENEFICIARY' AND ${t.mobile} IS NOT NULL) OR (${t.role} <> 'BENEFICIARY' AND ${t.email} IS NOT NULL AND ${t.passwordHash} IS NOT NULL)`,
    ),
  ],
);

/**
 * Server-side sessions: the cookie holds a random token, only its SHA-256 is
 * stored. Logout / suspension deletes rows, so revocation is immediate.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    /** Which web app the session belongs to (beneficiary / dealer / official / admin). */
    app: varchar('app', { length: 12 }).notNull(),
    expiresAt: tstz('expires_at').notNull(),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 300 }),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

/**
 * One-time passwords (login, mock-UIDAI Aadhaar verification, point-of-sale
 * authentication). Only a hash of the code is stored.
 */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purpose: otpPurposeEnum('purpose').notNull(),
    target: varchar('target', { length: 64 }).notNull(),
    codeHash: char('code_hash', { length: 64 }).notNull(),
    expiresAt: tstz('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    consumedAt: tstz('consumed_at'),
    meta: jsonb('meta'),
    createdAt: createdAt(),
  },
  (t) => [index('otp_lookup_idx').on(t.purpose, t.target, t.createdAt.desc())],
);

// ─── Reference data ──────────────────────────────────────────────────────────

export const districts = pgTable(
  'districts',
  {
    id: serial('id').primaryKey(),
    code: varchar('code', { length: 8 }).notNull().unique(),
    name: varchar('name', { length: 80 }).notNull(),
    nameHi: varchar('name_hi', { length: 80 }),
    state: varchar('state', { length: 60 }).notNull().default('Bihar'),
  },
  (t) => [unique('districts_state_name_key').on(t.state, t.name)],
);

/** LLD: Commodity(commodity_id, commodity_name, unit) */
export const commodities = pgTable(
  'commodities',
  {
    id: serial('commodity_id').primaryKey(),
    code: varchar('code', { length: 20 }).notNull().unique(),
    name: varchar('commodity_name', { length: 60 }).notNull(),
    nameHi: varchar('commodity_name_hi', { length: 60 }),
    unit: unitEnum('unit').notNull().default('KG'),
    pricePerUnit: money('price_per_unit').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [check('commodities_price_chk', sql`${t.pricePerUnit} >= 0`)],
);

/** Monthly entitlement per card type: qtyPerFamily + qtyPerMember × family size. */
export const entitlementRules = pgTable(
  'entitlement_rules',
  {
    id: serial('id').primaryKey(),
    commodityId: integer('commodity_id')
      .notNull()
      .references(() => commodities.id, { onDelete: 'cascade' }),
    cardType: cardTypeEnum('card_type').notNull(),
    qtyPerMember: qty('qty_per_member', 10).notNull().default(0),
    qtyPerFamily: qty('qty_per_family', 10).notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    unique('entitlement_rules_commodity_card_key').on(t.commodityId, t.cardType),
    check('entitlement_rules_qty_chk', sql`${t.qtyPerMember} >= 0 AND ${t.qtyPerFamily} >= 0`),
  ],
);

/** Admin-configurable system settings (low-stock %, max shops per dealer, …). */
export const settings = pgTable('settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: jsonb('value').notNull(),
  description: varchar('description', { length: 300 }),
  updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

// ─── D3 Dealer & shop database ───────────────────────────────────────────────

/** LLD: Dealer(dealer_id, name, license_id, mobile, status) */
export const dealers = pgTable(
  'dealers',
  {
    id: uuid('dealer_id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 120 }).notNull(),
    licenseNo: varchar('license_id', { length: 40 }).notNull().unique(),
    licenseValidUntil: date('license_valid_until', { mode: 'string' }),
    mobile: mobile().notNull(),
    address: varchar('address', { length: 300 }),
    districtId: integer('district_id')
      .notNull()
      .references(() => districts.id),
    status: accountStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('dealers_district_status_idx').on(t.districtId, t.status),
    check('dealers_mobile_chk', sql`${t.mobile} ~ '^[6-9][0-9]{9}$'`),
  ],
);

/**
 * LLD: Shop(shop_id, dealer_id, shop_name, address, district, monthly_allocation, status).
 * monthly_allocation is held per commodity in stock.monthly_quota.
 */
export const shops = pgTable(
  'shops',
  {
    id: uuid('shop_id').primaryKey().defaultRandom(),
    shopCode: varchar('shop_code', { length: 20 }).notNull().unique(),
    dealerId: uuid('dealer_id').references(() => dealers.id, { onDelete: 'set null' }),
    name: varchar('shop_name', { length: 120 }).notNull(),
    address: varchar('address', { length: 300 }).notNull(),
    districtId: integer('district_id')
      .notNull()
      .references(() => districts.id),
    latitude: numeric('latitude', { precision: 9, scale: 6, mode: 'number' }),
    longitude: numeric('longitude', { precision: 9, scale: 6, mode: 'number' }),
    status: shopStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('shops_dealer_idx').on(t.dealerId),
    index('shops_district_status_idx').on(t.districtId, t.status),
  ],
);

/** Officials of the PDS department; district_id NULL = state-level access. */
export const officials = pgTable(
  'officials',
  {
    id: uuid('official_id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 120 }).notNull(),
    designation: varchar('designation', { length: 80 }).notNull(),
    districtId: integer('district_id').references(() => districts.id),
    mobile: mobile(),
    createdAt: createdAt(),
  },
  (t) => [index('officials_district_idx').on(t.districtId)],
);

// ─── D1 Beneficiary database / D2 Authentication records ─────────────────────

/**
 * LLD: Beneficiary(beneficiary_id, aadhaar_no, name, address, mobile,
 * family_details, verification_status, registration_date).
 * Aadhaar is never stored in plain text: aadhaar_enc = AES-256-GCM ciphertext,
 * aadhaar_hash = HMAC-SHA256 (duplicate detection), aadhaar_last4 = display.
 * registration_no is assigned on insert; ration_card_no once VERIFIED.
 */
export const beneficiaries = pgTable(
  'beneficiaries',
  {
    id: uuid('beneficiary_id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'restrict' }),
    registrationNo: varchar('registration_no', { length: 20 }).notNull().unique().default(''),
    rationCardNo: varchar('ration_card_no', { length: 20 }).unique(),
    aadhaarEnc: text('aadhaar_enc').notNull(),
    aadhaarHash: char('aadhaar_hash', { length: 64 }).notNull().unique(),
    aadhaarLast4: char('aadhaar_last4', { length: 4 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    guardianName: varchar('guardian_name', { length: 120 }),
    gender: genderEnum('gender'),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    mobile: mobile().notNull(),
    address: varchar('address', { length: 300 }).notNull(),
    pincode: char('pincode', { length: 6 }),
    districtId: integer('district_id')
      .notNull()
      .references(() => districts.id),
    homeShopId: uuid('home_shop_id').references(() => shops.id, { onDelete: 'set null' }),
    cardType: cardTypeEnum('card_type').notNull().default('PHH'),
    verificationStatus: verificationStatusEnum('verification_status').notNull().default('PENDING'),
    verifiedAt: tstz('verified_at'),
    rejectionReason: varchar('rejection_reason', { length: 300 }),
    status: accountStatusEnum('status').notNull().default('ACTIVE'),
    preferredLanguage: varchar('preferred_language', { length: 5 }).notNull().default('en'),
    registrationDate: tstz('registration_date').notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('beneficiaries_district_status_idx').on(t.districtId, t.verificationStatus),
    index('beneficiaries_home_shop_idx').on(t.homeShopId),
    index('beneficiaries_mobile_idx').on(t.mobile),
    check('beneficiaries_mobile_chk', sql`${t.mobile} ~ '^[6-9][0-9]{9}$'`),
    check('beneficiaries_last4_chk', sql`${t.aadhaarLast4} ~ '^[0-9]{4}$'`),
    check('beneficiaries_pincode_chk', sql`${t.pincode} IS NULL OR ${t.pincode} ~ '^[1-9][0-9]{5}$'`),
    check('beneficiaries_lang_chk', sql`${t.preferredLanguage} IN ('en', 'hi')`),
  ],
);

/** LLD family_details, normalised: one row per household member (head included). */
export const familyMembers = pgTable(
  'family_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    beneficiaryId: uuid('beneficiary_id')
      .notNull()
      .references(() => beneficiaries.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    relation: varchar('relation', { length: 40 }).notNull(),
    gender: genderEnum('gender'),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    aadhaarLast4: char('aadhaar_last4', { length: 4 }),
    isHead: boolean('is_head').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('family_members_beneficiary_idx').on(t.beneficiaryId)],
);

/** DFD D2 — every Aadhaar authentication attempt and its UIDAI response. */
export const aadhaarVerifications = pgTable(
  'aadhaar_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    beneficiaryId: uuid('beneficiary_id')
      .notNull()
      .references(() => beneficiaries.id, { onDelete: 'cascade' }),
    method: authMethodEnum('method').notNull(),
    purpose: otpPurposeEnum('purpose').notNull(),
    txnRef: varchar('txn_ref', { length: 64 }).notNull(),
    result: aadhaarAuthResultEnum('result').notNull(),
    responseCode: varchar('response_code', { length: 16 }),
    message: varchar('message', { length: 300 }),
    createdAt: createdAt(),
  },
  (t) => [index('aadhaar_verifications_beneficiary_idx').on(t.beneficiaryId, t.createdAt.desc())],
);

// ─── D4 Inventory database ───────────────────────────────────────────────────

/**
 * LLD: Stock(stock_id, shop_id, commodity_id, quantity_available,
 * monthly_quota, low_stock_threshold). quantity_available changes ONLY via
 * stock_movements (trigger-enforced). low_stock_threshold is derived by
 * trigger: monthly_quota × low_stock_pct / 100 (default 20%, SRS R5).
 */
export const stock = pgTable(
  'stock',
  {
    id: uuid('stock_id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    commodityId: integer('commodity_id')
      .notNull()
      .references(() => commodities.id),
    quantityAvailable: qty('quantity_available').notNull().default(0),
    monthlyQuota: qty('monthly_quota').notNull().default(0),
    lowStockThreshold: qty('low_stock_threshold').notNull().default(0),
    lowStockAlertedAt: tstz('low_stock_alerted_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('stock_shop_commodity_key').on(t.shopId, t.commodityId),
    check('stock_qty_nonneg_chk', sql`${t.quantityAvailable} >= 0`),
    check('stock_quota_nonneg_chk', sql`${t.monthlyQuota} >= 0`),
  ],
);

/**
 * Append-only stock ledger. quantity is a signed delta (+receipt, −issue,
 * ±adjustment). A trigger applies it to `stock` and fills balance_after.
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    commodityId: integer('commodity_id')
      .notNull()
      .references(() => commodities.id),
    type: stockMovementTypeEnum('type').notNull(),
    reason: adjustmentReasonEnum('reason'),
    quantity: qty('quantity').notNull(),
    balanceAfter: qty('balance_after').notNull().default(0),
    referenceNo: varchar('reference_no', { length: 60 }),
    distributionId: uuid('distribution_id').references(() => distributions.id),
    note: varchar('note', { length: 300 }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    clientRef: uuid('client_ref').unique(),
    /** Business time (when goods physically moved) — differs from created_at for offline syncs. */
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
    /** Record time (ledger order; balance_after follows this order). */
    createdAt: createdAt(),
  },
  (t) => [
    index('stock_movements_shop_commodity_idx').on(t.shopId, t.commodityId, t.createdAt.desc()),
    index('stock_movements_occurred_idx').on(t.occurredAt),
    index('stock_movements_type_idx').on(t.type, t.createdAt),
    index('stock_movements_distribution_idx').on(t.distributionId),
    check(
      'stock_movements_sign_chk',
      sql`(${t.type} = 'RECEIPT' AND ${t.quantity} > 0 AND ${t.reason} IS NULL)
       OR (${t.type} = 'ISSUE' AND ${t.quantity} < 0 AND ${t.reason} IS NULL)
       OR (${t.type} = 'ADJUSTMENT' AND ${t.quantity} <> 0 AND ${t.reason} IS NOT NULL)`,
    ),
  ],
);

/**
 * LLD: BeneficiaryQuota(quota_id, beneficiary_id, commodity_id, quota_month,
 * allocated_qty, issued_qty, remaining_qty). remaining_qty is trigger-derived;
 * issued_qty can never exceed allocated_qty (CHECK).
 */
export const beneficiaryQuotas = pgTable(
  'beneficiary_quotas',
  {
    id: uuid('quota_id').primaryKey().defaultRandom(),
    beneficiaryId: uuid('beneficiary_id')
      .notNull()
      .references(() => beneficiaries.id, { onDelete: 'cascade' }),
    commodityId: integer('commodity_id')
      .notNull()
      .references(() => commodities.id),
    quotaMonth: date('quota_month', { mode: 'string' }).notNull(),
    allocatedQty: qty('allocated_qty', 10).notNull(),
    issuedQty: qty('issued_qty', 10).notNull().default(0),
    remainingQty: qty('remaining_qty', 10).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('beneficiary_quotas_key').on(t.beneficiaryId, t.commodityId, t.quotaMonth),
    index('beneficiary_quotas_month_idx').on(t.quotaMonth),
    check('beneficiary_quotas_issued_chk', sql`${t.issuedQty} >= 0 AND ${t.issuedQty} <= ${t.allocatedQty}`),
    check('beneficiary_quotas_month_chk', sql`extract(day from ${t.quotaMonth}) = 1`),
  ],
);

// ─── D5 Distribution database ────────────────────────────────────────────────

/**
 * LLD: Distribution(transaction_id, beneficiary_id, shop_id, dealer_id,
 * commodity_id, quantity, issue_date, receipt_id) — normalised into a
 * transaction header (one receipt) + items (one per commodity). Inserting an
 * item deducts quota and stock atomically (trigger).
 */
export const distributions = pgTable(
  'distributions',
  {
    id: uuid('transaction_id').primaryKey().defaultRandom(),
    receiptNo: varchar('receipt_id', { length: 24 }).notNull().unique().default(''),
    beneficiaryId: uuid('beneficiary_id')
      .notNull()
      .references(() => beneficiaries.id),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    dealerId: uuid('dealer_id')
      .notNull()
      .references(() => dealers.id),
    issuedAt: tstz('issue_date').notNull().defaultNow(),
    authMethod: authMethodEnum('auth_method').notNull(),
    authRef: varchar('auth_ref', { length: 64 }),
    status: distributionStatusEnum('status').notNull().default('COMPLETED'),
    clientRef: uuid('client_ref').unique(),
    capturedOfflineAt: tstz('captured_offline_at'),
    syncedAt: tstz('synced_at'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('distributions_shop_idx').on(t.shopId, t.issuedAt.desc()),
    index('distributions_beneficiary_idx').on(t.beneficiaryId, t.issuedAt.desc()),
    index('distributions_dealer_idx').on(t.dealerId, t.issuedAt.desc()),
    index('distributions_issued_idx').on(t.issuedAt),
  ],
);

export const distributionItems = pgTable(
  'distribution_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    distributionId: uuid('transaction_id')
      .notNull()
      .references(() => distributions.id, { onDelete: 'restrict' }),
    commodityId: integer('commodity_id')
      .notNull()
      .references(() => commodities.id),
    quantity: qty('quantity', 10).notNull(),
    unitPrice: money('unit_price').notNull().default(0),
    amount: money('amount').notNull().default(0),
  },
  (t) => [
    unique('distribution_items_key').on(t.distributionId, t.commodityId),
    index('distribution_items_commodity_idx').on(t.commodityId),
    check('distribution_items_qty_chk', sql`${t.quantity} > 0`),
  ],
);

// ─── D6 Complaint database ───────────────────────────────────────────────────

/** Small uploaded files (complaint evidence), kept in Postgres so the API stays stateless. */
export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  uploadedById: uuid('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
  fileName: varchar('file_name', { length: 200 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: char('sha256', { length: 64 }).notNull(),
  data: bytea('data').notNull(),
  createdAt: createdAt(),
});

/**
 * LLD: Complaint(complaint_id, beneficiary_id, shop_id, dealer_id, category,
 * description, attachment, status, resolution, created_at, resolved_at).
 * New complaints are auto-routed to an official of the shop's district.
 */
export const complaints = pgTable(
  'complaints',
  {
    id: uuid('complaint_id').primaryKey().defaultRandom(),
    ticketNo: varchar('ticket_no', { length: 20 }).notNull().unique().default(''),
    beneficiaryId: uuid('beneficiary_id')
      .notNull()
      .references(() => beneficiaries.id),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'set null' }),
    dealerId: uuid('dealer_id').references(() => dealers.id, { onDelete: 'set null' }),
    category: complaintCategoryEnum('category').notNull(),
    description: varchar('description', { length: 2000 }).notNull(),
    attachmentId: uuid('attachment_id')
      .unique()
      .references(() => attachments.id, { onDelete: 'set null' }),
    status: complaintStatusEnum('status').notNull().default('OPEN'),
    assignedOfficialId: uuid('assigned_official_id').references(() => officials.id, {
      onDelete: 'set null',
    }),
    resolution: varchar('resolution', { length: 2000 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    resolvedAt: tstz('resolved_at'),
  },
  (t) => [
    index('complaints_status_idx').on(t.status, t.createdAt.desc()),
    index('complaints_beneficiary_idx').on(t.beneficiaryId, t.createdAt.desc()),
    index('complaints_official_idx').on(t.assignedOfficialId, t.status),
    index('complaints_shop_idx').on(t.shopId),
  ],
);

/** Status history of each complaint (logged → routed → resolved). */
export const complaintEvents = pgTable(
  'complaint_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    complaintId: uuid('complaint_id')
      .notNull()
      .references(() => complaints.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    fromStatus: complaintStatusEnum('from_status'),
    toStatus: complaintStatusEnum('to_status').notNull(),
    note: varchar('note', { length: 2000 }),
    createdAt: createdAt(),
  },
  (t) => [index('complaint_events_complaint_idx').on(t.complaintId, t.createdAt)],
);

// ─── D7 Notification records ─────────────────────────────────────────────────

/**
 * LLD: Notification(notification_id, beneficiary_id, event_type, message,
 * sent_at, delivery_status). Acts as a transactional outbox: rows are written
 * QUEUED inside the business transaction and dispatched by the API worker
 * through the SMS gateway adapter.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('notification_id').primaryKey().defaultRandom(),
    recipientUserId: uuid('recipient_user_id').references(() => users.id, { onDelete: 'set null' }),
    beneficiaryId: uuid('beneficiary_id').references(() => beneficiaries.id, {
      onDelete: 'set null',
    }),
    mobile: mobile(),
    event: notificationEventEnum('event_type').notNull(),
    channel: notificationChannelEnum('channel').notNull().default('SMS'),
    message: varchar('message', { length: 1000 }).notNull(),
    payload: jsonb('payload'),
    deliveryStatus: deliveryStatusEnum('delivery_status').notNull().default('QUEUED'),
    provider: varchar('provider', { length: 30 }),
    providerMessageId: varchar('provider_message_id', { length: 100 }),
    attempts: integer('attempts').notNull().default(0),
    lastError: varchar('last_error', { length: 500 }),
    createdAt: createdAt(),
    sentAt: tstz('sent_at'),
    deliveredAt: tstz('delivered_at'),
    readAt: tstz('read_at'),
  },
  (t) => [
    index('notifications_queue_idx').on(t.deliveryStatus, t.createdAt),
    index('notifications_recipient_idx').on(t.recipientUserId, t.createdAt.desc()),
    index('notifications_beneficiary_idx').on(t.beneficiaryId, t.createdAt.desc()),
  ],
);

// ─── Audit ───────────────────────────────────────────────────────────────────

/**
 * LLD: AuditLog(log_id, user_id, role, action, entity, change_summary,
 * timestamp). Append-only (UPDATE/DELETE blocked by trigger). Written by DB
 * triggers on sensitive tables and by the API for logins, exports, etc.
 * No FK on user_id so history survives user removal.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('log_id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id'),
    role: roleEnum('role'),
    action: varchar('action', { length: 40 }).notNull(),
    entity: varchar('entity', { length: 60 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }),
    changeSummary: jsonb('change_summary'),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 300 }),
    timestamp: tstz('timestamp').notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entity, t.entityId),
    index('audit_logs_user_idx').on(t.userId, t.timestamp.desc()),
    index('audit_logs_time_idx').on(t.timestamp.desc()),
  ],
);

// ─── Relations (for the typed relational query API) ──────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  beneficiary: one(beneficiaries, { fields: [users.id], references: [beneficiaries.userId] }),
  dealer: one(dealers, { fields: [users.id], references: [dealers.userId] }),
  official: one(officials, { fields: [users.id], references: [officials.userId] }),
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const districtsRelations = relations(districts, ({ many }) => ({
  shops: many(shops),
  dealers: many(dealers),
  beneficiaries: many(beneficiaries),
  officials: many(officials),
}));

export const commoditiesRelations = relations(commodities, ({ many }) => ({
  entitlementRules: many(entitlementRules),
  stock: many(stock),
}));

export const entitlementRulesRelations = relations(entitlementRules, ({ one }) => ({
  commodity: one(commodities, {
    fields: [entitlementRules.commodityId],
    references: [commodities.id],
  }),
}));

export const dealersRelations = relations(dealers, ({ one, many }) => ({
  user: one(users, { fields: [dealers.userId], references: [users.id] }),
  district: one(districts, { fields: [dealers.districtId], references: [districts.id] }),
  shops: many(shops),
  distributions: many(distributions),
}));

export const shopsRelations = relations(shops, ({ one, many }) => ({
  dealer: one(dealers, { fields: [shops.dealerId], references: [dealers.id] }),
  district: one(districts, { fields: [shops.districtId], references: [districts.id] }),
  stock: many(stock),
  distributions: many(distributions),
  beneficiaries: many(beneficiaries),
}));

export const officialsRelations = relations(officials, ({ one, many }) => ({
  user: one(users, { fields: [officials.userId], references: [users.id] }),
  district: one(districts, { fields: [officials.districtId], references: [districts.id] }),
  assignedComplaints: many(complaints),
}));

export const beneficiariesRelations = relations(beneficiaries, ({ one, many }) => ({
  user: one(users, { fields: [beneficiaries.userId], references: [users.id] }),
  district: one(districts, { fields: [beneficiaries.districtId], references: [districts.id] }),
  homeShop: one(shops, { fields: [beneficiaries.homeShopId], references: [shops.id] }),
  familyMembers: many(familyMembers),
  quotas: many(beneficiaryQuotas),
  distributions: many(distributions),
  complaints: many(complaints),
  aadhaarVerifications: many(aadhaarVerifications),
}));

export const familyMembersRelations = relations(familyMembers, ({ one }) => ({
  beneficiary: one(beneficiaries, {
    fields: [familyMembers.beneficiaryId],
    references: [beneficiaries.id],
  }),
}));

export const aadhaarVerificationsRelations = relations(aadhaarVerifications, ({ one }) => ({
  beneficiary: one(beneficiaries, {
    fields: [aadhaarVerifications.beneficiaryId],
    references: [beneficiaries.id],
  }),
}));

export const stockRelations = relations(stock, ({ one }) => ({
  shop: one(shops, { fields: [stock.shopId], references: [shops.id] }),
  commodity: one(commodities, { fields: [stock.commodityId], references: [commodities.id] }),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  shop: one(shops, { fields: [stockMovements.shopId], references: [shops.id] }),
  commodity: one(commodities, {
    fields: [stockMovements.commodityId],
    references: [commodities.id],
  }),
  distribution: one(distributions, {
    fields: [stockMovements.distributionId],
    references: [distributions.id],
  }),
  createdBy: one(users, { fields: [stockMovements.createdById], references: [users.id] }),
}));

export const beneficiaryQuotasRelations = relations(beneficiaryQuotas, ({ one }) => ({
  beneficiary: one(beneficiaries, {
    fields: [beneficiaryQuotas.beneficiaryId],
    references: [beneficiaries.id],
  }),
  commodity: one(commodities, {
    fields: [beneficiaryQuotas.commodityId],
    references: [commodities.id],
  }),
}));

export const distributionsRelations = relations(distributions, ({ one, many }) => ({
  beneficiary: one(beneficiaries, {
    fields: [distributions.beneficiaryId],
    references: [beneficiaries.id],
  }),
  shop: one(shops, { fields: [distributions.shopId], references: [shops.id] }),
  dealer: one(dealers, { fields: [distributions.dealerId], references: [dealers.id] }),
  items: many(distributionItems),
}));

export const distributionItemsRelations = relations(distributionItems, ({ one }) => ({
  distribution: one(distributions, {
    fields: [distributionItems.distributionId],
    references: [distributions.id],
  }),
  commodity: one(commodities, {
    fields: [distributionItems.commodityId],
    references: [commodities.id],
  }),
}));

export const complaintsRelations = relations(complaints, ({ one, many }) => ({
  beneficiary: one(beneficiaries, {
    fields: [complaints.beneficiaryId],
    references: [beneficiaries.id],
  }),
  shop: one(shops, { fields: [complaints.shopId], references: [shops.id] }),
  dealer: one(dealers, { fields: [complaints.dealerId], references: [dealers.id] }),
  assignedOfficial: one(officials, {
    fields: [complaints.assignedOfficialId],
    references: [officials.id],
  }),
  attachment: one(attachments, {
    fields: [complaints.attachmentId],
    references: [attachments.id],
  }),
  events: many(complaintEvents),
}));

export const complaintEventsRelations = relations(complaintEvents, ({ one }) => ({
  complaint: one(complaints, {
    fields: [complaintEvents.complaintId],
    references: [complaints.id],
  }),
  actor: one(users, { fields: [complaintEvents.actorUserId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, { fields: [notifications.recipientUserId], references: [users.id] }),
  beneficiary: one(beneficiaries, {
    fields: [notifications.beneficiaryId],
    references: [beneficiaries.id],
  }),
}));
