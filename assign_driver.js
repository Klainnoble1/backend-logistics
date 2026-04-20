const pool = require('./src/config/database');
async function assignDriver() {
  try {
    const trackingId = 'OYO-0A18A0';
    const driverId = '10d0edcd-4347-4e66-9d83-737173d02ef8';

    // Get parcel ID
    const parcelRes = await pool.query("SELECT id FROM parcels WHERE tracking_id = $1", [trackingId]);
    if (parcelRes.rows.length === 0) {
      console.log('Parcel not found!');
      process.exit(1);
    }
    const parcelId = parcelRes.rows[0].id;

    const adminId = 'a492831b-5b1a-48e3-9b06-d322e5b3b738'; // Using user as assigner

    // Create assignment
    await pool.query(
      `INSERT INTO assignments (parcel_id, driver_id, status, assigned_by)
       VALUES ($1, $2, 'accepted', $3)
       ON CONFLICT (parcel_id) DO UPDATE SET driver_id = $2, status = 'accepted', assigned_by = $3`,
      [parcelId, driverId, adminId]
    );

    // Update parcel status
    await pool.query(
      "UPDATE parcels SET status = 'assigned' WHERE id = $1",
      [parcelId]
    );

    // Add status history
    await pool.query(
      `INSERT INTO parcel_status_history (parcel_id, status, location, updated_by, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [parcelId, 'assigned', 'Ibadan', driverId, 'Driver assigned to parcel']
    );

    console.log(`✅ Driver assigned successfully to ${trackingId}!`);
    process.exit(0);
  } catch (error) {
    console.error('Error assigning driver:', error);
    process.exit(1);
  }
}
assignDriver();
