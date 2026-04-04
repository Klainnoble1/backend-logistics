const pool = require('./src/config/database');

async function check() {
  try {
    const result = await pool.query("SELECT * FROM parcels WHERE tracking_id = 'TEST-WIRING'");
    console.log(JSON.stringify(result.rows));
  } catch (error) {
    console.error(error);
  } finally {
    process.exit();
  }
}
check();
