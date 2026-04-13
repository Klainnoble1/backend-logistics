const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { notifyDriverAssignment, createNotification } = require('../services/notificationService');
const { hasCompletedPaymentForParcel } = require('../services/paymentService');
const { normalizeState } = require('../services/pricingService');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get all drivers (admin only)
router.get('/', authorize('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *, created_at as user_created_at
       FROM drivers
       ORDER BY created_at DESC`
    );

    res.json({ drivers: result.rows });
  } catch (error) {
    console.error('Get drivers error:', error);
    res.status(500).json({ error: 'Failed to get drivers' });
  }
});

// Get available drivers (admin only)
router.get('/available', authorize('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM drivers
       WHERE status = 'available'
       ORDER BY full_name`
    );

    res.json({ drivers: result.rows });
  } catch (error) {
    console.error('Get available drivers error:', error);
    res.status(500).json({ error: 'Failed to get available drivers' });
  }
});

// Get driver's own profile (including availability status)
router.get('/me', authorize('driver'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, status, state, license_number, vehicle_type, vehicle_plate,
              wallet_balance, completed_orders, average_rating,
              bank_name, account_number, account_name,
              full_name, email, phone
       FROM drivers
       WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }
    const row = result.rows[0];
    res.json({
      driver: {
        id: row.id,
        status: row.status,
        state: row.state,
        licenseNumber: row.license_number,
        vehicleType: row.vehicle_type,
        vehiclePlate: row.vehicle_plate,
        walletBalance: parseFloat(row.wallet_balance || 0),
        completedOrders: row.completed_orders || 0,
        averageRating: parseFloat(row.average_rating || 5.0),
        bankName: row.bank_name || null,
        accountNumber: row.account_number || null,
        accountName: row.account_name || null,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
      },
    });
  } catch (error) {
    console.error('Get driver me error:', error);
    res.status(500).json({ error: 'Failed to get driver profile' });
  }
});

// Get driver's own assignments
router.get('/me/assignments', authorize('driver'), async (req, res) => {
  try {
    // No need to fetch driver ID, req.user.id IS the driver ID now
    const driverId = req.user.id;
    
    // Check if driver profile exists
    const driverCheck = await pool.query(
      'SELECT id FROM drivers WHERE id = $1',
      [driverId]
    );

    if (driverCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    // Get assignments with parcel details (alias a.id so it's not overwritten by p.id)
    const result = await pool.query(
      `SELECT a.id as assignment_id, a.parcel_id, a.driver_id, a.assigned_at, a.assigned_by, a.status as assignment_status,
              p.id as parcel_id, p.tracking_id, p.sender_id, p.recipient_name, p.recipient_phone,
              p.pickup_address, p.delivery_address, p.parcel_type, p.weight, p.dimensions,
              p.service_type, p.status as parcel_status, p.current_location, p.estimated_delivery_date,
              p.actual_delivery_date, p.price, p.insurance, p.description, p.created_at as parcel_created_at, p.updated_at as parcel_updated_at,
              u.full_name as sender_name, u.email as sender_email
       FROM assignments a
       INNER JOIN parcels p ON a.parcel_id = p.id
       INNER JOIN users u ON p.sender_id = u.id
       WHERE a.driver_id = $1
         AND EXISTS (
           SELECT 1
           FROM payments pay
           WHERE pay.parcel_id = p.id
             AND pay.payment_status = 'completed'
         )
       ORDER BY a.assigned_at DESC`,
      [driverId]
    );

    const assignments = result.rows.map((r) => ({
      id: r.assignment_id,
      parcel_id: r.parcel_id,
      parcelId: r.parcel_id,
      driver_id: r.driver_id,
      driverId: r.driver_id,
      assigned_at: r.assigned_at,
      assignedAt: r.assigned_at,
      assigned_by: r.assigned_by,
      assignedBy: r.assigned_by,
      status: r.assignment_status,
      parcel: {
        id: r.parcel_id,
        tracking_id: r.tracking_id,
        trackingId: r.tracking_id,
        sender_id: r.sender_id,
        recipient_name: r.recipient_name,
        recipientName: r.recipient_name,
        recipient_phone: r.recipient_phone,
        recipientPhone: r.recipient_phone,
        pickup_address: r.pickup_address,
        pickupAddress: r.pickup_address,
        delivery_address: r.delivery_address,
        deliveryAddress: r.delivery_address,
        parcel_type: r.parcel_type,
        weight: r.weight,
        dimensions: r.dimensions,
        service_type: r.service_type,
        serviceType: r.service_type,
        status: r.parcel_status,
        current_location: r.current_location,
        currentLocation: r.current_location,
        estimated_delivery_date: r.estimated_delivery_date,
        estimatedDeliveryDate: r.estimated_delivery_date,
        actual_delivery_date: r.actual_delivery_date,
        actualDeliveryDate: r.actual_delivery_date,
        price: r.price,
        insurance: r.insurance,
        description: r.description,
        created_at: r.parcel_created_at,
        createdAt: r.parcel_created_at,
        updated_at: r.parcel_updated_at,
        updatedAt: r.parcel_updated_at,
        sender_name: r.sender_name,
        senderName: r.sender_name,
        sender_email: r.sender_email,
        senderEmail: r.sender_email,
      },
    }));

    res.json({ assignments });
  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).json({ error: 'Failed to get assignments' });
  }
});

// Accept assignment
router.post('/me/assignments/:id/accept', authorize('driver'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE assignments 
       SET status = 'accepted', updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND driver_id = $2
       RETURNING *`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found or not assigned to you' });
    }

    res.json({ message: 'Assignment accepted', assignment: result.rows[0] });
  } catch (error) {
    console.error('Accept assignment error:', error);
    res.status(500).json({ error: 'Failed to accept assignment' });
  }
});

// Decline assignment
router.post('/me/assignments/:id/decline', authorize('driver'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;

    // Get assignment and parcel details first
    const assignmentResult = await client.query(
      `SELECT a.*, p.status as parcel_status 
       FROM assignments a 
       JOIN parcels p ON a.parcel_id = p.id 
       WHERE a.id = $1 AND a.driver_id = $2`,
      [id, req.user.id]
    );

    if (assignmentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const assignment = assignmentResult.rows[0];

    // Delete assignment
    await client.query('DELETE FROM assignments WHERE id = $1', [id]);

    // Reset parcel status back to 'paid' so it's available for other drivers
    await client.query(
      `UPDATE parcels SET status = 'paid' WHERE id = $1`,
      [assignment.parcel_id]
    );

    // Reset driver status to 'available'
    await client.query(
      `UPDATE drivers SET status = 'available' WHERE id = $1`,
      [assignment.driver_id]
    );

    // Add to history
    await client.query(
      `INSERT INTO parcel_status_history (parcel_id, status, updated_by, notes)
       VALUES ($1, $2, $3, $4)`,
      [assignment.parcel_id, 'paid', req.user.id, 'Driver declined assignment, reset to paid']
    );

    await client.query('COMMIT');
    res.json({ message: 'Assignment declined and parcel released' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Decline assignment error:', error);
    res.status(500).json({ error: 'Failed to decline assignment' });
  } finally {
    client.release();
  }
});

// Get available parcels (not yet assigned) – drivers can pick from these
router.get('/me/available-parcels', authorize('driver'), async (req, res) => {
  try {
    // Get driver operating state
    const driverResult = await pool.query(
      'SELECT state FROM drivers WHERE id = $1',
      [req.user.id]
    );

    if (driverResult.rows.length === 0) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    const driverStateRaw = driverResult.rows[0].state;
    const driverState = normalizeState(driverStateRaw);

    if (!driverState) {
      return res.json({ 
        parcels: [], 
        message: 'Please set your operating state in your profile to see available parcels.' 
      });
    }

    const result = await pool.query(
      `SELECT p.id, p.tracking_id, p.recipient_name, p.recipient_phone,
              p.pickup_address, p.delivery_address, p.parcel_type, p.weight,
              p.service_type, p.status, p.price, p.estimated_delivery_date,
              p.created_at, u.full_name as sender_name
       FROM parcels p
       INNER JOIN users u ON p.sender_id = u.id
       WHERE LOWER(p.pickup_state) = $1
         AND (
           (p.status = 'paid')
           OR (
             p.status = 'created'
             AND EXISTS (
               SELECT 1 FROM payments pay
               WHERE pay.parcel_id = p.id AND pay.payment_status = 'completed'
             )
           )
         )
         AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.parcel_id = p.id)
       ORDER BY p.created_at DESC`,
      [driverState]
    );

    const parcels = result.rows.map((row) => ({
      id: row.id,
      trackingId: row.tracking_id,
      recipientName: row.recipient_name,
      recipientPhone: row.recipient_phone,
      pickupAddress: row.pickup_address,
      deliveryAddress: row.delivery_address,
      parcelType: row.parcel_type,
      weight: parseFloat(row.weight),
      serviceType: row.service_type,
      status: row.status,
      price: parseFloat(row.price),
      estimatedDeliveryDate: row.estimated_delivery_date,
      createdAt: row.created_at,
      senderName: row.sender_name,
    }));

    res.json({ parcels });
  } catch (error) {
    console.error('Get available parcels error:', error);
    res.status(500).json({ error: 'Failed to get available parcels' });
  }
});

// Claim a parcel (driver self-assigns)
router.post('/me/claim', [
  body('parcelId').isUUID(),
], authorize('driver'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { parcelId } = req.body;

    const driverResult = await pool.query(
      'SELECT id, status FROM drivers WHERE id = $1',
      [req.user.id]
    );

    if (driverResult.rows.length === 0) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    const driverId = driverResult.rows[0].id;

    const parcelResult = await pool.query(
      'SELECT id, status FROM parcels WHERE id = $1',
      [parcelId]
    );

    if (parcelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Parcel not found' });
    }

    const parcel = parcelResult.rows[0];
    const hasCompletedPayment = await hasCompletedPaymentForParcel(parcelId);

    if (parcel.status !== 'paid' && !(parcel.status === 'created' && hasCompletedPayment)) {
      return res.status(400).json({ error: 'Parcel is not available for delivery (must be paid first)' });
    }

    const assignmentCheck = await pool.query(
      'SELECT id FROM assignments WHERE parcel_id = $1',
      [parcelId]
    );

    if (assignmentCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Parcel is already assigned to another driver' });
    }

    const assignmentResult = await pool.query(
      `INSERT INTO assignments (parcel_id, driver_id, assigned_by, status)
       VALUES ($1, $2, $3, 'accepted')
       RETURNING *`,
      [parcelId, driverId, req.user.id]
    );

    await pool.query(
      'UPDATE drivers SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['busy', driverId]
    );

    await pool.query(
      `UPDATE parcels SET status = 'assigned' WHERE id = $1`,
      [parcelId]
    );

    await pool.query(
      `INSERT INTO parcel_status_history (parcel_id, status, updated_by, notes)
       VALUES ($1, $2, $3, $4)`,
      [parcelId, 'assigned', req.user.id, 'Driver claimed parcel (Assigned)']
    );

    notifyDriverAssignment(driverId, parcelId).catch((err) =>
      console.error('Notify driver assignment failed:', err)
    );

    res.status(201).json({
      message: 'Parcel claimed successfully',
      assignment: assignmentResult.rows[0],
    });
  } catch (error) {
    console.error('Claim parcel error:', error);
    res.status(500).json({ error: 'Failed to claim parcel' });
  }
});

// Update driver status
router.put('/me/status', [
  body('status').isIn(['available', 'busy', 'offline'])
], authorize('driver'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { status } = req.body;

    const result = await pool.query(
      `UPDATE drivers 
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [status, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    res.json({
      message: 'Driver status updated successfully',
      driver: result.rows[0]
    });
  } catch (error) {
    console.error('Update driver status error:', error);
    res.status(500).json({ error: 'Failed to update driver status' });
  }
});

// Update driver location
router.put('/me/location', [
  body('latitude').isFloat({ min: -90, max: 90 }),
  body('longitude').isFloat({ min: -180, max: 180 })
], authorize('driver'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { latitude, longitude } = req.body;

    const result = await pool.query(
      `UPDATE drivers 
       SET current_location = POINT($1, $2), updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [longitude, latitude, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    res.json({
      message: 'Driver location updated successfully',
      driver: result.rows[0]
    });
  } catch (error) {
    console.error('Update driver location error:', error);
    res.status(500).json({ error: 'Failed to update driver location' });
  }
});

// Assign parcel to driver (admin only)
router.post('/:driverId/assign', [
  body('parcelId').isUUID()
], authorize('admin'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { driverId } = req.params;
    const { parcelId } = req.body;

    // Check if driver exists
    const driverResult = await pool.query(
      'SELECT id, status FROM drivers WHERE id = $1',
      [driverId]
    );

    if (driverResult.rows.length === 0) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    // Allow assigning multiple parcels to the same driver, but only once a parcel is paid and still unassigned.

    // Check if parcel exists and is not already assigned
    const parcelResult = await pool.query(
      'SELECT id, status FROM parcels WHERE id = $1',
      [parcelId]
    );

    if (parcelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Parcel not found' });
    }

    if (parcelResult.rows[0].status !== 'paid') {
      return res.status(400).json({ error: 'Parcel is not available for assignment (must be paid first)' });
    }

    const hasCompletedPayment = await hasCompletedPaymentForParcel(parcelId);
    if (!hasCompletedPayment) {
      return res.status(400).json({ error: 'Parcel is awaiting payment confirmation' });
    }

    const assignmentCheck = await pool.query(
      'SELECT id FROM assignments WHERE parcel_id = $1',
      [parcelId]
    );

    if (assignmentCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Parcel is already assigned' });
    }

    // Create assignment
    const assignmentResult = await pool.query(
      `INSERT INTO assignments (parcel_id, driver_id, assigned_by, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [parcelId, driverId, req.user.id]
    );

    // Update driver status to busy
    await pool.query(
      'UPDATE drivers SET status = $1 WHERE id = $2',
      ['busy', driverId]
    );

    // Update parcel status
    await pool.query(
      `UPDATE parcels SET status = 'picked_up' WHERE id = $1`,
      [parcelId]
    );

    // Add to status history
    await pool.query(
      `INSERT INTO parcel_status_history (parcel_id, status, updated_by, notes)
       VALUES ($1, $2, $3, $4)`,
      [parcelId, 'picked_up', req.user.id, 'Parcel assigned to driver']
    );

    notifyDriverAssignment(driverId, parcelId).catch((err) =>
      console.error('Notify driver assignment failed:', err)
    );

    res.status(201).json({
      message: 'Parcel assigned successfully',
      assignment: assignmentResult.rows[0]
    });
  } catch (error) {
    console.error('Assign parcel error:', error);
    res.status(500).json({ error: 'Failed to assign parcel' });
  }
});

// Update driver profile (driver only)
router.put('/me/profile', [
  body('licenseNumber').optional().trim(),
  body('vehicleType').optional().trim(),
  body('vehiclePlate').optional().trim(),
  body('state').optional().trim()
], authorize('driver'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { licenseNumber, vehicleType, vehiclePlate, state } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (licenseNumber !== undefined) {
      updates.push(`license_number = $${paramCount++}`);
      values.push(licenseNumber);
    }
    if (vehicleType !== undefined) {
      updates.push(`vehicle_type = $${paramCount++}`);
      values.push(vehicleType);
    }
    if (vehiclePlate !== undefined) {
      updates.push(`vehicle_plate = $${paramCount++}`);
      values.push(vehiclePlate);
    }
    if (state !== undefined) {
      updates.push(`state = $${paramCount++}`);
      values.push(normalizeState(state));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.user.id);

    const queryStr = `UPDATE drivers 
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING *`;
    console.log('EXECUTING QUERY:', queryStr);
    console.log('WITH VALUES:', values);

    const result = await pool.query(queryStr, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    res.json({
      message: 'Driver profile updated successfully',
      driver: result.rows[0]
    });
  } catch (error) {
    console.error('Update driver profile error:', error);
    res.status(500).json({ error: 'Failed to update driver profile: ' + error.message });
  }
});

// Save / update bank details (driver only)
router.put('/me/bank', [
  body('bankName').trim().notEmpty().withMessage('Bank name is required'),
  body('accountNumber')
    .trim()
    .notEmpty().withMessage('Account number is required')
    .isLength({ min: 10, max: 10 }).withMessage('Account number must be exactly 10 digits')
    .isNumeric().withMessage('Account number must contain only digits'),
  body('accountName').trim().notEmpty().withMessage('Account name is required'),
], authorize('driver'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { bankName, accountNumber, accountName } = req.body;

    const result = await pool.query(
      `UPDATE drivers
       SET bank_name = $1, account_number = $2, account_name = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, bank_name, account_number, account_name`,
      [bankName, accountNumber, accountName, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    const row = result.rows[0];
    res.json({
      message: 'Bank details saved successfully',
      bankDetails: {
        bankName: row.bank_name,
        accountNumber: row.account_number,
        accountName: row.account_name,
      },
    });
  } catch (error) {
    console.error('Save bank details error:', error);
    res.status(500).json({ error: 'Failed to save bank details' });
  }
});

// Request a withdrawal (driver only)
// Min: ₦1,000 | Max: ₦2,000,000 per request
router.post('/me/withdraw', [
  body('amount')
    .isFloat({ min: 1000, max: 2000000 })
    .withMessage('Withdrawal amount must be between ₦1,000 and ₦2,000,000'),
], authorize('driver'), async (req, res) => {
  const client = await pool.connect();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const amount = parseFloat(req.body.amount);

    await client.query('BEGIN');

    // Fetch driver profile and bank details
    const driverResult = await client.query(
      `SELECT d.id, d.wallet_balance, d.bank_name, d.account_number, d.account_name, d.full_name
       FROM drivers d
       WHERE d.id = $1
       FOR UPDATE`,
      [req.user.id]
    );

    if (driverResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    const driver = driverResult.rows[0];

    // Ensure bank details are set
    if (!driver.bank_name || !driver.account_number || !driver.account_name) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Please add your bank details before requesting a withdrawal' });
    }

    // Check sufficient balance
    const currentBalance = parseFloat(driver.wallet_balance || 0);
    if (amount > currentBalance) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Insufficient balance. Your current balance is ₦${currentBalance.toFixed(2)}`,
      });
    }

    // Deduct from wallet
    await client.query(
      'UPDATE drivers SET wallet_balance = wallet_balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [amount, driver.id]
    );

    // Create withdrawal record
    const withdrawalResult = await client.query(
      `INSERT INTO withdrawals (driver_id, amount, status, bank_name, account_number, account_name)
       VALUES ($1, $2, 'pending', $3, $4, $5)
       RETURNING *`,
      [driver.id, amount, driver.bank_name, driver.account_number, driver.account_name]
    );

    // Notify all admins
    const adminResult = await client.query(
      `SELECT id FROM users WHERE role = 'admin'`
    );

    const withdrawal = withdrawalResult.rows[0];
    const notifyTitle = '💸 Withdrawal Request';
    const notifyMsg = `Driver ${driver.full_name} requested a withdrawal of ₦${amount.toLocaleString('en-NG')}. Bank: ${driver.bank_name}, Acct: ${driver.account_number}.`;

    for (const admin of adminResult.rows) {
      await client.query(
        `INSERT INTO notifications (user_id, parcel_id, type, title, message)
         VALUES ($1, NULL, 'withdrawal_request', $2, $3)`,
        [admin.id, notifyTitle, notifyMsg]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Withdrawal request submitted successfully. Admin will process your payment.',
      withdrawal: {
        id: withdrawal.id,
        amount: parseFloat(withdrawal.amount),
        status: withdrawal.status,
        bankName: withdrawal.bank_name,
        accountNumber: withdrawal.account_number,
        accountName: withdrawal.account_name,
        createdAt: withdrawal.created_at,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Withdrawal request error:', error);
    res.status(500).json({ error: 'Failed to process withdrawal request' });
  } finally {
    client.release();
  }
});

// Get driver's own withdrawal history
router.get('/me/withdrawals', authorize('driver'), async (req, res) => {
  try {
    const driverResult = await pool.query(
      'SELECT id FROM drivers WHERE id = $1',
      [req.user.id]
    );
    if (driverResult.rows.length === 0) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }
    const driverId = driverResult.rows[0].id;

    const result = await pool.query(
      `SELECT * FROM withdrawals WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [driverId]
    );

    res.json({
      withdrawals: result.rows.map((w) => ({
        id: w.id,
        amount: parseFloat(w.amount),
        status: w.status,
        bankName: w.bank_name,
        accountNumber: w.account_number,
        accountName: w.account_name,
        notes: w.notes,
        createdAt: w.created_at,
        updatedAt: w.updated_at,
      })),
    });
  } catch (error) {
    console.error('Get withdrawals error:', error);
    res.status(500).json({ error: 'Failed to get withdrawal history' });
  }
});

// ── Admin: list all withdrawals ────────────────────────────────────────────────
router.get('/admin/withdrawals', authorize('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT w.*, u.full_name as driver_name, u.email as driver_email, u.phone as driver_phone
      FROM withdrawals w
      INNER JOIN drivers d ON w.driver_id = d.id
      INNER JOIN users u ON d.user_id = u.id
    `;
    const params = [];
    if (status) {
      query += ' WHERE w.status = $1';
      params.push(status);
    }
    query += ' ORDER BY w.created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      withdrawals: result.rows.map((w) => ({
        id: w.id,
        driverId: w.driver_id,
        driverName: w.driver_name,
        driverEmail: w.driver_email,
        driverPhone: w.driver_phone,
        amount: parseFloat(w.amount),
        status: w.status,
        bankName: w.bank_name,
        accountNumber: w.account_number,
        accountName: w.account_name,
        notes: w.notes,
        createdAt: w.created_at,
        updatedAt: w.updated_at,
      })),
    });
  } catch (error) {
    console.error('Admin get withdrawals error:', error);
    res.status(500).json({ error: 'Failed to get withdrawals' });
  }
});

// Admin: update withdrawal status
router.put('/admin/withdrawals/:id/status', [
  body('status').isIn(['pending', 'processing', 'completed', 'failed']).withMessage('Invalid status'),
  body('notes').optional().trim(),
], authorize('admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { status, notes } = req.body;

    await client.query('BEGIN');

    const withdrawalResult = await client.query(
      `SELECT w.*, d.user_id as driver_user_id, u.full_name as driver_name
       FROM withdrawals w
       INNER JOIN drivers d ON w.driver_id = d.id
       INNER JOIN users u ON d.user_id = u.id
       WHERE w.id = $1 FOR UPDATE`,
      [id]
    );

    if (withdrawalResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    const withdrawal = withdrawalResult.rows[0];

    // If marking as failed, refund the wallet
    if (status === 'failed' && withdrawal.status !== 'failed') {
      await client.query(
        'UPDATE drivers SET wallet_balance = wallet_balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [withdrawal.amount, withdrawal.driver_id]
      );
    }

    const updated = await client.query(
      `UPDATE withdrawals
       SET status = $1, notes = COALESCE($2, notes), updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [status, notes || null, id]
    );

    // Notify the driver
    const statusMsg = status === 'completed'
      ? `Your withdrawal of ₦${parseFloat(withdrawal.amount).toLocaleString('en-NG')} has been processed and sent to your bank.`
      : status === 'failed'
      ? `Your withdrawal of ₦${parseFloat(withdrawal.amount).toLocaleString('en-NG')} could not be processed. The amount has been refunded to your wallet.`
      : `Your withdrawal of ₦${parseFloat(withdrawal.amount).toLocaleString('en-NG')} is now ${status}.`;

    await client.query(
      `INSERT INTO notifications (user_id, parcel_id, type, title, message)
       VALUES ($1, NULL, 'withdrawal_update', $2, $3)`,
      [withdrawal.driver_user_id, '💰 Withdrawal Update', statusMsg]
    );

    // Admin audit log
    await client.query(
      `INSERT INTO audit_logs (admin_id, action, target_type, target_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, 'UPDATE_WITHDRAWAL_STATUS', 'withdrawal', id,
       JSON.stringify({ from: withdrawal.status, to: status, notes }), req.ip]
    );

    await client.query('COMMIT');

    res.json({
      message: `Withdrawal ${status} successfully`,
      withdrawal: updated.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update withdrawal status error:', error);
    res.status(500).json({ error: 'Failed to update withdrawal status' });
  } finally {
    client.release();
  }
});

module.exports = router;


