-- Nigerian pricing: ₦300/km, ₦300/kg after 5 kg

ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS weight_included_kg DECIMAL(10, 2) DEFAULT 5;

COMMENT ON COLUMN pricing_rules.weight_included_kg IS 'First N kg included in base; charge price_per_kg only for weight above this';

-- Update default/active rule to Nigerian rates (reference: Iwo Road to UI ~₦1,600 for ~8 km)
UPDATE pricing_rules
SET
  rule_name = 'Nigerian Standard',
  base_price = 0,
  price_per_km = 300,
  price_per_kg = 300,
  weight_included_kg = 5,
  express_surcharge = 500,
  insurance_fee = 200,
  min_price = 500,
  max_price = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE is_active = true
  AND (SELECT COUNT(*) FROM pricing_rules WHERE is_active = true) > 0;

-- If no active rule exists, insert one
INSERT INTO pricing_rules (rule_name, base_price, price_per_km, price_per_kg, weight_included_kg, express_surcharge, insurance_fee, min_price, is_active)
SELECT 'Nigerian Standard', 0, 300, 300, 5, 500, 200, 500, true
WHERE NOT EXISTS (SELECT 1 FROM pricing_rules WHERE is_active = true);
