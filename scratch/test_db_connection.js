const { Client } = require('pg');
require('dotenv').config();

async function test() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('SUCCESS: Connected to database');
    const res = await client.query('SELECT NOW()');
    console.log('Current time from DB:', res.rows[0].now);
  } catch (err) {
    console.error('FAILURE: Could not connect to database');
    console.error('Error Code:', err.code);
    console.error('Error Message:', err.message);
    if (err.stack) console.error('Stack Trace:', err.stack);
  } finally {
    await client.end();
  }
}

test();
