DO $$ BEGIN
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'partner';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    business_name VARCHAR(255),
    commission_percentage DECIMAL(5, 2) NOT NULL DEFAULT 10.00,
    wallet_balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total_orders INTEGER NOT NULL DEFAULT 0,
    completed_orders INTEGER NOT NULL DEFAULT 0,
    bank_name VARCHAR(255),
    account_number VARCHAR(20),
    account_name VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    clerk_id VARCHAR(255) UNIQUE,
    profile_pic TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE parcels ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id) ON DELETE SET NULL;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS partner_commission_percentage DECIMAL(5, 2);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS partner_commission_amount DECIMAL(12, 2) DEFAULT 0;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS partner_commission_credited_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS partner_withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    bank_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(20) NOT NULL,
    account_name VARCHAR(255) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_partners_email ON partners(email);
CREATE INDEX IF NOT EXISTS idx_partners_clerk_id ON partners(clerk_id);
CREATE INDEX IF NOT EXISTS idx_parcels_partner_id ON parcels(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_withdrawals_partner_id ON partner_withdrawals(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_withdrawals_status ON partner_withdrawals(status);

DROP TRIGGER IF EXISTS update_partners_updated_at ON partners;
CREATE TRIGGER update_partners_updated_at BEFORE UPDATE ON partners
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_partner_withdrawals_updated_at ON partner_withdrawals;
CREATE TRIGGER update_partner_withdrawals_updated_at BEFORE UPDATE ON partner_withdrawals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
