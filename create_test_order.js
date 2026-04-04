const pool = require('./src/config/database');

async function createTest() {
  const testParcelId = '11111111-1111-1111-1111-111111111111';
  const testUserId = '22222222-2222-2222-2222-222222222222';
  const testPaymentId = '33333333-3333-3333-3333-333333333333';

  try {
    console.log('--- CREATING TEST-CLAIM ---');

    // Cleanup previous attempts
    await pool.query('DELETE FROM assignments WHERE parcel_id = $1', [testParcelId]);
    await pool.query('DELETE FROM payments WHERE parcel_id = $1', [testParcelId]);
    await pool.query('DELETE FROM parcel_status_history WHERE parcel_id = $1', [testParcelId]);
    await pool.query('DELETE FROM parcels WHERE id = $1', [testParcelId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);

    // Create a sender
    await pool.query('INSERT INTO users (id, full_name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)', 
      [testUserId, 'Test Customer', 'testcustomer@example.com', 'hash', 'customer']);

    // Create a parcel in 'paid' status
    await pool.query('INSERT INTO parcels (id, tracking_id, sender_id, recipient_name, recipient_phone, pickup_address, delivery_address, status, price, weight, service_type, pickup_state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [testParcelId, 'TEST-CLAIM', testUserId, 'Driver Test', '0800', 'Samonda, Ibadan', 'Orogun, Ibadan', 'paid', 1500, 2.0, 'standard', 'Oyo']);

    // Create a completed payment
    await pool.query(`INSERT INTO payments (id, parcel_id, user_id, amount, payment_method, payment_status, transaction_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [testPaymentId, testParcelId, testUserId, 1500, 'paystack', 'completed', 'T_TEST_123']);

    console.log('--- CREATED SUCCESSFULLY ---');
    console.log('Riders in Oyo state should see TEST-CLAIM now.');
  } catch (error) {
    console.error(error);
  } finally {
    process.exit();
  }
}

createTest();
