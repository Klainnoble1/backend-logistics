require('dotenv').config();
const pool = require('./src/config/database');
const crypto = require('crypto');
const generateDeliveryCode = require('./src/utils/generateDeliveryCode');
const { calculatePrice } = require('./src/services/pricingService');

async function createOyoOrder() {
  try {
    // Find the specific user
    const email = 'kilidnodbull@gmail.com';
    const userRes = await pool.query("SELECT id, email FROM users WHERE email = $1", [email]);
    if (userRes.rows.length === 0) {
      console.log(`User ${email} not found in database!`);
      process.exit(1);
    }
    const userId = userRes.rows[0].id;
    const userEmail = userRes.rows[0].email;
    console.log(`Using user: ${userEmail} (ID: ${userId})`);

    // 1. Define Oyo State addresses (Ibadan)
    const pickupAddress = 'Ibadan Airport, Ibadan, Oyo State';
    const deliveryAddress = 'Oyo State Government House, Agodi, Ibadan';
    const weight = 2.0;
    const serviceType = 'standard';
    const insurance = false;

    console.log('--- Step 1: Calculating price for Oyo State ---');
    console.log(`Pickup: ${pickupAddress}`);
    console.log(`Delivery: ${deliveryAddress}`);

    const pricing = await calculatePrice(pickupAddress, deliveryAddress, weight, serviceType, insurance);
    console.log(`Distance: ${pricing.distance} km`);
    console.log(`Price: ₦${pricing.price}`);
    console.log(`States: ${pricing.pickupState} -> ${pricing.deliveryState}`);

    const trackingId = 'OYO-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const deliveryCode = generateDeliveryCode();
    
    console.log('\n--- Step 2: Inserting into database ---');
    const parcelRes = await pool.query(
      `INSERT INTO parcels (
        tracking_id, sender_id, recipient_name, recipient_phone, 
        pickup_address, delivery_address, weight, service_type, 
        status, price, pickup_state, delivery_state, delivery_code,
        parcel_type, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id, tracking_id`,
      [
        trackingId, 
        userId, 
        'Oyo Test Recipient', 
        '09088776655', 
        pickupAddress, 
        deliveryAddress, 
        weight, 
        serviceType, 
        'paid', // Mark as paid so it shows up for drivers
        pricing.price,
        pricing.pickupState || 'oyo',
        pricing.deliveryState || 'oyo',
        deliveryCode,
        'Box',
        'Test order for Oyo State addresses'
      ]
    );
    
    const parcelId = parcelRes.rows[0].id;
    
    // Add payment record
    await pool.query(
      `INSERT INTO payments (parcel_id, user_id, amount, payment_status, transaction_id, payment_method)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [parcelId, userId, pricing.price, 'completed', 'TEST_OYO_' + trackingId, 'paystack']
    );

    // Add status history
    await pool.query(
      `INSERT INTO parcel_status_history (parcel_id, status, location, updated_by, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [parcelId, 'created', pickupAddress, userId, 'Parcel created in Oyo State']
    );

    await pool.query(
      `INSERT INTO parcel_status_history (parcel_id, status, location, updated_by, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [parcelId, 'paid', pickupAddress, userId, 'Payment verified']
    );
    
    console.log('\n✅ Oyo State test order created successfully!');
    console.log('Tracking ID:', trackingId);
    console.log('Final Price:', pricing.price);
    console.log('Delivery Code:', deliveryCode);
    process.exit(0);
  } catch (error) {
    console.error('Error creating Oyo order:', error);
    process.exit(1);
  }
}

createOyoOrder();
