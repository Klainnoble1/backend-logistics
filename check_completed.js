const pool = require('./src/config/database');

async function checkRecentCompleted() {
  try {
    const res = await pool.query(`
      SELECT p.id, p.status, p.tracking_id, pay.payment_status, 
             a.id as assignment_id, a.status as assignment_status 
      FROM parcels p 
      LEFT JOIN payments pay ON p.id = pay.parcel_id 
      LEFT JOIN assignments a ON p.id = a.parcel_id
      WHERE p.status = 'delivered'
      ORDER BY p.updated_at DESC
      LIMIT 5
    `);
    console.log('Recently delivered parcels:', res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

checkRecentCompleted();
