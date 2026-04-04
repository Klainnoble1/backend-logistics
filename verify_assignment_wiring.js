const pool = require('./src/config/database');

async function verify() {
  const testParcelId = '99999999-9999-9999-9999-999999999999';
  const testDriverUserId = '88888888-8888-8888-8888-888888888888';
  const testDriverId = '77777777-7777-7777-7777-777777777777';

  try {
    console.log('--- TEST START ---');

    // Setup: Create a temporary user, driver and parcel
    await pool.query('DELETE FROM parcel_status_history WHERE parcel_id = $1', [testParcelId]);
    await pool.query('DELETE FROM assignments WHERE parcel_id = $1', [testParcelId]);
    await pool.query('DELETE FROM payments WHERE parcel_id = $1', [testParcelId]);
    await pool.query('DELETE FROM parcels WHERE id = $1', [testParcelId]);
    await pool.query('DELETE FROM drivers WHERE id = $1', [testDriverId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testDriverUserId]);

    await pool.query('INSERT INTO users (id, full_name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)', 
      [testDriverUserId, 'Test Driver', 'testdriver@example.com', 'hash', 'driver']);
    
    await pool.query('INSERT INTO drivers (id, user_id, status, state) VALUES ($1, $2, $3, $4)',
      [testDriverId, testDriverUserId, 'available', 'Oyo']);

    await pool.query('INSERT INTO parcels (id, tracking_id, sender_id, recipient_name, recipient_phone, pickup_address, delivery_address, status, price, weight, service_type, pickup_state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [testParcelId, 'TEST-WIRING', testDriverUserId, 'Recipient', '000', 'Samonda', 'Orogun', 'paid', 1000, 1.0, 'standard', 'Oyo']);

    // Part 1: Admin Assign (should be pending)
    console.log('Testing Admin Assign (pending status)...');
    await pool.query(`INSERT INTO assignments (parcel_id, driver_id, assigned_by, status) VALUES ($1, $2, $3, 'pending')`, 
      [testParcelId, testDriverId, testDriverUserId]);
    
    let assignment = (await pool.query('SELECT * FROM assignments WHERE parcel_id = $1', [testParcelId])).rows[0];
    console.log('Initial assignment status:', assignment.status);
    if (assignment.status !== 'pending') throw new Error('Expected pending status after admin assign');

    // Part 2: Mock Driver Accept
    console.log('Testing Accept Assignment...');
    const acceptRes = await pool.query(`UPDATE assignments SET status = 'accepted' WHERE parcel_id = $1 RETURNING *`, [testParcelId]);
    console.log('Status after accept:', acceptRes.rows[0].status);
    if (acceptRes.rows[0].status !== 'accepted') throw new Error('Failed to set status to accepted');

    // Part 3: Mock Driver Decline (cleanup)
    console.log('Testing Decline (reset)...');
    await pool.query('DELETE FROM assignments WHERE parcel_id = $1', [testParcelId]);
    await pool.query(`UPDATE parcels SET status = 'paid' WHERE id = $1`, [testParcelId]);
    await pool.query(`UPDATE drivers SET status = 'available' WHERE id = $1`, [testDriverId]);
    
    let parcel = (await pool.query('SELECT status FROM parcels WHERE id = $1', [testParcelId])).rows[0];
    let driver = (await pool.query('SELECT status FROM drivers WHERE id = $1', [testDriverId])).rows[0];
    console.log('Parcel status after decline:', parcel.status);
    console.log('Driver status after decline:', driver.status);

    // Cleanup Everything
    await pool.query('DELETE FROM parcel_status_history WHERE parcel_id = $1', [testParcelId]);
    await pool.query('DELETE FROM assignments WHERE parcel_id = $1', [testParcelId]);
    await pool.query('DELETE FROM parcels WHERE id = $1', [testParcelId]);
    await pool.query('DELETE FROM drivers WHERE id = $1', [testDriverId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testDriverUserId]);

    console.log('--- TEST SUCCESS ---');
  } catch (error) {
    console.error('--- TEST FAILED ---');
    console.error(error);
  } finally {
    process.exit();
  }
}

verify();
