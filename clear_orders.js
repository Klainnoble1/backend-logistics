/**
 * clear_orders.js
 * 
 * Clears all order-related data from the database to start fresh.
 * Preserves: users, drivers, pricing_rules, admin_activity, audit_logs, withdrawals
 * Clears:    notifications, parcel_status_history, assignments, payments, parcels
 */

require('dotenv').config();
const pool = require('./src/config/database');

async function clearOrders() {
  const client = await pool.connect();
  try {
    console.log('🔌 Connected to database.');
    console.log('⚠️  Starting order data wipe...\n');

    await client.query('BEGIN');

    // 1. Notifications (references parcels)
    const notif = await client.query('DELETE FROM notifications WHERE parcel_id IS NOT NULL');
    console.log(`✅ Deleted ${notif.rowCount} parcel notifications`);

    // 2. Parcel status history (references parcels)
    const history = await client.query('DELETE FROM parcel_status_history');
    console.log(`✅ Deleted ${history.rowCount} parcel status history records`);

    // 3. Assignments (references parcels & drivers)
    const assign = await client.query('DELETE FROM assignments');
    console.log(`✅ Deleted ${assign.rowCount} assignments`);

    // 4. Payments (references parcels)
    const payments = await client.query('DELETE FROM payments');
    console.log(`✅ Deleted ${payments.rowCount} payments`);

    // 5. Parcels (main orders table)
    const parcels = await client.query('DELETE FROM parcels');
    console.log(`✅ Deleted ${parcels.rowCount} parcels/orders`);

    await client.query('COMMIT');

    console.log('\n🎉 All orders cleared successfully!');
    console.log('ℹ️  Preserved: users, drivers, pricing_rules, withdrawals, audit_logs, admin_activity');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error clearing orders — transaction rolled back.');
    console.error(err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

clearOrders();
