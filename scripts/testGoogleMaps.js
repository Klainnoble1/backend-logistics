/**
 * Quick test: Verifies Google Geocoding + Distance Matrix APIs using the key in .env
 * Usage: node backend/scripts/testGoogleMaps.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');

const KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!KEY || KEY === 'PASTE_YOUR_KEY_HERE') {
  console.error('❌  GOOGLE_MAPS_API_KEY is not set in backend/.env');
  process.exit(1);
}

const PICKUP   = '1 Ozumba Mbadiwe Avenue, Victoria Island, Lagos';
const DELIVERY = 'Murtala Muhammed Airport, Ikeja, Lagos';

async function testGeocoding(address) {
  const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
    params: { address: `${address}, Nigeria`, key: KEY, region: 'ng' },
  });

  // Always print the raw status + error from Google for diagnosis
  console.log(`  [Google status: ${res.data.status}${res.data.error_message ? ' | ' + res.data.error_message : ''}]`);

  const result = res.data.results?.[0];
  if (!result) throw new Error(`No geocoding result for: ${address} (status: ${res.data.status})`);
  const { lat, lng } = result.geometry.location;
  const statePart = result.address_components?.find(c => c.types.includes('administrative_area_level_1'));
  return { lat, lon: lng, state: statePart?.long_name ?? null, formatted: result.formatted_address };
}

async function testDistanceMatrix(pickup, delivery) {
  const res = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
    params: {
      origins: `${pickup.lat},${pickup.lon}`,
      destinations: `${delivery.lat},${delivery.lon}`,
      mode: 'driving',
      key: KEY,
      region: 'ng',
    },
  });
  const element = res.data.rows?.[0]?.elements?.[0];
  if (element?.status !== 'OK') throw new Error(`Distance Matrix status: ${element?.status}`);
  return {
    distanceKm: Math.round((element.distance.value / 1000) * 10) / 10,
    durationMinutes: Math.round(element.duration.value / 60),
  };
}

(async () => {
  try {
    console.log('\n🌍  Testing Google Geocoding API...');
    const pickupCoords  = await testGeocoding(PICKUP);
    const deliveryCoords = await testGeocoding(DELIVERY);
    console.log(`  ✅ Pickup:   ${pickupCoords.formatted}  (${pickupCoords.lat}, ${pickupCoords.lon}) | State: ${pickupCoords.state}`);
    console.log(`  ✅ Delivery: ${deliveryCoords.formatted}  (${deliveryCoords.lat}, ${deliveryCoords.lon}) | State: ${deliveryCoords.state}`);

    console.log('\n🚗  Testing Google Distance Matrix API...');
    const route = await testDistanceMatrix(pickupCoords, deliveryCoords);
    console.log(`  ✅ Distance: ${route.distanceKm} km | Drive time: ${route.durationMinutes} minutes`);

    console.log('\n🎉  All Google Maps APIs working correctly!\n');
  } catch (err) {
    console.error('\n❌  Test failed:', err.message);
    process.exit(1);
  }
})();
