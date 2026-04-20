const pool = require('./src/config/database');
async function run() {
  const r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'assignments'");
  console.log(r.rows.map(c => c.column_name));
  process.exit(0);
}
run();
