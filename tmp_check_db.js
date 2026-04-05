const pool = require('./src/config/database');
async function check() {
  const result = await pool.query('SELECT * FROM pricing_rules WHERE is_active = true ORDER BY created_at DESC LIMIT 1');
  console.log('PRICING RULE:', JSON.stringify(result.rows[0], null, 2));

  const states = await pool.query('SELECT * FROM state_pricing WHERE is_active = true');
  console.log('STATE PRICING:', JSON.stringify(states.rows, null, 2));
  process.exit(0);
}
check().catch(err => { console.error(err); process.exit(1); });
