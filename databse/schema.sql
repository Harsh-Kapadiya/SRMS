CREATE TABLE beneficiaries (
    beneficiary_id,
    aadhaar_no,
    name,
    address,
    mobile,
    family_details,
    verification_status,
    registration_date
);


CREATE TABLE dealers (
    dealer_id,
    name,
    license_id,
    mobile,
    status
);


CREATE TABLE shops (
    shop_id,
    dealer_id,
    shop_name,
    address,
    district,
    monthly_allocation,
    status
);


CREATE TABLE commodities (
    commodity_id,
    commodity_name,
    unit SMART RATION DISTRIBUTION MONITORING SYSTEM | LOW - LEVEL DESIGN Function - Oriented Design • Structure Chart & Data Layout
);


CREATE TABLE stock (
    stock_id,
    shop_id,
    commodity_id,
    quantity_available,
    monthly_quota,
    low_stock_threshold
);


CREATE TABLE beneficiary_quota (
    quota_id,
    beneficiary_id,
    commodity_id,
    quota_month,
    allocated_qty,
    issued_qty
);


CREATE TABLE distribution (
    transaction_id,
    beneficiary_id,
    shop_id,
    dealer_id,
    commodity_id,
    quantity,
    issue_date,
    receipt_id
);


CREATE TABLE complaints (
    complaint_id,
    beneficiary_id,
    shop_id,
    dealer_id,
    category,
    description,
    attachment,
    status,
    resolution,
    created_at,
    resolved_at
);


CREATE TABLE notifications (
    notification_id,
    beneficiary_id,
    event_type,
    message,
    sent_at,
    delivery_status
);


CREATE TABLE audit_log (
    log_id,
    user_id,
    SMART RATION DISTRIBUTION MONITORING SYSTEM | LOW - LEVEL DESIGN Function - Oriented Design • Structure Chart & Data Layout role,
    action,
    entity,
    change_summary,
    timestamp
);