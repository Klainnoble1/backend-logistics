const pool = require('./src/config/database');

async function checkSchema() {
  try {
    const parcelCols = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'parcels'
      ORDER BY ordinal_position
    `);
    console.log('PARCEL_COLUMNS:' + JSON.stringify(parcelCols.rows.map(r => r.column_name)));

    const driverCols = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'drivers'
      ORDER BY ordinal_position
    `);
    console.log('DRIVER_COLUMNS:' + JSON.stringify(driverCols.rows.map(r => r.column_name)));

    process.exit(0);
  } catch (err) {
    console.error('Check schema error:', err);
    process.exit(1);
  }
}

checkSchema();
