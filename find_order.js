const pool = require('./src/config/database');
const fs = require('fs');

async function findOrder() {
  try {
    const result = await pool.query(
      `SELECT p.id, p.tracking_id, p.recipient_name, p.status, p.pickup_state, p.pickup_address, p.delivery_address, pay.payment_status
       FROM parcels p 
       LEFT JOIN payments pay ON p.id = pay.parcel_id
       ORDER BY p.created_at DESC
       LIMIT 5`
    );

    fs.writeFileSync('find_order.json', JSON.stringify(result.rows, null, 2));
    process.exit(0);
  } catch (err) {
    fs.writeFileSync('find_order.json', JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

findOrder();
