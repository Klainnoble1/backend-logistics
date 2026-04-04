const pool = require('./src/config/database');

// MOCK DATA for TEST-CLAIM
const parcelId = '11111111-1111-1111-1111-111111111111';
const driverUserId = '88888888-8888-8888-8888-888888888888'; // From previous verify script?
// No, I need a REAL driver.
// Actually, I can just use my test driver created previously if it exists.

async function testClaim() {
  const testDriverUserId = '88888888-8888-8888-8888-888888888888';
  const testDriverId = '77777777-7777-7777-7777-777777777777';

  try {
    console.log('--- TEST CLAIM START ---');
    
    // Ensure test driver exists
    await pool.query('INSERT INTO users (id, full_name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
      [testDriverUserId, 'Test Driver Mock', 'testmock@example.com', 'h', 'driver']);
    await pool.query('INSERT INTO drivers (id, user_id, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [testDriverId, testDriverUserId, 'available']);

    // Attempt claim SQL
    await pool.query('BEGIN');
    
    const res = await pool.query(
      `INSERT INTO assignments (parcel_id, driver_id, assigned_by, status)
       VALUES ($1, $2, $3, 'accepted')
       RETURNING *`,
      [parcelId, testDriverId, testDriverUserId]
    );
    console.log('Assignment created:', res.rows[0]);

    await pool.query(
      'UPDATE drivers SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['busy', testDriverId]
    );
    
    await pool.query(
      `UPDATE parcels SET status = 'picked_up' WHERE id = $1`,
      [parcelId]
    );

    await pool.query('COMMIT');
    console.log('--- TEST CLAIM END (SUCCESS) ---');
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('--- TEST CLAIM FAILED ---');
    console.error(error);
  } finally {
    process.exit();
  }
}
testClaim();
