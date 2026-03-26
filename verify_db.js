const { Pool } = require('pg');
require('dotenv').config();

async function verify() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const statusRes = await pool.query("SELECT payment_status, count(*) FROM payments GROUP BY payment_status");
    console.log('--- Status Summary ---');
    statusRes.rows.forEach(r => console.log(`${r.payment_status}: ${r.count}`));

    const paymentRes = await pool.query("SELECT id, parcel_id, amount, payment_status, created_at FROM payments ORDER BY created_at DESC LIMIT 5");
    console.log('\n--- Recent Payments ---');
    paymentRes.rows.forEach(r => console.log(`${r.id} | ${r.parcel_id} | ${r.amount} | ${r.payment_status} | ${r.created_at}`));

    const parcelRes = await pool.query("SELECT id, tracking_id, status, price, created_at FROM parcels ORDER BY created_at DESC LIMIT 5");
    console.log('\n--- Recent Parcels ---');
    parcelRes.rows.forEach(r => console.log(`${r.id} | ${r.tracking_id} | ${r.status} | ${r.price} | ${r.created_at}`));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

verify();
