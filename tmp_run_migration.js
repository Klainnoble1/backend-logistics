const pool = require('./src/config/database');

async function run() {
  const client = await pool.connect();
  try {
    console.log('Adding "paid" to parcel_status enum...');
    // ADD VALUE cannot be run inside a transaction block in older PG versions
    try {
      await client.query("ALTER TYPE parcel_status ADD VALUE 'paid' AFTER 'created'");
      console.log('✓ Added "paid" value');
    } catch (e) {
      if (e.code === '42710') {
        console.log('- "paid" value already exists');
      } else {
        console.error('- Error adding "paid" value:', e.message);
      }
    }

    console.log('Adding "delivery_code" column...');
    await client.query("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS delivery_code VARCHAR(8)");
    console.log('✓ Added "delivery_code" column');

    console.log('Generating codes for existing parcels...');
    await client.query(`
      UPDATE parcels 
      SET delivery_code = LPAD(floor(random() * 100000000)::text, 8, '0')
      WHERE delivery_code IS NULL
    `);
    console.log('✓ Generated codes');

    console.log('\nMigration successful!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
