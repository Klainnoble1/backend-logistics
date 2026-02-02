/**
 * Seed script: create admin user in the same users table used by the API.
 * Set ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME in .env or use defaults below.
 * Run: npm run seed
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/config/database');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@oprime.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin123!';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Oprime Admin';

async function seed() {
  try {
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
    console.log('Admin user created successfully.');
    console.log('Email:', ADMIN_EMAIL);
    console.log('Password:', ADMIN_PASSWORD);
    console.log('(Change password after first login if using default.)');
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
