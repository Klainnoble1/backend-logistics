/**
 * Seed script: create admin and driver users in the same users table used by the API.
 * Set ADMIN_* / DRIVER_* in .env or use defaults below.
 * Run: npm run seed
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/config/database');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@oprime.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin123!';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Oprime Admin';

const DRIVER_EMAIL = process.env.DRIVER_EMAIL || 'driver@oprime.com';
const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD || 'Driver123!';
const DRIVER_NAME = process.env.DRIVER_NAME || 'Oprime Driver';

async function seedAdmin() {
  const { rows: existing } = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [ADMIN_EMAIL]
  );
  if (existing.length > 0) {
    console.log('Admin user already exists:', ADMIN_EMAIL);
    return;
  }
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await pool.query(
    `INSERT INTO users (email, full_name, password_hash, role)
     VALUES ($1, $2, $3, 'admin')`,
    [ADMIN_EMAIL, ADMIN_NAME, passwordHash]
  );
  console.log('Admin user created:', ADMIN_EMAIL);
}

async function seedDriver() {
  const { rows: existing } = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [DRIVER_EMAIL]
  );
  if (existing.length > 0) {
    console.log('Driver user already exists:', DRIVER_EMAIL);
    return;
  }
  const passwordHash = await bcrypt.hash(DRIVER_PASSWORD, 10);
  const result = await pool.query(
    `INSERT INTO users (email, full_name, password_hash, role)
     VALUES ($1, $2, $3, 'driver')
     RETURNING id`,
    [DRIVER_EMAIL, DRIVER_NAME, passwordHash]
  );
  const userId = result.rows[0].id;
  await pool.query(
    'INSERT INTO drivers (user_id) VALUES ($1)',
    [userId]
  );
  console.log('Driver user created:', DRIVER_EMAIL);
  console.log('Driver credentials - Email:', DRIVER_EMAIL, 'Password:', DRIVER_PASSWORD);
}

async function seed() {
  try {
    await seedAdmin();
    await seedDriver();
    console.log('Seed completed.');
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
