-- Add 'paid' to parcel_status enum in a safe way
DO $$ 
BEGIN 
    ALTER TYPE parcel_status ADD VALUE 'paid' AFTER 'created';
EXCEPTION 
    WHEN duplicate_object THEN NULL;
END $$;

-- Add delivery_code column to parcels table
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS delivery_code VARCHAR(8);

-- Generate random 8-digit numeric codes for existing parcels that don't have one
UPDATE parcels 
SET delivery_code = LPAD(floor(random() * 100000000)::text, 8, '0')
WHERE delivery_code IS NULL;

-- Make delivery_code NOT NULL for future entries (optional, but good for consistency)
-- ALTER TABLE parcels ALTER COLUMN delivery_code SET NOT NULL;
