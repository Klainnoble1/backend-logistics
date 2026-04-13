const pool = require('./src/config/database');

async function verify() {
  try {
    const driverCols = await pool.query(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name = 'drivers' AND column_name IN ('bank_name','account_number','account_name') 
       ORDER BY column_name`
    );
    console.log('✓ Drivers banking columns:', driverCols.rows.map(x => x.column_name));

    const wCols = await pool.query(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name = 'withdrawals' 
       ORDER BY ordinal_position`
    );
    console.log('✓ Withdrawals table columns:', wCols.rows.map(x => x.column_name));
    
    console.log('\n✅ Schema verification complete!');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

verify();
