-- =============================================================================
-- SRMS business rules, enforced inside PostgreSQL (defence in depth).
--
-- The API validates everything first to give friendly errors, but these
-- triggers guarantee the rules hold for every write path: API bugs, offline
-- sync, admin scripts, or direct SQL.
--
-- Trigger errors are raised as:  SRMS_<CODE>: <human message>   (HINT = <CODE>)
-- so the API can map them to HTTP responses (see @srms/shared DB_ERROR_CODES).
--
-- Traceability:
--   R5  / FR-4  low-stock alert below 20% of monthly quota ....... §4, §5
--   R11 / FR-5  max 3 shops per dealer, same district ............ §3
--   FR-3        eligibility → quota → stock → atomic issue ....... §6
--   R8  / FR-7  registration-received / approved SMS (outbox) .... §2, §9
--   FR-9        complaint routing + status history ............... §7
--   NFR-4       audit log of all stock & distribution changes .... §8
--   R19         tamper-proof stock: ledger-only, append-only ...... §5, §8
-- =============================================================================

-- §0 Helpers ------------------------------------------------------------------

-- All ration months are Indian Standard Time months.
CREATE OR REPLACE FUNCTION srms_month(ts timestamptz) RETURNS date
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT date_trunc('month', ts AT TIME ZONE 'Asia/Kolkata')::date
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION srms_raise(p_code text, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SRMS_' || p_code || ': ' || p_message, HINT = p_code;
END $$;
--> statement-breakpoint

-- Numeric setting from the settings table (value stored as a JSON number).
CREATE OR REPLACE FUNCTION srms_setting_num(p_key text, p_default numeric) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT (value #>> '{}')::numeric FROM settings WHERE key = p_key), p_default)
$$;
--> statement-breakpoint

-- The API stamps every transaction with the acting user:
--   SELECT set_config('srms.user_id', <uuid>, true), set_config('srms.role', <role>, true);
CREATE OR REPLACE FUNCTION srms_actor_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('srms.user_id', true), '')::uuid
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION srms_actor_role() RETURNS role
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('srms.role', true), '')::role
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION srms_flag(p_name text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('srms.' || p_name, true), '') = 'on'
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION srms_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION srms_touch_updated_at();
CREATE TRIGGER beneficiaries_touch BEFORE UPDATE ON beneficiaries FOR EACH ROW EXECUTE FUNCTION srms_touch_updated_at();
CREATE TRIGGER dealers_touch BEFORE UPDATE ON dealers FOR EACH ROW EXECUTE FUNCTION srms_touch_updated_at();
CREATE TRIGGER shops_touch BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION srms_touch_updated_at();
CREATE TRIGGER beneficiary_quotas_touch BEFORE UPDATE ON beneficiary_quotas FOR EACH ROW EXECUTE FUNCTION srms_touch_updated_at();
CREATE TRIGGER complaints_touch BEFORE UPDATE ON complaints FOR EACH ROW EXECUTE FUNCTION srms_touch_updated_at();
CREATE TRIGGER settings_touch BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION srms_touch_updated_at();
--> statement-breakpoint

-- Outbox writer for notifications (dispatched by the API's SMS worker).
-- Bulk imports / seeding can set srms.suppress_notifications = on.
CREATE OR REPLACE FUNCTION srms_enqueue_notification(
  p_event notification_event,
  p_user uuid,
  p_beneficiary uuid,
  p_mobile text,
  p_message text,
  p_payload jsonb DEFAULT NULL,
  p_channel notification_channel DEFAULT 'SMS'
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF srms_flag('suppress_notifications') THEN
    RETURN;
  END IF;
  INSERT INTO notifications (recipient_user_id, beneficiary_id, mobile, event_type, channel, message, payload)
  VALUES (
    p_user, p_beneficiary, p_mobile, p_event,
    CASE WHEN p_channel = 'SMS' AND p_mobile IS NULL THEN 'IN_APP'::notification_channel ELSE p_channel END,
    left(p_message, 1000), p_payload
  );
END $$;
--> statement-breakpoint

-- Profile rows must point at a user with the matching role.
CREATE OR REPLACE FUNCTION srms_check_user_role() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actual role;
BEGIN
  SELECT u.role INTO actual FROM users u WHERE u.id = NEW.user_id;
  IF actual IS DISTINCT FROM TG_ARGV[0]::role THEN
    PERFORM srms_raise('ROLE_MISMATCH', format('%s.user_id must reference a %s user', TG_TABLE_NAME, TG_ARGV[0]));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER beneficiaries_user_role BEFORE INSERT OR UPDATE OF user_id ON beneficiaries
  FOR EACH ROW EXECUTE FUNCTION srms_check_user_role('BENEFICIARY');
CREATE TRIGGER dealers_user_role BEFORE INSERT OR UPDATE OF user_id ON dealers
  FOR EACH ROW EXECUTE FUNCTION srms_check_user_role('DEALER');
CREATE TRIGGER officials_user_role BEFORE INSERT OR UPDATE OF user_id ON officials
  FOR EACH ROW EXECUTE FUNCTION srms_check_user_role('OFFICIAL');
--> statement-breakpoint

-- Append-only guard for ledgers and logs.
CREATE OR REPLACE FUNCTION srms_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM srms_raise('IMMUTABLE_RECORD',
    format('%s rows are append-only and cannot be %s', TG_TABLE_NAME, lower(TG_OP) || 'd'));
  RETURN NULL;
END $$;
--> statement-breakpoint

-- Default rule settings (bootstrap adds the rest).
INSERT INTO settings (key, value, description) VALUES
  ('low_stock_pct', '20', 'Low-stock alert when available stock falls below this % of the monthly quota (SRS R5)'),
  ('max_shops_per_dealer', '3', 'Maximum active shops per dealer, all in the dealer''s district (SRS R11)')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

-- §1 Human-readable numbers ---------------------------------------------------

CREATE SEQUENCE srms_registration_seq;
CREATE SEQUENCE srms_ration_card_seq;
CREATE SEQUENCE srms_receipt_seq;
CREATE SEQUENCE srms_ticket_seq;
--> statement-breakpoint

-- §2 Beneficiary lifecycle (FR-1, FR-2, R8 corrected) ---------------------------

-- Monthly entitlement = qty_per_family + qty_per_member × family size.
-- Generates quota rows for one beneficiary (p_beneficiary) or all of them.
CREATE OR REPLACE FUNCTION srms_generate_quotas(p_month date, p_beneficiary uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  IF extract(day FROM p_month) <> 1 THEN
    PERFORM srms_raise('INVALID_MOVEMENT', 'Quota month must be the first day of a month');
  END IF;

  INSERT INTO beneficiary_quotas (beneficiary_id, commodity_id, quota_month, allocated_qty)
  SELECT b.beneficiary_id,
         r.commodity_id,
         p_month,
         r.qty_per_family + r.qty_per_member * GREATEST(1, fm.members)
  FROM beneficiaries b
  JOIN entitlement_rules r ON r.card_type = b.card_type AND r.is_active
  JOIN commodities c ON c.commodity_id = r.commodity_id AND c.is_active
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS members FROM family_members f WHERE f.beneficiary_id = b.beneficiary_id
  ) fm
  WHERE b.verification_status = 'VERIFIED'
    AND b.status = 'ACTIVE'
    AND (p_beneficiary IS NULL OR b.beneficiary_id = p_beneficiary)
    AND r.qty_per_family + r.qty_per_member * GREATEST(1, fm.members) > 0
  ON CONFLICT (beneficiary_id, commodity_id, quota_month) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION srms_beneficiary_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (NEW.registration_no IS NULL OR NEW.registration_no = '') THEN
    NEW.registration_no := 'REG' || to_char(NEW.registration_date AT TIME ZONE 'Asia/Kolkata', 'YYYY')
                           || lpad(nextval('srms_registration_seq')::text, 7, '0');
  END IF;

  IF NEW.verification_status = 'VERIFIED'
     AND (TG_OP = 'INSERT' OR OLD.verification_status IS DISTINCT FROM 'VERIFIED') THEN
    NEW.verified_at := COALESCE(NEW.verified_at, now());
    NEW.rejection_reason := NULL;
    IF NEW.ration_card_no IS NULL THEN
      -- 12 digits: '10' + 2-digit district + 8-digit serial
      NEW.ration_card_no := '10' || lpad((NEW.district_id % 100)::text, 2, '0')
                            || lpad(nextval('srms_ration_card_seq')::text, 8, '0');
    END IF;
  END IF;

  IF NEW.verification_status = 'REJECTED'
     AND (TG_OP = 'INSERT' OR OLD.verification_status IS DISTINCT FROM 'REJECTED')
     AND NEW.rejection_reason IS NULL THEN
    NEW.rejection_reason := 'Aadhaar verification failed';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.verification_status = 'VERIFIED' AND NEW.verification_status = 'PENDING' THEN
    PERFORM srms_raise('INVALID_TRANSITION', 'A verified beneficiary cannot return to pending');
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER beneficiaries_before_write BEFORE INSERT OR UPDATE ON beneficiaries
  FOR EACH ROW EXECUTE FUNCTION srms_beneficiary_before_write();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION srms_beneficiary_after_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- R8 (corrected): "registration received" SMS immediately — no ration promise.
  IF TG_OP = 'INSERT' THEN
    PERFORM srms_enqueue_notification(
      'REGISTRATION_RECEIVED', NEW.user_id, NEW.beneficiary_id, NEW.mobile,
      format('SRMS: Registration received. Reg No %s. Aadhaar verification is pending; ration can be issued only after verification.', NEW.registration_no),
      jsonb_build_object('registrationNo', NEW.registration_no));
  END IF;

  -- FR-2: "registration approved" SMS only after Aadhaar verification succeeds.
  IF NEW.verification_status = 'VERIFIED'
     AND (TG_OP = 'INSERT' OR OLD.verification_status IS DISTINCT FROM 'VERIFIED') THEN
    PERFORM srms_generate_quotas(srms_month(now()), NEW.beneficiary_id);
    PERFORM srms_enqueue_notification(
      'REGISTRATION_APPROVED', NEW.user_id, NEW.beneficiary_id, NEW.mobile,
      format('SRMS: Aadhaar verified. Your ration card no. is %s. You can now collect your monthly ration.', NEW.ration_card_no),
      jsonb_build_object('rationCardNo', NEW.ration_card_no));
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.verification_status = 'REJECTED' AND OLD.verification_status <> 'REJECTED' THEN
    PERFORM srms_enqueue_notification(
      'REGISTRATION_REJECTED', NEW.user_id, NEW.beneficiary_id, NEW.mobile,
      format('SRMS: Registration %s could not be verified (%s). Please retry Aadhaar verification.', NEW.registration_no, NEW.rejection_reason),
      jsonb_build_object('registrationNo', NEW.registration_no));
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE TRIGGER beneficiaries_after_write AFTER INSERT OR UPDATE OF verification_status ON beneficiaries
  FOR EACH ROW EXECUTE FUNCTION srms_beneficiary_after_write();
--> statement-breakpoint

-- §3 Dealers & shops (FR-5, R11 corrected) --------------------------------------

CREATE OR REPLACE FUNCTION srms_shops_enforce_dealer_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d record;
  active_count integer;
  max_shops integer;
BEGIN
  IF NEW.dealer_id IS NULL OR NEW.status <> 'ACTIVE' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.dealer_id IS NOT DISTINCT FROM OLD.dealer_id
     AND NEW.status = OLD.status
     AND NEW.district_id = OLD.district_id THEN
    RETURN NEW;
  END IF;

  -- Lock the dealer row so concurrent assignments cannot both pass the count.
  SELECT dealer_id, district_id, status INTO d FROM dealers WHERE dealer_id = NEW.dealer_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM srms_raise('DEALER_INACTIVE', 'Dealer does not exist');
  END IF;
  IF d.status <> 'ACTIVE' THEN
    PERFORM srms_raise('DEALER_INACTIVE', format('Cannot assign a shop to a dealer whose account is %s', d.status));
  END IF;
  IF d.district_id <> NEW.district_id THEN
    PERFORM srms_raise('SHOP_DISTRICT_MISMATCH', 'A dealer can only run shops within their own district');
  END IF;

  max_shops := srms_setting_num('max_shops_per_dealer', 3)::int;
  SELECT count(*) INTO active_count
  FROM shops
  WHERE dealer_id = NEW.dealer_id AND status = 'ACTIVE' AND shop_id <> NEW.shop_id;
  IF active_count >= max_shops THEN
    PERFORM srms_raise('DEALER_SHOP_LIMIT',
      format('Dealer already runs %s active shops; the maximum is %s', active_count, max_shops));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER shops_enforce_dealer_rules BEFORE INSERT OR UPDATE ON shops
  FOR EACH ROW EXECUTE FUNCTION srms_shops_enforce_dealer_rules();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION srms_dealer_district_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.district_id <> OLD.district_id AND EXISTS (
    SELECT 1 FROM shops WHERE dealer_id = NEW.dealer_id AND status = 'ACTIVE' AND district_id <> NEW.district_id
  ) THEN
    PERFORM srms_raise('SHOP_DISTRICT_MISMATCH', 'Unassign the dealer''s active shops before moving the dealer to another district');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER dealers_district_guard BEFORE UPDATE OF district_id ON dealers
  FOR EACH ROW EXECUTE FUNCTION srms_dealer_district_guard();
--> statement-breakpoint

-- §4 Stock (FR-4, R5 corrected) ---------------------------------------------------

CREATE OR REPLACE FUNCTION srms_stock_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- quantity_available may only change through the ledger (§5).
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity_available <> 0 AND NOT srms_flag('ledger') THEN
      PERFORM srms_raise('STOCK_DIRECT_UPDATE', 'Opening stock must be recorded as a RECEIPT in the stock ledger');
    END IF;
  ELSIF NEW.quantity_available IS DISTINCT FROM OLD.quantity_available AND NOT srms_flag('ledger') THEN
    PERFORM srms_raise('STOCK_DIRECT_UPDATE', 'Stock can only change through the stock ledger (receipt, issue or adjustment)');
  END IF;

  NEW.low_stock_threshold := round(NEW.monthly_quota * srms_setting_num('low_stock_pct', 20) / 100, 3);
  NEW.updated_at := now();

  IF NEW.monthly_quota > 0 AND NEW.quantity_available < NEW.low_stock_threshold THEN
    NEW.low_stock_alerted_at := COALESCE(NEW.low_stock_alerted_at, now());
  ELSE
    NEW.low_stock_alerted_at := NULL;  -- re-arm once replenished
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER stock_before_write BEFORE INSERT OR UPDATE ON stock
  FOR EACH ROW EXECUTE FUNCTION srms_stock_before_write();
--> statement-breakpoint

-- R5: alert the dealer once each time stock crosses below the threshold.
CREATE OR REPLACE FUNCTION srms_stock_low_alert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  info record;
BEGIN
  IF NEW.low_stock_alerted_at IS NULL
     OR (TG_OP = 'UPDATE' AND OLD.low_stock_alerted_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;

  SELECT s.shop_code, s.shop_name, c.commodity_name, c.unit, dl.user_id AS dealer_user_id, dl.mobile AS dealer_mobile
    INTO info
  FROM shops s
  JOIN commodities c ON c.commodity_id = NEW.commodity_id
  LEFT JOIN dealers dl ON dl.dealer_id = s.dealer_id
  WHERE s.shop_id = NEW.shop_id;

  PERFORM srms_enqueue_notification(
    'LOW_STOCK', info.dealer_user_id, NULL, info.dealer_mobile,
    format('SRMS ALERT: %s at shop %s is %s %s, below %s%% of the monthly quota (%s %s). Please request replenishment.',
           info.commodity_name, info.shop_code, NEW.quantity_available, lower(info.unit::text),
           srms_setting_num('low_stock_pct', 20), NEW.monthly_quota, lower(info.unit::text)),
    jsonb_build_object('shopId', NEW.shop_id, 'commodityId', NEW.commodity_id,
                       'quantityAvailable', NEW.quantity_available, 'threshold', NEW.low_stock_threshold));
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE TRIGGER stock_low_alert AFTER INSERT OR UPDATE ON stock
  FOR EACH ROW EXECUTE FUNCTION srms_stock_low_alert();
--> statement-breakpoint

-- §5 Stock ledger (append-only; the ONLY way stock changes) ----------------------

CREATE OR REPLACE FUNCTION srms_apply_stock_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_qty numeric;
  new_balance numeric;
  shop_status shop_status;
BEGIN
  SELECT status INTO shop_status FROM shops WHERE shop_id = NEW.shop_id;
  IF shop_status IS DISTINCT FROM 'ACTIVE' AND NEW.type <> 'ADJUSTMENT' THEN
    PERFORM srms_raise('SHOP_INACTIVE', 'Stock cannot move at an inactive shop');
  END IF;

  INSERT INTO stock (shop_id, commodity_id) VALUES (NEW.shop_id, NEW.commodity_id)
  ON CONFLICT (shop_id, commodity_id) DO NOTHING;

  SELECT quantity_available INTO current_qty
  FROM stock WHERE shop_id = NEW.shop_id AND commodity_id = NEW.commodity_id
  FOR UPDATE;

  new_balance := current_qty + NEW.quantity;
  IF new_balance < 0 THEN
    PERFORM srms_raise('INSUFFICIENT_STOCK',
      format('Only %s available at this shop; cannot remove %s', current_qty, abs(NEW.quantity)));
  END IF;

  PERFORM set_config('srms.ledger', 'on', true);
  UPDATE stock SET quantity_available = new_balance
  WHERE shop_id = NEW.shop_id AND commodity_id = NEW.commodity_id;
  PERFORM set_config('srms.ledger', 'off', true);

  NEW.balance_after := new_balance;
  NEW.created_by_id := COALESCE(NEW.created_by_id, srms_actor_id());
  NEW.created_at := now();
  IF NEW.occurred_at > now() + interval '5 minutes' THEN
    PERFORM srms_raise('INVALID_MOVEMENT', 'Stock movement date cannot be in the future');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER stock_movements_apply BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION srms_apply_stock_movement();
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION srms_immutable();
--> statement-breakpoint

-- §6 Ration distribution (FR-3, LLD Module 2: 2.1 → 2.5) -------------------------

CREATE OR REPLACE FUNCTION srms_distribution_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  b record;
  s record;
  dealer_status account_status;
BEGIN
  -- 2.1 Verify eligibility
  SELECT verification_status, status INTO b FROM beneficiaries WHERE beneficiary_id = NEW.beneficiary_id;
  IF NOT FOUND OR b.verification_status <> 'VERIFIED' OR b.status <> 'ACTIVE' THEN
    PERFORM srms_raise('BENEFICIARY_NOT_ELIGIBLE', 'Beneficiary must be Aadhaar-verified and active to receive ration');
  END IF;

  SELECT dealer_id, status INTO s FROM shops WHERE shop_id = NEW.shop_id;
  IF NOT FOUND OR s.status <> 'ACTIVE' THEN
    PERFORM srms_raise('SHOP_INACTIVE', 'Shop is not active');
  END IF;
  IF s.dealer_id IS DISTINCT FROM NEW.dealer_id THEN
    PERFORM srms_raise('DEALER_SHOP_MISMATCH', 'This dealer is not assigned to the shop');
  END IF;
  SELECT status INTO dealer_status FROM dealers WHERE dealer_id = NEW.dealer_id;
  IF dealer_status IS DISTINCT FROM 'ACTIVE' THEN
    PERFORM srms_raise('DEALER_INACTIVE', 'Dealer account is not active');
  END IF;

  IF NEW.issue_date > now() + interval '5 minutes' THEN
    PERFORM srms_raise('INVALID_MOVEMENT', 'Issue date cannot be in the future');
  END IF;
  IF NEW.status <> 'COMPLETED' THEN
    PERFORM srms_raise('INVALID_TRANSITION', 'New distributions must be COMPLETED');
  END IF;

  IF NEW.receipt_id IS NULL OR NEW.receipt_id = '' THEN
    NEW.receipt_id := 'RCPT-' || to_char(NEW.issue_date AT TIME ZONE 'Asia/Kolkata', 'YYYYMM')
                      || '-' || lpad(nextval('srms_receipt_seq')::text, 7, '0');
  END IF;
  NEW.created_by_id := COALESCE(NEW.created_by_id, srms_actor_id());
  NEW.created_at := now();   -- marks the creating transaction (items must be added in it)
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER distributions_before_insert BEFORE INSERT ON distributions
  FOR EACH ROW EXECUTE FUNCTION srms_distribution_before_insert();
--> statement-breakpoint

-- 2.2 Check monthly quota → 2.3 validate stock → 2.4 issue & update stock.
-- Runs per item; the whole transaction rolls back if any step fails.
CREATE OR REPLACE FUNCTION srms_distribution_item_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  hdr record;
  q record;
  price numeric;
  qmonth date;
BEGIN
  SELECT * INTO hdr FROM distributions WHERE transaction_id = NEW.transaction_id;
  IF hdr.created_at IS DISTINCT FROM now()::timestamptz(3) THEN
    PERFORM srms_raise('IMMUTABLE_RECORD', 'Items can only be added in the transaction that created the receipt');
  END IF;

  qmonth := srms_month(hdr.issue_date);
  SELECT * INTO q FROM beneficiary_quotas
  WHERE beneficiary_id = hdr.beneficiary_id AND commodity_id = NEW.commodity_id AND quota_month = qmonth
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM srms_generate_quotas(qmonth, hdr.beneficiary_id);
    SELECT * INTO q FROM beneficiary_quotas
    WHERE beneficiary_id = hdr.beneficiary_id AND commodity_id = NEW.commodity_id AND quota_month = qmonth
    FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM srms_raise('NO_QUOTA', 'Beneficiary has no entitlement for this commodity this month');
    END IF;
  END IF;

  IF q.issued_qty + NEW.quantity > q.allocated_qty THEN
    PERFORM srms_raise('QUOTA_EXCEEDED',
      format('Remaining monthly quota is %s; requested %s', q.allocated_qty - q.issued_qty, NEW.quantity));
  END IF;
  UPDATE beneficiary_quotas SET issued_qty = issued_qty + NEW.quantity WHERE quota_id = q.quota_id;

  SELECT price_per_unit INTO price FROM commodities WHERE commodity_id = NEW.commodity_id;
  NEW.unit_price := price;
  NEW.amount := round(price * NEW.quantity, 2);

  -- Deducts shop stock; raises INSUFFICIENT_STOCK if the shop cannot cover it.
  INSERT INTO stock_movements (shop_id, commodity_id, type, quantity, reference_no, distribution_id, created_by_id, occurred_at)
  VALUES (hdr.shop_id, NEW.commodity_id, 'ISSUE', -NEW.quantity, hdr.receipt_id, hdr.transaction_id, hdr.created_by_id, hdr.issue_date);
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER distribution_items_apply BEFORE INSERT ON distribution_items
  FOR EACH ROW EXECUTE FUNCTION srms_distribution_item_apply();
CREATE TRIGGER distribution_items_immutable BEFORE UPDATE OR DELETE ON distribution_items
  FOR EACH ROW EXECUTE FUNCTION srms_immutable();
--> statement-breakpoint

-- 2.5 At COMMIT: every receipt must have at least one item; queue the SMS receipt.
CREATE OR REPLACE FUNCTION srms_distribution_finalize() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lines text;
  item_count integer;
  ben record;
  shop_code text;
BEGIN
  SELECT count(*), string_agg(c.commodity_name || ' ' || trim(to_char(i.quantity, 'FM999999990.###')) || ' ' || lower(c.unit::text), ', ' ORDER BY c.sort_order)
    INTO item_count, lines
  FROM distribution_items i JOIN commodities c ON c.commodity_id = i.commodity_id
  WHERE i.transaction_id = NEW.transaction_id;

  IF item_count = 0 THEN
    PERFORM srms_raise('INVALID_MOVEMENT', 'A distribution must contain at least one commodity');
  END IF;

  SELECT user_id, mobile INTO ben FROM beneficiaries WHERE beneficiary_id = NEW.beneficiary_id;
  SELECT s.shop_code INTO shop_code FROM shops s WHERE s.shop_id = NEW.shop_id;
  PERFORM srms_enqueue_notification(
    'RATION_ISSUED', ben.user_id, NEW.beneficiary_id, ben.mobile,
    format('SRMS: Ration issued on %s at shop %s: %s. Receipt %s. Not received? File a complaint in the SRMS app.',
           to_char(NEW.issue_date AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY'), shop_code, lines, NEW.receipt_id),
    jsonb_build_object('transactionId', NEW.transaction_id, 'receiptNo', NEW.receipt_id));
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER distributions_finalize AFTER INSERT ON distributions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION srms_distribution_finalize();
--> statement-breakpoint

-- Only status (COMPLETED → VOIDED) and synced_at may change after the fact.
CREATE OR REPLACE FUNCTION srms_distribution_before_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - '{status,synced_at}'::text[]) IS DISTINCT FROM (to_jsonb(OLD) - '{status,synced_at}'::text[]) THEN
    PERFORM srms_raise('IMMUTABLE_RECORD', 'Distribution records cannot be edited; void and re-issue instead');
  END IF;
  IF NEW.status <> OLD.status AND NOT (OLD.status = 'COMPLETED' AND NEW.status = 'VOIDED') THEN
    PERFORM srms_raise('INVALID_TRANSITION', format('Cannot change a distribution from %s to %s', OLD.status, NEW.status));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER distributions_before_update BEFORE UPDATE ON distributions
  FOR EACH ROW EXECUTE FUNCTION srms_distribution_before_update();
CREATE TRIGGER distributions_no_delete BEFORE DELETE ON distributions
  FOR EACH ROW EXECUTE FUNCTION srms_immutable();
--> statement-breakpoint

-- Voiding returns the quota and puts the goods back through the ledger.
CREATE OR REPLACE FUNCTION srms_distribution_void() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  it record;
BEGIN
  IF NOT (OLD.status = 'COMPLETED' AND NEW.status = 'VOIDED') THEN
    RETURN NULL;
  END IF;
  FOR it IN SELECT commodity_id, quantity FROM distribution_items WHERE transaction_id = NEW.transaction_id LOOP
    UPDATE beneficiary_quotas SET issued_qty = issued_qty - it.quantity
    WHERE beneficiary_id = NEW.beneficiary_id AND commodity_id = it.commodity_id
      AND quota_month = srms_month(NEW.issue_date);
    INSERT INTO stock_movements (shop_id, commodity_id, type, reason, quantity, reference_no, distribution_id, note)
    VALUES (NEW.shop_id, it.commodity_id, 'ADJUSTMENT', 'VOID_REVERSAL', it.quantity, NEW.receipt_id,
            NEW.transaction_id, 'Reversal of voided distribution');
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE TRIGGER distributions_void AFTER UPDATE OF status ON distributions
  FOR EACH ROW EXECUTE FUNCTION srms_distribution_void();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION srms_quota_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.issued_qty > NEW.allocated_qty THEN
    PERFORM srms_raise('QUOTA_EXCEEDED', format('Issued %s would exceed the allocation of %s', NEW.issued_qty, NEW.allocated_qty));
  END IF;
  NEW.remaining_qty := NEW.allocated_qty - NEW.issued_qty;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER beneficiary_quotas_before_write BEFORE INSERT OR UPDATE ON beneficiary_quotas
  FOR EACH ROW EXECUTE FUNCTION srms_quota_before_write();
--> statement-breakpoint

-- §7 Complaints (FR-9) ---------------------------------------------------------

CREATE OR REPLACE FUNCTION srms_complaint_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  route_district integer;
BEGIN
  IF NEW.ticket_no IS NULL OR NEW.ticket_no = '' THEN
    NEW.ticket_no := 'CMP-' || to_char(NEW.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY')
                     || '-' || lpad(nextval('srms_ticket_seq')::text, 6, '0');
  END IF;
  IF NEW.status <> 'OPEN' THEN
    PERFORM srms_raise('INVALID_TRANSITION', 'New complaints start as OPEN');
  END IF;

  IF NEW.shop_id IS NOT NULL AND NEW.dealer_id IS NULL THEN
    SELECT dealer_id INTO NEW.dealer_id FROM shops WHERE shop_id = NEW.shop_id;
  END IF;

  -- Route to the least-loaded active official of the shop's (else beneficiary's)
  -- district; fall back to a state-level official.
  IF NEW.assigned_official_id IS NULL THEN
    SELECT COALESCE((SELECT district_id FROM shops WHERE shop_id = NEW.shop_id),
                    (SELECT district_id FROM beneficiaries WHERE beneficiary_id = NEW.beneficiary_id))
      INTO route_district;

    SELECT o.official_id INTO NEW.assigned_official_id
    FROM officials o
    JOIN users u ON u.id = o.user_id AND u.status = 'ACTIVE'
    WHERE o.district_id = route_district OR o.district_id IS NULL
    ORDER BY (o.district_id IS NULL),
             (SELECT count(*) FROM complaints c
               WHERE c.assigned_official_id = o.official_id AND c.status IN ('OPEN', 'IN_PROGRESS')),
             o.created_at
    LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER complaints_before_insert BEFORE INSERT ON complaints
  FOR EACH ROW EXECUTE FUNCTION srms_complaint_before_insert();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION srms_complaint_before_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
       (OLD.status = 'OPEN' AND NEW.status IN ('IN_PROGRESS', 'RESOLVED', 'REJECTED'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('RESOLVED', 'REJECTED', 'OPEN'))
    OR (OLD.status IN ('RESOLVED', 'REJECTED') AND NEW.status = 'OPEN')
  ) THEN
    PERFORM srms_raise('INVALID_TRANSITION', format('Complaint cannot move from %s to %s', OLD.status, NEW.status));
  END IF;

  IF NEW.status IN ('RESOLVED', 'REJECTED') THEN
    IF NEW.resolution IS NULL OR length(trim(NEW.resolution)) < 5 THEN
      PERFORM srms_raise('INVALID_TRANSITION', 'A resolution note is required to close a complaint');
    END IF;
    NEW.resolved_at := now();
  ELSE
    NEW.resolved_at := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER complaints_before_update BEFORE UPDATE ON complaints
  FOR EACH ROW EXECUTE FUNCTION srms_complaint_before_update();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION srms_complaint_after_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ben record;
  official_user uuid;
  official_name text;
BEGIN
  SELECT user_id, mobile INTO ben FROM beneficiaries WHERE beneficiary_id = NEW.beneficiary_id;

  IF TG_OP = 'INSERT' THEN
    SELECT o.user_id, o.name INTO official_user, official_name FROM officials o WHERE o.official_id = NEW.assigned_official_id;
    INSERT INTO complaint_events (complaint_id, actor_user_id, from_status, to_status, note)
    VALUES (NEW.complaint_id, COALESCE(srms_actor_id(), ben.user_id), NULL, 'OPEN',
            'Complaint logged' || COALESCE(' and routed to ' || official_name, ' (awaiting assignment)'));
    PERFORM srms_enqueue_notification(
      'COMPLAINT_FILED', ben.user_id, NEW.beneficiary_id, ben.mobile,
      format('SRMS: Complaint %s registered. Track its status in the SRMS app.', NEW.ticket_no),
      jsonb_build_object('complaintId', NEW.complaint_id, 'ticketNo', NEW.ticket_no));
    IF official_user IS NOT NULL THEN
      PERFORM srms_enqueue_notification(
        'COMPLAINT_FILED', official_user, NULL, NULL,
        format('New complaint %s (%s) assigned to you.', NEW.ticket_no, NEW.category),
        jsonb_build_object('complaintId', NEW.complaint_id, 'ticketNo', NEW.ticket_no), 'IN_APP');
    END IF;
  ELSIF NEW.status <> OLD.status THEN
    INSERT INTO complaint_events (complaint_id, actor_user_id, from_status, to_status, note)
    VALUES (NEW.complaint_id, srms_actor_id(), OLD.status, NEW.status,
            CASE WHEN NEW.status IN ('RESOLVED', 'REJECTED') THEN NEW.resolution END);
    PERFORM srms_enqueue_notification(
      'COMPLAINT_UPDATED', ben.user_id, NEW.beneficiary_id, ben.mobile,
      format('SRMS: Complaint %s is now %s.%s', NEW.ticket_no, replace(NEW.status::text, '_', ' '),
             CASE WHEN NEW.status IN ('RESOLVED', 'REJECTED') THEN ' ' || left(NEW.resolution, 120) ELSE '' END),
      jsonb_build_object('complaintId', NEW.complaint_id, 'ticketNo', NEW.ticket_no, 'status', NEW.status));
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE TRIGGER complaints_after_write AFTER INSERT OR UPDATE OF status ON complaints
  FOR EACH ROW EXECUTE FUNCTION srms_complaint_after_write();
CREATE TRIGGER complaint_events_immutable BEFORE UPDATE OR DELETE ON complaint_events
  FOR EACH ROW EXECUTE FUNCTION srms_immutable();
CREATE TRIGGER aadhaar_verifications_immutable BEFORE UPDATE OR DELETE ON aadhaar_verifications
  FOR EACH ROW EXECUTE FUNCTION srms_immutable();
--> statement-breakpoint

-- §8 Audit log (NFR-4) -----------------------------------------------------------
-- srms_audit(<pk column>, <ignored column>...) records who changed what.
-- UPDATEs store only changed columns as {"col": {"from": .., "to": ..}}.
-- Secrets (Aadhaar ciphertext/hash, password hashes) are never copied here.

CREATE OR REPLACE FUNCTION srms_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pk text := TG_ARGV[0];
  ignored text[] := TG_ARGV[1:TG_NARGS - 1] || ARRAY['updated_at'];
  old_j jsonb;
  new_j jsonb;
  diff jsonb := '{}'::jsonb;
  k text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN old_j := to_jsonb(OLD) - ignored; END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN new_j := to_jsonb(NEW) - ignored; END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(new_j) LOOP
      IF (new_j -> k) IS DISTINCT FROM (old_j -> k) THEN
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', old_j -> k, 'to', new_j -> k));
      END IF;
    END LOOP;
    IF diff = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    diff := new_j;
  ELSE
    diff := old_j;
  END IF;

  INSERT INTO audit_logs (user_id, role, action, entity, entity_id, change_summary)
  VALUES (srms_actor_id(), srms_actor_role(), TG_OP, TG_TABLE_NAME,
          COALESCE(new_j, old_j) ->> pk, diff);
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE TRIGGER users_audit AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION srms_audit('id', 'password_hash', 'last_login_at');
CREATE TRIGGER beneficiaries_audit AFTER INSERT OR UPDATE OR DELETE ON beneficiaries
  FOR EACH ROW EXECUTE FUNCTION srms_audit('beneficiary_id', 'aadhaar_enc', 'aadhaar_hash');
CREATE TRIGGER dealers_audit AFTER INSERT OR UPDATE OR DELETE ON dealers
  FOR EACH ROW EXECUTE FUNCTION srms_audit('dealer_id');
CREATE TRIGGER shops_audit AFTER INSERT OR UPDATE OR DELETE ON shops
  FOR EACH ROW EXECUTE FUNCTION srms_audit('shop_id');
CREATE TRIGGER officials_audit AFTER INSERT OR UPDATE OR DELETE ON officials
  FOR EACH ROW EXECUTE FUNCTION srms_audit('official_id');
CREATE TRIGGER commodities_audit AFTER INSERT OR UPDATE OR DELETE ON commodities
  FOR EACH ROW EXECUTE FUNCTION srms_audit('commodity_id');
CREATE TRIGGER entitlement_rules_audit AFTER INSERT OR UPDATE OR DELETE ON entitlement_rules
  FOR EACH ROW EXECUTE FUNCTION srms_audit('id');
CREATE TRIGGER settings_audit AFTER INSERT OR UPDATE OR DELETE ON settings
  FOR EACH ROW EXECUTE FUNCTION srms_audit('key');
CREATE TRIGGER stock_audit AFTER UPDATE OR DELETE ON stock
  FOR EACH ROW EXECUTE FUNCTION srms_audit('stock_id', 'quantity_available', 'low_stock_threshold', 'low_stock_alerted_at');
CREATE TRIGGER stock_adjustments_audit AFTER INSERT ON stock_movements
  FOR EACH ROW WHEN (NEW.type = 'ADJUSTMENT') EXECUTE FUNCTION srms_audit('id');
CREATE TRIGGER distributions_audit AFTER UPDATE ON distributions
  FOR EACH ROW EXECUTE FUNCTION srms_audit('transaction_id');
CREATE TRIGGER complaints_audit AFTER UPDATE ON complaints
  FOR EACH ROW EXECUTE FUNCTION srms_audit('complaint_id');
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION srms_immutable();
--> statement-breakpoint

-- §9 Reporting views (FR-6 dashboard, FR-8 monthly reports) ----------------------

-- One row per commodity line of every distribution.
CREATE VIEW v_distribution_lines AS
SELECT d.transaction_id,
       d.receipt_id,
       d.issue_date,
       srms_month(d.issue_date) AS month,
       d.status,
       d.auth_method,
       d.beneficiary_id,
       d.shop_id,
       s.shop_code,
       s.shop_name,
       s.district_id,
       d.dealer_id,
       i.commodity_id,
       c.code AS commodity_code,
       c.commodity_name,
       c.unit,
       i.quantity,
       i.amount
FROM distributions d
JOIN distribution_items i ON i.transaction_id = d.transaction_id
JOIN shops s ON s.shop_id = d.shop_id
JOIN commodities c ON c.commodity_id = i.commodity_id;
--> statement-breakpoint

-- Live stock position with the low-stock flag (R5).
CREATE VIEW v_stock_status AS
SELECT st.stock_id,
       st.shop_id,
       s.shop_code,
       s.shop_name,
       s.district_id,
       s.dealer_id,
       st.commodity_id,
       c.code AS commodity_code,
       c.commodity_name,
       c.unit,
       st.quantity_available,
       st.monthly_quota,
       st.low_stock_threshold,
       (st.monthly_quota > 0 AND st.quantity_available < st.low_stock_threshold) AS is_low,
       CASE WHEN st.monthly_quota > 0
            THEN round(st.quantity_available / st.monthly_quota * 100, 1) END AS pct_of_quota,
       st.updated_at
FROM stock st
JOIN shops s ON s.shop_id = st.shop_id
JOIN commodities c ON c.commodity_id = st.commodity_id;
--> statement-breakpoint

-- Monthly ledger roll-up per shop & commodity: the basis for leakage KPIs.
--   leakage   = unexplained shortages (INSPECTION_SHORTAGE, negative CORRECTION)
--   wastage   = recorded DAMAGE / EXPIRY
CREATE VIEW v_shop_month_ledger AS
SELECT m.shop_id,
       s.shop_code,
       s.district_id,
       m.commodity_id,
       srms_month(m.occurred_at) AS month,
       COALESCE(sum(m.quantity) FILTER (WHERE m.type = 'RECEIPT'), 0) AS received,
       COALESCE(-sum(m.quantity) FILTER (WHERE m.type = 'ISSUE'), 0) AS issued,
       COALESCE(sum(m.quantity) FILTER (WHERE m.reason = 'VOID_REVERSAL'), 0) AS reversed,
       COALESCE(-sum(m.quantity) FILTER (WHERE m.reason IN ('DAMAGE', 'EXPIRY')), 0) AS wastage,
       COALESCE(-sum(m.quantity) FILTER (WHERE m.reason = 'INSPECTION_SHORTAGE'
                                            OR (m.reason = 'CORRECTION' AND m.quantity < 0)), 0) AS leakage,
       COALESCE(sum(m.quantity) FILTER (WHERE m.reason = 'INSPECTION_EXCESS'
                                           OR (m.reason = 'CORRECTION' AND m.quantity > 0)), 0) AS excess
FROM stock_movements m
JOIN shops s ON s.shop_id = m.shop_id
GROUP BY m.shop_id, s.shop_code, s.district_id, m.commodity_id, srms_month(m.occurred_at);
