-- Set price per km to ₦300 for active pricing rule(s)
UPDATE pricing_rules SET price_per_km = 300, updated_at = CURRENT_TIMESTAMP WHERE is_active = true;
