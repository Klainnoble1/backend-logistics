-- 019_relax_assignment_constraints.sql
-- Removes strict Foreign Key constraints on assigned_by and updated_by to allow 
-- both 'users' (admins) and 'drivers' (self-claim) to be recorded.

BEGIN;

-- 1. Remove FK from assignments (assigned_by)
ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_assigned_by_fkey;

-- 2. Remove FK from parcel_status_history (updated_by)
ALTER TABLE parcel_status_history DROP CONSTRAINT IF EXISTS parcel_status_history_updated_by_fkey;

COMMIT;
