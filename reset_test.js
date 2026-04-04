const pool = require('./src/config/database');

async function reset() {
  const testParcelId = '11111111-1111-1111-1111-111111111111';
  try {
    await pool.query('DELETE FROM assignments WHERE parcel_id = $1', [testParcelId]);
    await pool.query("UPDATE parcels SET status = 'paid' WHERE id = $1", [testParcelId]);
    console.log('--- TEST-CLAIM RESET ---');
  } catch (error) {
    console.error(error);
  } finally {
    process.exit();
  }
}
reset();
