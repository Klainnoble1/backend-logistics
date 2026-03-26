const pool = require('./src/config/database');
const fs = require('fs');

async function checkSchema() {
  try {
    const parcelCols = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'parcels'
      ORDER BY ordinal_position
    `);
    
    const driverCols = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'drivers'
      ORDER BY ordinal_position
    `);

    const schema = {
      parcels: parcelCols.rows.map(r => r.column_name),
      drivers: driverCols.rows.map(r => r.column_name)
    };

    fs.writeFileSync('schema_debug.json', JSON.stringify(schema, null, 2));
    console.log('Schema written to schema_debug.json');
    process.exit(0);
  } catch (err) {
    console.error('Check schema error:', err);
    process.exit(1);
  }
}

checkSchema();
