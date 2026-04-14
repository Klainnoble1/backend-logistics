const { Client } = require('pg');
require('dotenv').config();

async function verify() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  try {
    await client.connect();
    console.log('SUCCESS: Connected to DB');

    // Test the specific join that was failing
    const query = `
      SELECT w.id, d.full_name as driver_name
      FROM withdrawals w
      INNER JOIN drivers d ON w.driver_id = d.id
      LIMIT 1
    `;
    const res = await client.query(query);
    console.log('QUERY SUCCESS: Found', res.rows.length, 'withdrawals');
    if (res.rows.length > 0) {
      console.log('Sample driver name:', res.rows[0].driver_name);
    }
  } catch (err) {
    console.error('FAILURE:', err.message);
  } finally {
    await client.end();
  }
}

verify();
