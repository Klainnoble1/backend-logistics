const pool = require('./src/config/database');

async function checkParcel() {
  try {
    const res = await pool.query(`SELECT status FROM parcels WHERE tracking_id = 'IVEADFNPLU'`);
    console.log('Parcel IVEADFNPLU status:', res.rows[0]);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

checkParcel();
