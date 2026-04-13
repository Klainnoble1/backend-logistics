const pool = require('./src/config/database');

async function checkHistoryAndPayments() {
  try {
    const parcelIdRes = await pool.query("SELECT id FROM parcels WHERE tracking_id = 'IVEADFNPLU'");
    if (parcelIdRes.rows.length === 0) {
      console.log('Parcel not found');
      return;
    }
    const parcelId = parcelIdRes.rows[0].id;

    const history = await pool.query(
      "SELECT * FROM parcel_status_history WHERE parcel_id = $1 ORDER BY updated_at DESC",
      [parcelId]
    );
    console.log('--- Status History ---');
    console.log(history.rows);

    const payments = await pool.query(
      "SELECT * FROM payments WHERE parcel_id = $1 ORDER BY created_at DESC",
      [parcelId]
    );
    console.log('--- Payments ---');
    console.log(payments.rows);

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

checkHistoryAndPayments();
