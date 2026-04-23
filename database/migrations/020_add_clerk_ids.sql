-- Store external Clerk user IDs separately from local UUID primary keys.
ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id VARCHAR(255);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS clerk_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_id
  ON users(clerk_id)
  WHERE clerk_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_clerk_id
  ON drivers(clerk_id)
  WHERE clerk_id IS NOT NULL;
