-- Add 'assigned' to parcel_status enum in a safe way
DO $$ 
BEGIN 
    ALTER TYPE parcel_status ADD VALUE 'assigned' AFTER 'paid';
EXCEPTION 
    WHEN duplicate_object THEN NULL;
END $$;
