-- Add verification status type if it doesn't exist
DO $$ BEGIN
    CREATE TYPE driver_verification_status AS ENUM ('unverified', 'pending', 'verified', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add columns to drivers table
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS verification_status driver_verification_status DEFAULT 'unverified';
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS verified_phone VARCHAR(50);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS license_image_url TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS motorcycle_reg_url TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
