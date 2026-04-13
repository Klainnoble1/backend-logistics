require('dotenv').config();
const pool = require('./src/config/database');
const crypto = require('crypto');
const generateDeliveryCode = require('./src/utils/generateDeliveryCode');

async function createTestOrder() {
  try {
    const email = 'kilidnodbull@gmail.com';
    const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (userRes.rows.length === 0) {
      console.log('User not found!');
      process.exit(1);
    }
    const userId = userRes.rows[0].id;
    
    const trackingId = 'TRK' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const deliveryCode = generateDeliveryCode();
    
    const parcelRes = await pool.query(
      `INSERT INTO parcels (
        tracking_id, sender_id, recipient_name, recipient_phone, 
        pickup_address, delivery_address, weight, service_type, 
        status, price, pickup_state, delivery_state, delivery_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id, tracking_id`,
      [
        trackingId, 
        userId, 
        'Moyo (Test Recipient 2)', 
        '08012345678', 
        'Bodija Market Road, Oyo', 
        'UI Campus area, Oyo', 
        3.5, 
        'standard', 
        'paid', 
        2500.00,
        'oyo',
        'oyo',
        deliveryCode
      ]
    );
    
    const parcelId = parcelRes.rows[0].id;
    
    await pool.query(
      `INSERT INTO payments (parcel_id, user_id, amount, payment_method, payment_status, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [parcelId, userId, 2500.00, 'paystack', 'completed', 'TEST_TXN_' + trackingId]
    );
    
    console.log('Test order created successfully!');
    console.log('Tracking ID:', trackingId);
    console.log('Delivery Code:', deliveryCode);
    process.exit(0);
  } catch (error) {
    console.error('Error creating order:', error);
    process.exit(1);
  }
}

createTestOrder();
