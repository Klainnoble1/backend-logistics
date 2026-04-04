const pool = require('./src/config/database');

async function fixOrder() {
  const trackingId = 'HIQ18F0B5U';
  try {
    console.log(`Fixing order ${trackingId}...`);
    
    // Update status to paid
    const result = await pool.query(
      "UPDATE parcels SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE tracking_id = $1 RETURNING id",
      [trackingId]
    );

    if (result.rows.length === 0) {
      console.log('Order not found.');
      process.exit(1);
    }

    const parcelId = result.rows[0].id;
    console.log(`Updated parcel ${parcelId} status to 'paid'.`);

    // Optionally create a successful payment record if not exists
    const payCheck = await pool.query(
      "SELECT id FROM payments WHERE parcel_id = $1 AND payment_status = 'completed'",
      [parcelId]
    );

    if (payCheck.rows.length === 0) {
       console.log('Inserting completed payment record for override...');
       await pool.query(
         `INSERT INTO payments (parcel_id, user_id, amount, payment_method, payment_status, transaction_id)
          SELECT id, sender_id, price, 'admin_override', 'completed', 'ADMIN-' || id
          FROM parcels WHERE id = $1`,
         [parcelId]
       );
    }

    // Add status history
    await pool.query(
      `INSERT INTO parcel_status_history (parcel_id, status, location, notes)
       VALUES ($1, $2, $3, $4)`,
      [parcelId, 'paid', 'System Override', 'Admin manually confirmed payment via fix script']
    );

    console.log('SUCCESS: Order should now be visible to drivers in the correct state.');
    process.exit(0);
  } catch (err) {
    console.error('Fix failed:', err);
    process.exit(1);
  }
}

fixOrder();
