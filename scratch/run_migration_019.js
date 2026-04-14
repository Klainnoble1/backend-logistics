const pool = require('../src/config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const sql = fs.readFileSync(path.join(__dirname, '../database/migrations/019_relax_assignment_constraints.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('MIGRATION SUCCESS: 019_relax_assignment_constraints.sql');
    process.exit(0);
  } catch (err) {
    console.error('MIGRATION FAILED:', err.message);
    process.exit(1);
  }
}

runMigration();
