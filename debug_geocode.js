const { geocodeAddress } = require('./src/services/pricingService');
require('dotenv').config();

async function test() {
  console.log('TESTING GEOCODING...');
  const addr1 = 'Lagos, Nigeria';
  const addr2 = 'Abuja, Nigeria';
  
  const res1 = await geocodeAddress(addr1);
  console.log('ADDR 1:', res1);

  const res2 = await geocodeAddress(addr2);
  console.log('ADDR 2:', res2);
  
  process.exit(0);
}
test().catch(err => { console.error(err); process.exit(1); });
