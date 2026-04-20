const pool = require('./src/config/database');
async function verify() {
  const trackingId = 'OYO-0A18A0';
  const query = `
    SELECT p.*, a.rating, a.review_comment, a.delivery_confirmed_at,
           d.full_name as driver_name, d.phone as driver_phone, d.profile_pic as driver_image
    FROM parcels p
    LEFT JOIN assignments a ON p.id = a.parcel_id
    LEFT JOIN drivers d ON a.driver_id = d.id
    WHERE p.tracking_id = $1
  `;
  const res = await pool.query(query, [trackingId]);
  console.log(JSON.stringify(res.rows[0], null, 2));
  process.exit(0);
}
verify();
