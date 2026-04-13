const pool = require('./src/config/database');

async function checkParcelFull() {
  try {
    const res = await pool.query(`
      SELECT p.id, p.status, p.tracking_id, pay.payment_status, 
             a.id as assignment_id, a.status as assignment_status 
      FROM parcels p 
      LEFT JOIN payments pay ON p.id = pay.parcel_id 
      LEFT JOIN assignments a ON p.id = a.parcel_id
      WHERE p.tracking_id = 'IVEADFNPLU'
    `);
    console.log('Full parcel info:', res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

checkParcelFull();
