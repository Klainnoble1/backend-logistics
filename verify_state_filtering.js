const pool = require('./src/config/database');
const { calculatePrice } = require('./src/services/pricingService');

async function verify() {
  try {
    console.log('--- Verification Started ---');

    // 1. Check if calculatePrice returns states
    const pricing = await calculatePrice(
      '10, Olorunlogbon Street, Anthony Village, Lagos, Nigeria',
      'Area 1, Garki, Abuja, Nigeria',
      5,
      'standard',
      false
    );
    console.log('Pricing result - pickupState:', pricing.pickupState);
    console.log('Pricing result - deliveryState:', pricing.deliveryState);

    // 2. Insert a test parcel manually with states
    const userRes = await pool.query('SELECT id FROM users LIMIT 1');
    const senderId = userRes.rows[0]?.id;

    if (!senderId) {
       console.error('No user found in database to use as sender');
       process.exit(1);
    }

    const testParcel = await pool.query(
      `INSERT INTO parcels (
        tracking_id, sender_id, recipient_name, recipient_phone,
        pickup_address, delivery_address, parcel_type, weight,
        service_type, status, price, insurance, pickup_state, delivery_state
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id`,
      ['TEST-STATE-001', senderId, 'Test Recipient', '08012345678',
       'Lagos Address', 'Abuja Address', 'Electronics', 5, 
       'standard', 'created', 5000, false, 'Lagos', 'FCT - Abuja']
    );
    console.log('Inserted test parcel ID:', testParcel.rows[0].id);

    // 3. Insert a test payment for it
    await pool.query(
      `INSERT INTO payments (parcel_id, user_id, amount, payment_method, payment_status)
       VALUES ($1, $2, $3, $4, 'completed')`,
      [testParcel.rows[0].id, senderId, 5000, 'paystack']
    );
    console.log('Inserted test payment');

    // 4. Test filtering query
    const driverState = 'Lagos';
    const result = await pool.query(
      `SELECT p.id, p.pickup_state
       FROM parcels p
       WHERE p.status = 'created'
         AND p.pickup_state = $1
         AND EXISTS (SELECT 1 FROM payments pay WHERE pay.parcel_id = p.id AND pay.payment_status = 'completed')
         AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.parcel_id = p.id)`,
      [driverState]
    );
    
    console.log('Found parcels for Lagos driver:', result.rows.length);
    if (result.rows.some(r => r.id === testParcel.rows[0].id)) {
      console.log('SUCCESS: Lagos parcel found for Lagos driver');
    } else {
      console.log('FAILURE: Lagos parcel NOT found for Lagos driver');
    }

    // Cleanup
    await pool.query('DELETE FROM payments WHERE parcel_id = $1', [testParcel.rows[0].id]);
    await pool.query('DELETE FROM parcels WHERE id = $1', [testParcel.rows[0].id]);
    console.log('Cleanup completed');

    console.log('--- Verification Finished Successfully ---');
    process.exit(0);
  } catch (err) {
    console.error('Verification failed:', err);
    process.exit(1);
  }
}

verify();
