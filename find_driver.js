const pool = require('./src/config/database');
async function run() {
  const r = await pool.query("SELECT id, full_name, phone FROM drivers LIMIT 1");
  console.log(r.rows[0]);
  process.exit(0);
}
run();
