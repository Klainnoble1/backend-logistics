const pool = require('./src/config/database');

async function checkPayment() {
  try {
    const res = await pool.query(`SELECT p.status, p.tracking_id, pay.payment_status 
                                  FROM parcels p 
                                  LEFT JOIN payments pay ON p.id = pay.parcel_id 
                                  WHERE p.tracking_id = 'IVEADFNPLU'`);
    console.log('Payment query result:', res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

checkPayment();
