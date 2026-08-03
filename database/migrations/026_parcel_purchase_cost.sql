-- Business-owner partner orders can collect item purchase cost together with delivery.
-- Keep parcels.price as the total payable amount so existing payment flows remain compatible.
ALTER TABLE parcels
ADD COLUMN IF NOT EXISTS delivery_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS purchase_cost DECIMAL(10, 2) NOT NULL DEFAULT 0;

UPDATE parcels
SET delivery_price = price
WHERE delivery_price = 0;
