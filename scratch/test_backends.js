const axios = require('axios');

async function testBackends() {
  const vercelUrl = 'https://backend-logistics-eight.vercel.app/api';
  const localUrl = 'http://localhost:3000/api';

  console.log('--- Testing Backends ---');

  try {
    const res = await axios.get(`${vercelUrl}/parcels/track/TEST`, { timeout: 5000 });
    console.log('Vercel Backend: SUCCESS (Status:', res.status, ')');
  } catch (err) {
    console.log('Vercel Backend: FAILED (', err.message, ')');
    if (err.response) console.log('Response:', err.response.data);
  }

  try {
    const res = await axios.get(`${localUrl}/parcels/track/TEST`, { timeout: 5000 });
    console.log('Local Backend: SUCCESS (Status:', res.status, ')');
  } catch (err) {
    console.log('Local Backend: FAILED (', err.message, ')');
  }
}

testBackends();
