/**
 * Deep diagnostic: checks what Google says about the key and project
 * Usage: node backend/scripts/diagnoseMaps.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');

const KEY = process.env.GOOGLE_MAPS_API_KEY;
console.log('\n🔑  Key being used:', KEY ? KEY.slice(0, 10) + '...' + KEY.slice(-4) : 'NOT SET');

async function tryGeocodeRaw() {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=Lagos,Nigeria&key=${KEY}`;
  console.log('\n📡  Raw request URL (key masked):');
  console.log('   ', url.replace(KEY, KEY.slice(0, 10) + '...' + KEY.slice(-4)));
  const res = await axios.get(url, { timeout: 10000 });
  console.log('\n📦  Full Google response:');
  console.log(JSON.stringify(res.data, null, 2));
}

async function tryStaticMapPing() {
  // Static Maps API - separate API, tests if the key itself is valid at all
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=6.5244,3.3792&zoom=10&size=100x100&key=${KEY}`;
  try {
    const res = await axios.get(url, { timeout: 10000, responseType: 'arraybuffer' });
    const contentType = res.headers['content-type'];
    if (contentType?.includes('image')) {
      console.log('\n✅  Static Maps API: Key is VALID (returned an image)');
    } else {
      console.log('\n⚠️   Static Maps API: Unexpected content-type:', contentType);
    }
  } catch (err) {
    console.log('\n❌  Static Maps API ping failed:', err.message);
  }
}

(async () => {
  try {
    await tryStaticMapPing();
    await tryGeocodeRaw();
  } catch (err) {
    console.error('\n❌  Diagnostic failed:', err.message);
    if (err.response) {
      console.log('Response status:', err.response.status);
      console.log('Response data:', err.response.data?.toString?.().slice(0, 500));
    }
  }
})();
