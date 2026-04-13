require('dotenv').config();
const pool = require('./src/config/database');

async function fixDeliveryCodes() {
  await pool.query("UPDATE parcels SET delivery_code = LPAD(floor(random() * 100000000)::text, 8, '0') WHERE delivery_code IS NULL");
  console.log('Fixed delivery codes');
  process.exit(0);
}
fixDeliveryCodes();
