const pool = require('../src/config/database');

async function verifyDatabase() {
  try {
    // Get all tables
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE' 
      ORDER BY table_name
    `);

    console.log('\n✅ Database Tables:');
    tablesResult.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    // Check pricing rules
    const pricingResult = await pool.query('SELECT COUNT(*) as count FROM pricing_rules');
    console.log(`\n✅ Default pricing rule: ${pricingResult.rows[0].count > 0 ? 'Created' : 'Missing'}`);

    // Check indexes
    const indexesResult = await pool.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      ORDER BY indexname
    `);
    console.log(`\n✅ Indexes created: ${indexesResult.rows.length}`);

    console.log('\n✅ Database setup complete!');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

verifyDatabase();


