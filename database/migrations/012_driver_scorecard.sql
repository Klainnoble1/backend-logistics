-- 012_driver_scorecard.sql

-- Add metrics and wallet to drivers table
ALTER TABLE drivers 
ADD COLUMN IF NOT EXISTS completed_orders INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS declined_orders INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS average_rating DECIMAL(3,2) DEFAULT 5.00,
ADD COLUMN IF NOT EXISTS wallet_balance DECIMAL(10,2) DEFAULT 0.00;
