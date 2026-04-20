const { calculatePrice } = require('./src/services/pricingService');
require('dotenv').config();

async function test() {
  try {
    console.log('--- Testing Intra-city (Lagos) ---');
    const p1 = await calculatePrice(
      'Allen Avenue, Ikeja, Lagos',
      'Adetokunbo Ademola Street, Victoria Island, Lagos',
      1, // 1kg
      'standard',
      false // no insurance
    );
    console.log('Result:', JSON.stringify(p1, null, 2));

    console.log('\n--- Testing Short Distance ---');
    const p2 = await calculatePrice(
      '1 Ozumba Mbadiwe Ave, Victoria Island, Lagos',
      '10 Adetokunbo Ademola St, Victoria Island, Lagos',
      1,
      'standard',
      false
    );
    console.log('Result:', JSON.stringify(p2, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

test();
