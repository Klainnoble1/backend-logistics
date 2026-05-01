-- Add 'banned' to driver_verification_status enum
-- Since PostgreSQL doesn't support ALTER TYPE ... ADD VALUE inside a transaction block easily,
-- and our migrate.js uses transactions, we might need a different approach or just run it.
-- However, we can use the same DO block pattern if we want to be safe.

ALTER TYPE driver_verification_status ADD VALUE IF NOT EXISTS 'banned';

-- Also add is_banned column to drivers for easier filtering and future-proofing
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT false;
