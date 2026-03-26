-- Add state fields to parcels and drivers
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pickup_state VARCHAR(100);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS delivery_state VARCHAR(100);

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS state VARCHAR(100);

-- Create index for performance on state filtering
CREATE INDEX IF NOT EXISTS idx_parcels_pickup_state ON parcels(pickup_state);
CREATE INDEX IF NOT EXISTS idx_drivers_state ON drivers(state);
