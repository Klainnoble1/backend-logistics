-- Interstate pricing: Fixed rates between states + pickup/delivery fees

CREATE TABLE IF NOT EXISTS state_pricing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    origin_state VARCHAR(100) NOT NULL,
    destination_state VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(origin_state, destination_state)
);

-- Add intra-state fees to pricing_rules
ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS intra_state_pickup_fee DECIMAL(10, 2) DEFAULT 500;
ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS intra_state_delivery_fee DECIMAL(10, 2) DEFAULT 500;

COMMENT ON COLUMN pricing_rules.intra_state_pickup_fee IS 'Flat fee for pickup within the same state (intra-state)';
COMMENT ON COLUMN pricing_rules.intra_state_delivery_fee IS 'Flat fee for delivery within the same state (intra-state)';

-- Insert some sample interstate rates (reference only)
INSERT INTO state_pricing (origin_state, destination_state, price)
VALUES 
    ('Lagos', 'Abuja', 5000),
    ('Abuja', 'Lagos', 5000),
    ('Lagos', 'Oyo', 2500),
    ('Oyo', 'Lagos', 2500)
ON CONFLICT (origin_state, destination_state) DO NOTHING;

-- Update active pricing rule with default intra-state fees
UPDATE pricing_rules 
SET 
  intra_state_pickup_fee = 1000, 
  intra_state_delivery_fee = 1000 
WHERE is_active = true;
