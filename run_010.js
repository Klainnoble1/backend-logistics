const pool = require('./src/config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'database/migrations/010_add_state_fields.sql'), 'utf8');
    await pool.query(sql);
    console.log('Migration 010 applied successfully');
    process.exit(0);
  } catch (err) {
    console.error('Migration 010 failed:', err);
    process.exit(1);
  }
}

runMigration();
