-- 015_driver_banking_and_withdrawals.sql

-- Add bank details to drivers table
ALTER TABLE drivers 
ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS account_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS account_name VARCHAR(255);

-- Create withdrawal status ENUM if not exists
DO $$ BEGIN
    CREATE TYPE withdrawal_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create withdrawals table
CREATE TABLE IF NOT EXISTS withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL,
    status withdrawal_status NOT NULL DEFAULT 'pending',
    bank_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(50) NOT NULL,
    account_name VARCHAR(255) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_withdrawals_driver_id ON withdrawals(driver_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_withdrawals_updated_at ON withdrawals;
CREATE TRIGGER update_withdrawals_updated_at BEFORE UPDATE ON withdrawals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
