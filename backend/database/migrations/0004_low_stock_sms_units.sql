-- Low-stock SMS printed quantities with the column's 3 decimals ("18.000 kg").
-- trim_scale() drops trailing zeros: 18.000 → 18, 2.500 → 2.5. Same trigger, same payload.
CREATE OR REPLACE FUNCTION srms_stock_low_alert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE info record;
BEGIN IF NEW.low_stock_alerted_at IS NULL
OR (
  TG_OP = 'UPDATE'
  AND OLD.low_stock_alerted_at IS NOT NULL
) THEN RETURN NULL;
END IF;
SELECT s.shop_code,
  s.shop_name,
  c.commodity_name,
  c.unit,
  dl.user_id AS dealer_user_id,
  dl.mobile AS dealer_mobile INTO info
FROM shops s
  JOIN commodities c ON c.commodity_id = NEW.commodity_id
  LEFT JOIN dealers dl ON dl.dealer_id = s.dealer_id
WHERE s.shop_id = NEW.shop_id;
PERFORM srms_enqueue_notification(
  'LOW_STOCK',
  info.dealer_user_id,
  NULL,
  info.dealer_mobile,
  format(
    'SRMS ALERT: %s at shop %s is %s %s, below %s%% of the monthly quota (%s %s). Please request replenishment.',
    info.commodity_name,
    info.shop_code,
    trim_scale(NEW.quantity_available),
    lower(info.unit::text),
    trim_scale(srms_setting_num('low_stock_pct', 20)),
    trim_scale(NEW.monthly_quota),
    lower(info.unit::text)
  ),
  jsonb_build_object(
    'shopId',
    NEW.shop_id,
    'commodityId',
    NEW.commodity_id,
    'quantityAvailable',
    NEW.quantity_available,
    'threshold',
    NEW.low_stock_threshold
  )
);
RETURN NULL;
END $$;