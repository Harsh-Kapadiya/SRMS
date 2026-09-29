CREATE TYPE "public"."aadhaar_auth_result" AS ENUM('SUCCESS', 'FAILURE');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."adjustment_reason" AS ENUM('DAMAGE', 'EXPIRY', 'INSPECTION_SHORTAGE', 'INSPECTION_EXCESS', 'CORRECTION', 'VOID_REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."auth_method" AS ENUM('OTP', 'BIOMETRIC', 'OFFLINE', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."card_type" AS ENUM('AAY', 'PHH');--> statement-breakpoint
CREATE TYPE "public"."complaint_category" AS ENUM('DEALER_BEHAVIOUR', 'SHORT_WEIGHT', 'POOR_QUALITY', 'OVERCHARGING', 'SHOP_CLOSED', 'DENIED_RATION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."complaint_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."distribution_status" AS ENUM('COMPLETED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('MALE', 'FEMALE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('SMS', 'IN_APP');--> statement-breakpoint
CREATE TYPE "public"."notification_event" AS ENUM('REGISTRATION_RECEIVED', 'REGISTRATION_APPROVED', 'REGISTRATION_REJECTED', 'RATION_READY', 'RATION_ISSUED', 'LOW_STOCK', 'COMPLAINT_FILED', 'COMPLAINT_UPDATED', 'OTP', 'GENERIC');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('LOGIN', 'AADHAAR_VERIFY', 'DISTRIBUTION_AUTH');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('BENEFICIARY', 'DEALER', 'OFFICIAL', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."shop_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('RECEIPT', 'ISSUE', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."unit" AS ENUM('KG', 'LITRE', 'PACKET');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('PENDING', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "aadhaar_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"method" "auth_method" NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"txn_ref" varchar(64) NOT NULL,
	"result" "aadhaar_auth_result" NOT NULL,
	"response_code" varchar(16),
	"message" varchar(300),
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by_id" uuid,
	"file_name" varchar(200) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"log_id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"role" "role",
	"action" varchar(40) NOT NULL,
	"entity" varchar(60) NOT NULL,
	"entity_id" varchar(64),
	"change_summary" jsonb,
	"ip" varchar(64),
	"user_agent" varchar(300),
	"timestamp" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beneficiaries" (
	"beneficiary_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"registration_no" varchar(20) DEFAULT '' NOT NULL,
	"ration_card_no" varchar(20),
	"aadhaar_enc" text NOT NULL,
	"aadhaar_hash" char(64) NOT NULL,
	"aadhaar_last4" char(4) NOT NULL,
	"name" varchar(120) NOT NULL,
	"guardian_name" varchar(120),
	"gender" "gender",
	"date_of_birth" date,
	"mobile" varchar(10) NOT NULL,
	"address" varchar(300) NOT NULL,
	"pincode" char(6),
	"district_id" integer NOT NULL,
	"home_shop_id" uuid,
	"card_type" "card_type" DEFAULT 'PHH' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'PENDING' NOT NULL,
	"verified_at" timestamp (3) with time zone,
	"rejection_reason" varchar(300),
	"status" "account_status" DEFAULT 'ACTIVE' NOT NULL,
	"preferred_language" varchar(5) DEFAULT 'en' NOT NULL,
	"registration_date" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beneficiaries_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "beneficiaries_registration_no_unique" UNIQUE("registration_no"),
	CONSTRAINT "beneficiaries_ration_card_no_unique" UNIQUE("ration_card_no"),
	CONSTRAINT "beneficiaries_aadhaar_hash_unique" UNIQUE("aadhaar_hash"),
	CONSTRAINT "beneficiaries_mobile_chk" CHECK ("beneficiaries"."mobile" ~ '^[6-9][0-9]{9}$'),
	CONSTRAINT "beneficiaries_last4_chk" CHECK ("beneficiaries"."aadhaar_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "beneficiaries_pincode_chk" CHECK ("beneficiaries"."pincode" IS NULL OR "beneficiaries"."pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "beneficiaries_lang_chk" CHECK ("beneficiaries"."preferred_language" IN ('en', 'hi'))
);
--> statement-breakpoint
CREATE TABLE "beneficiary_quotas" (
	"quota_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"commodity_id" integer NOT NULL,
	"quota_month" date NOT NULL,
	"allocated_qty" numeric(10, 3) NOT NULL,
	"issued_qty" numeric(10, 3) DEFAULT 0 NOT NULL,
	"remaining_qty" numeric(10, 3) DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beneficiary_quotas_key" UNIQUE("beneficiary_id","commodity_id","quota_month"),
	CONSTRAINT "beneficiary_quotas_issued_chk" CHECK ("beneficiary_quotas"."issued_qty" >= 0 AND "beneficiary_quotas"."issued_qty" <= "beneficiary_quotas"."allocated_qty"),
	CONSTRAINT "beneficiary_quotas_month_chk" CHECK (extract(day from "beneficiary_quotas"."quota_month") = 1)
);
--> statement-breakpoint
CREATE TABLE "commodities" (
	"commodity_id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"commodity_name" varchar(60) NOT NULL,
	"commodity_name_hi" varchar(60),
	"unit" "unit" DEFAULT 'KG' NOT NULL,
	"price_per_unit" numeric(10, 2) DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "commodities_code_unique" UNIQUE("code"),
	CONSTRAINT "commodities_price_chk" CHECK ("commodities"."price_per_unit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "complaint_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"complaint_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"from_status" "complaint_status",
	"to_status" "complaint_status" NOT NULL,
	"note" varchar(2000),
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"complaint_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_no" varchar(20) DEFAULT '' NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"shop_id" uuid,
	"dealer_id" uuid,
	"category" "complaint_category" NOT NULL,
	"description" varchar(2000) NOT NULL,
	"attachment_id" uuid,
	"status" "complaint_status" DEFAULT 'OPEN' NOT NULL,
	"assigned_official_id" uuid,
	"resolution" varchar(2000),
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp (3) with time zone,
	CONSTRAINT "complaints_ticket_no_unique" UNIQUE("ticket_no"),
	CONSTRAINT "complaints_attachment_id_unique" UNIQUE("attachment_id")
);
--> statement-breakpoint
CREATE TABLE "dealers" (
	"dealer_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"license_id" varchar(40) NOT NULL,
	"license_valid_until" date,
	"mobile" varchar(10) NOT NULL,
	"address" varchar(300),
	"district_id" integer NOT NULL,
	"status" "account_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealers_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "dealers_license_id_unique" UNIQUE("license_id"),
	CONSTRAINT "dealers_mobile_chk" CHECK ("dealers"."mobile" ~ '^[6-9][0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "distribution_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"commodity_id" integer NOT NULL,
	"quantity" numeric(10, 3) NOT NULL,
	"unit_price" numeric(10, 2) DEFAULT 0 NOT NULL,
	"amount" numeric(10, 2) DEFAULT 0 NOT NULL,
	CONSTRAINT "distribution_items_key" UNIQUE("transaction_id","commodity_id"),
	CONSTRAINT "distribution_items_qty_chk" CHECK ("distribution_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "distributions" (
	"transaction_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" varchar(24) DEFAULT '' NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"dealer_id" uuid NOT NULL,
	"issue_date" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"auth_method" "auth_method" NOT NULL,
	"auth_ref" varchar(64),
	"status" "distribution_status" DEFAULT 'COMPLETED' NOT NULL,
	"client_ref" uuid,
	"captured_offline_at" timestamp (3) with time zone,
	"synced_at" timestamp (3) with time zone,
	"created_by_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "distributions_receipt_id_unique" UNIQUE("receipt_id"),
	CONSTRAINT "distributions_client_ref_unique" UNIQUE("client_ref")
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(8) NOT NULL,
	"name" varchar(80) NOT NULL,
	"name_hi" varchar(80),
	"state" varchar(60) DEFAULT 'Bihar' NOT NULL,
	CONSTRAINT "districts_code_unique" UNIQUE("code"),
	CONSTRAINT "districts_state_name_key" UNIQUE("state","name")
);
--> statement-breakpoint
CREATE TABLE "entitlement_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"commodity_id" integer NOT NULL,
	"card_type" "card_type" NOT NULL,
	"qty_per_member" numeric(10, 3) DEFAULT 0 NOT NULL,
	"qty_per_family" numeric(10, 3) DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "entitlement_rules_commodity_card_key" UNIQUE("commodity_id","card_type"),
	CONSTRAINT "entitlement_rules_qty_chk" CHECK ("entitlement_rules"."qty_per_member" >= 0 AND "entitlement_rules"."qty_per_family" >= 0)
);
--> statement-breakpoint
CREATE TABLE "family_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"relation" varchar(40) NOT NULL,
	"gender" "gender",
	"date_of_birth" date,
	"aadhaar_last4" char(4),
	"is_head" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"notification_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid,
	"beneficiary_id" uuid,
	"mobile" varchar(10),
	"event_type" "notification_event" NOT NULL,
	"channel" "notification_channel" DEFAULT 'SMS' NOT NULL,
	"message" varchar(1000) NOT NULL,
	"payload" jsonb,
	"delivery_status" "delivery_status" DEFAULT 'QUEUED' NOT NULL,
	"provider" varchar(30),
	"provider_message_id" varchar(100),
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(500),
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp (3) with time zone,
	"delivered_at" timestamp (3) with time zone,
	"read_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "officials" (
	"official_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"designation" varchar(80) NOT NULL,
	"district_id" integer,
	"mobile" varchar(10),
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "officials_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"target" varchar(64) NOT NULL,
	"code_hash" char(64) NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"consumed_at" timestamp (3) with time zone,
	"meta" jsonb,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"revoked_at" timestamp (3) with time zone,
	"replaced_by_id" uuid,
	"ip" varchar(64),
	"user_agent" varchar(300),
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" varchar(300),
	"updated_by_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"shop_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_code" varchar(20) NOT NULL,
	"dealer_id" uuid,
	"shop_name" varchar(120) NOT NULL,
	"address" varchar(300) NOT NULL,
	"district_id" integer NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"status" "shop_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shops_shop_code_unique" UNIQUE("shop_code")
);
--> statement-breakpoint
CREATE TABLE "stock" (
	"stock_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"commodity_id" integer NOT NULL,
	"quantity_available" numeric(12, 3) DEFAULT 0 NOT NULL,
	"monthly_quota" numeric(12, 3) DEFAULT 0 NOT NULL,
	"low_stock_threshold" numeric(12, 3) DEFAULT 0 NOT NULL,
	"low_stock_alerted_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_shop_commodity_key" UNIQUE("shop_id","commodity_id"),
	CONSTRAINT "stock_qty_nonneg_chk" CHECK ("stock"."quantity_available" >= 0),
	CONSTRAINT "stock_quota_nonneg_chk" CHECK ("stock"."monthly_quota" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" uuid NOT NULL,
	"commodity_id" integer NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"reason" "adjustment_reason",
	"quantity" numeric(12, 3) NOT NULL,
	"balance_after" numeric(12, 3) DEFAULT 0 NOT NULL,
	"reference_no" varchar(60),
	"distribution_id" uuid,
	"note" varchar(300),
	"created_by_id" uuid,
	"client_ref" uuid,
	"occurred_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_client_ref_unique" UNIQUE("client_ref"),
	CONSTRAINT "stock_movements_sign_chk" CHECK (("stock_movements"."type" = 'RECEIPT' AND "stock_movements"."quantity" > 0 AND "stock_movements"."reason" IS NULL)
       OR ("stock_movements"."type" = 'ISSUE' AND "stock_movements"."quantity" < 0 AND "stock_movements"."reason" IS NULL)
       OR ("stock_movements"."type" = 'ADJUSTMENT' AND "stock_movements"."quantity" <> 0 AND "stock_movements"."reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "role" NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"email" varchar(254),
	"mobile" varchar(10),
	"password_hash" text,
	"status" "account_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_login_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_role_mobile_key" UNIQUE("role","mobile"),
	CONSTRAINT "users_email_lower_chk" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_mobile_chk" CHECK ("users"."mobile" ~ '^[6-9][0-9]{9}$'),
	CONSTRAINT "users_login_method_chk" CHECK (("users"."role" = 'BENEFICIARY' AND "users"."mobile" IS NOT NULL) OR ("users"."role" <> 'BENEFICIARY' AND "users"."email" IS NOT NULL AND "users"."password_hash" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "aadhaar_verifications" ADD CONSTRAINT "aadhaar_verifications_beneficiary_id_beneficiaries_beneficiary_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("beneficiary_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_home_shop_id_shops_shop_id_fk" FOREIGN KEY ("home_shop_id") REFERENCES "public"."shops"("shop_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiary_quotas" ADD CONSTRAINT "beneficiary_quotas_beneficiary_id_beneficiaries_beneficiary_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("beneficiary_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiary_quotas" ADD CONSTRAINT "beneficiary_quotas_commodity_id_commodities_commodity_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("commodity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_events" ADD CONSTRAINT "complaint_events_complaint_id_complaints_complaint_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("complaint_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_events" ADD CONSTRAINT "complaint_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_beneficiary_id_beneficiaries_beneficiary_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("beneficiary_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_shop_id_shops_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("shop_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_dealer_id_dealers_dealer_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("dealer_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_assigned_official_id_officials_official_id_fk" FOREIGN KEY ("assigned_official_id") REFERENCES "public"."officials"("official_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_items" ADD CONSTRAINT "distribution_items_transaction_id_distributions_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."distributions"("transaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_items" ADD CONSTRAINT "distribution_items_commodity_id_commodities_commodity_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("commodity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_beneficiary_id_beneficiaries_beneficiary_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("beneficiary_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_shop_id_shops_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_dealer_id_dealers_dealer_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("dealer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_rules" ADD CONSTRAINT "entitlement_rules_commodity_id_commodities_commodity_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("commodity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_beneficiary_id_beneficiaries_beneficiary_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("beneficiary_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_beneficiary_id_beneficiaries_beneficiary_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("beneficiary_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officials" ADD CONSTRAINT "officials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officials" ADD CONSTRAINT "officials_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_dealer_id_dealers_dealer_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("dealer_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock" ADD CONSTRAINT "stock_shop_id_shops_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock" ADD CONSTRAINT "stock_commodity_id_commodities_commodity_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("commodity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_shop_id_shops_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_commodity_id_commodities_commodity_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("commodity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_distribution_id_distributions_transaction_id_fk" FOREIGN KEY ("distribution_id") REFERENCES "public"."distributions"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aadhaar_verifications_beneficiary_idx" ON "aadhaar_verifications" USING btree ("beneficiary_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_time_idx" ON "audit_logs" USING btree ("timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "beneficiaries_district_status_idx" ON "beneficiaries" USING btree ("district_id","verification_status");--> statement-breakpoint
CREATE INDEX "beneficiaries_home_shop_idx" ON "beneficiaries" USING btree ("home_shop_id");--> statement-breakpoint
CREATE INDEX "beneficiaries_mobile_idx" ON "beneficiaries" USING btree ("mobile");--> statement-breakpoint
CREATE INDEX "beneficiary_quotas_month_idx" ON "beneficiary_quotas" USING btree ("quota_month");--> statement-breakpoint
CREATE INDEX "complaint_events_complaint_idx" ON "complaint_events" USING btree ("complaint_id","created_at");--> statement-breakpoint
CREATE INDEX "complaints_status_idx" ON "complaints" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "complaints_beneficiary_idx" ON "complaints" USING btree ("beneficiary_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "complaints_official_idx" ON "complaints" USING btree ("assigned_official_id","status");--> statement-breakpoint
CREATE INDEX "complaints_shop_idx" ON "complaints" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "dealers_district_status_idx" ON "dealers" USING btree ("district_id","status");--> statement-breakpoint
CREATE INDEX "distribution_items_commodity_idx" ON "distribution_items" USING btree ("commodity_id");--> statement-breakpoint
CREATE INDEX "distributions_shop_idx" ON "distributions" USING btree ("shop_id","issue_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "distributions_beneficiary_idx" ON "distributions" USING btree ("beneficiary_id","issue_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "distributions_dealer_idx" ON "distributions" USING btree ("dealer_id","issue_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "distributions_issued_idx" ON "distributions" USING btree ("issue_date");--> statement-breakpoint
CREATE INDEX "family_members_beneficiary_idx" ON "family_members" USING btree ("beneficiary_id");--> statement-breakpoint
CREATE INDEX "notifications_queue_idx" ON "notifications" USING btree ("delivery_status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_beneficiary_idx" ON "notifications" USING btree ("beneficiary_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "officials_district_idx" ON "officials" USING btree ("district_id");--> statement-breakpoint
CREATE INDEX "otp_lookup_idx" ON "otp_challenges" USING btree ("purpose","target","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "shops_dealer_idx" ON "shops" USING btree ("dealer_id");--> statement-breakpoint
CREATE INDEX "shops_district_status_idx" ON "shops" USING btree ("district_id","status");--> statement-breakpoint
CREATE INDEX "stock_movements_shop_commodity_idx" ON "stock_movements" USING btree ("shop_id","commodity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stock_movements_occurred_idx" ON "stock_movements" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "stock_movements_type_idx" ON "stock_movements" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_distribution_idx" ON "stock_movements" USING btree ("distribution_id");--> statement-breakpoint
CREATE INDEX "users_role_status_idx" ON "users" USING btree ("role","status");