-- Partner subtype used by the partner mobile app registration flow.
-- Existing partner accounts remain standard delivery partners by default.
ALTER TABLE partners
ADD COLUMN IF NOT EXISTS account_type VARCHAR(30) NOT NULL DEFAULT 'partner';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'partners_account_type_check'
  ) THEN
    ALTER TABLE partners
    ADD CONSTRAINT partners_account_type_check
    CHECK (account_type IN ('partner', 'business_owner'));
  END IF;
END $$;
