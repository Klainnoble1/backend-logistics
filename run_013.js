const fs = require('fs');
const path = require('path');
const pool = require('./src/config/database');

async function run013() {
  const sqlFile = path.join(__dirname, 'database', 'migrations', '013_admin_audit_and_activity.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');
  
  const client = await pool.connect();
  try {
    console.log('Running 013 migration...');
    await client.query(sql);
    console.log('✓ 013 completed!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

run013();
