-- Add road distance (km) to parcels for display and transparency
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS distance_km DECIMAL(10, 2);

COMMENT ON COLUMN parcels.distance_km IS 'Road distance in km (OSRM) between pickup and delivery';
