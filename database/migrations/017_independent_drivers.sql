-- 017_independent_drivers.sql
-- This migration converts the 'drivers' table into a primary identity table,
-- independent from the 'users' table.

BEGIN;

-- 1. Add identity columns to drivers
ALTER TABLE drivers 
ADD COLUMN IF NOT EXISTS email VARCHAR(255),
ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
ADD COLUMN IF NOT EXISTS full_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 2. Migrate data from users to drivers
-- We copy the identity information for every driver that currently exists
UPDATE drivers d
SET 
  email = u.email,
  phone = u.phone,
  password_hash = u.password_hash,
  full_name = u.full_name,
  is_active = u.is_active
FROM users u
WHERE d.user_id = u.id;

-- 3. Enforce constraints on new columns
-- We only do this for email and password_hash since they are critical
ALTER TABLE drivers 
ALTER COLUMN email SET NOT NULL,
ALTER COLUMN password_hash SET NOT NULL,
ALTER COLUMN full_name SET NOT NULL;

-- 4. Add unique constraints to the new identity columns
-- This allows the SAME email to exist in the 'users' table (for customer apps)
-- without colliding with the 'drivers' table entries.
ALTER TABLE drivers ADD CONSTRAINT drivers_email_key UNIQUE (email);
ALTER TABLE drivers ADD CONSTRAINT drivers_phone_key UNIQUE (phone);

-- 5. Drop the old foreign key relationship to the users table
-- First identify the constraint name (usually drivers_user_id_fkey)
-- We'll use a safer approach by dropping the column which drops the constraint.
ALTER TABLE drivers DROP COLUMN user_id;

-- 6. Cleanup: Remove driver accounts from the main users table
-- Now that they exist independently in the 'drivers' table, we purge them
-- from 'users' to prevent them from logging in using the Customer App logic.
DELETE FROM users WHERE role = 'driver';

COMMIT;
