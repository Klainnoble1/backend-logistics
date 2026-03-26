const pool = require('./src/config/database');
const fs = require('fs');

async function runSplitted() {
  const sql = fs.readFileSync('database/migrations/009_nationwide_pricing.sql', 'utf8');
  const lines = sql.split('\n');
  
  console.log(`Starting migration of ${lines.length} lines...`);
  let count = 0;
  
  // We'll execute in a single connection to be faster
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('--')) continue;
      
      await client.query(trimmed);
      count++;
      if (count % 100 === 0) console.log(`Processed ${count} statements...`);
    }
    await client.query('COMMIT');
    console.log(`DONE! Applied ${count} pricing rules.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    console.error('At line:', count);
  } finally {
    client.release();
    process.exit();
  }
}

runSplitted();
