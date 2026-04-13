-- 018_relax_notification_constraints.sql
-- Removes strict Foreign Key constraints on user_id to allow notifications/tokens 
-- to work for both the 'users' and 'drivers' tables.

BEGIN;

-- 1. Remove FK from notifications
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;

-- 2. Remove FK from user_push_tokens (if it exists)
-- Checking for common names: 'user_push_tokens_user_id_fkey' or similar.
ALTER TABLE user_push_tokens DROP CONSTRAINT IF EXISTS user_push_tokens_user_id_fkey;

-- 3. Cleanup: The user_id column in these tables will now be treated as a 
-- polymorphic account_id (User ID or Driver ID).

COMMIT;
