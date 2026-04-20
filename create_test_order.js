require('dotenv').config();
const pool = require('./src/config/database');
const crypto = require('crypto');
const generateDeliveryCode = require('./src/utils/generateDeliveryCode');
const { calculatePrice } = require('./src/services/pricingService');

async function createTestOrder() {
  try {
    const email = 'kilidnodbull@gmail.com';
    const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (userRes.rows.length === 0) {
      console.log('User not found!');
      process.exit(1);
    }
    const userId = userRes.rows[0].id;
    
    // 1. Define test addresses
    const pickupAddress = 'Allen Avenue, Ikeja, Lagos';
    const deliveryAddress = 'Adetokunbo Ademola Street, Victoria Island, Lagos';
    const weight = 3.5;
    const serviceType = 'standard';
    const insurance = false;

    console.log('--- Step 1: Calculating price via Google Maps ---');
    const pricing = await calculatePrice(pickupAddress, deliveryAddress, weight, serviceType, insurance);
    console.log(`Distance: ${pricing.distance} km`);
    console.log(`Price: ₦${pricing.price}`);
    console.log(`States: ${pricing.pickupState} -> ${pricing.deliveryState}`);

    const trackingId = 'TRK' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const deliveryCode = generateDeliveryCode();
    
    console.log('\n--- Step 2: Inserting into database ---');
    const parcelRes = await pool.query(
      `INSERT INTO parcels (
        tracking_id, sender_id, recipient_name, recipient_phone, 
        pickup_address, delivery_address, weight, service_type, 
        status, price, pickup_state, delivery_state, delivery_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id, tracking_id`,
      [
        trackingId, 
        userId, 
        'Test Recipient (Google Map Test)', 
        '08012345678', 
        pickupAddress, 
        deliveryAddress, 
        weight, 
        serviceType, 
        'paid', 
        pricing.price,
        pricing.pickupState || 'lagos',
        pricing.deliveryState || 'lagos',
        deliveryCode
      ]
    );
    
    const parcelId = parcelRes.rows[0].id;
    
    await pool.query(
      `INSERT INTO payments (parcel_id, user_id, amount, payment_status, transaction_id, payment_method)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [parcelId, userId, pricing.price, 'completed', 'TEST_TXN_' + trackingId, 'paystack']
    );
    
    console.log('\n✅ Test order created successfully!');
    console.log('Tracking ID:', trackingId);
    console.log('Final Price:', pricing.price);
    console.log('Delivery Code:', deliveryCode);
    process.exit(0);
  } catch (error) {
    console.error('Error creating order:', error);
    process.exit(1);
  }
}

createTestOrder();
