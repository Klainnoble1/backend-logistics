const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get all drivers (admin only)
router.get('/', authorize('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*, u.email, u.full_name, u.phone, u.created_at as user_created_at
       FROM drivers d
       INNER JOIN users u ON d.user_id = u.id
       ORDER BY u.created_at DESC`
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
      `SELECT d.*, u.email, u.full_name, u.phone
       FROM drivers d
       INNER JOIN users u ON d.user_id = u.id
       WHERE d.status = 'available'
       ORDER BY u.full_name`
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
      `SELECT d.id, d.status, d.license_number, d.vehicle_type, d.vehicle_plate, u.full_name, u.email, u.phone
       FROM drivers d
       INNER JOIN users u ON d.user_id = u.id
       WHERE d.user_id = $1`,
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
        licenseNumber: row.license_number,
        vehicleType: row.vehicle_type,
        vehiclePlate: row.vehicle_plate,
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
    // Get driver ID
    const driverResult = await pool.query(
      'SELECT id FROM drivers WHERE user_id = $1',
      [req.user.id]
    );

    if (driverResult.rows.length === 0) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    const driverId = driverResult.rows[0].id;

    // Get assignments with parcel details
    const result = await pool.query(
      `SELECT a.*, p.*, u.full_name as sender_name, u.email as sender_email
       FROM assignments a
       INNER JOIN parcels p ON a.parcel_id = p.id
       INNER JOIN users u ON p.sender_id = u.id
       WHERE a.driver_id = $1
       ORDER BY a.assigned_at DESC`,
      [driverId]
    );

    res.json({ assignments: result.rows });
  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).json({ error: 'Failed to get assignments' });
  }
});

// Get available parcels (not yet assigned) – drivers can pick from these
router.get('/me/available-parcels', authorize('driver'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.tracking_id, p.recipient_name, p.recipient_phone,
              p.pickup_address, p.delivery_address, p.parcel_type, p.weight,
              p.service_type, p.status, p.price, p.estimated_delivery_date,
              p.created_at, u.full_name as sender_name
       FROM parcels p
       INNER JOIN users u ON p.sender_id = u.id
       WHERE p.status = 'created'
         AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.parcel_id = p.id)
       ORDER BY p.created_at DESC`
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
      'SELECT id, status FROM drivers WHERE user_id = $1',
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

    if (parcelResult.rows[0].status !== 'created') {
      return res.status(400).json({ error: 'Parcel is not available for delivery' });
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
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [parcelId, driverId, req.user.id]
    );

    await pool.query(
      'UPDATE drivers SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['busy', driverId]
    );

    await pool.query(
      `UPDATE parcels SET status = 'picked_up' WHERE id = $1`,
      [parcelId]
    );

    await pool.query(
      `INSERT INTO parcel_status_history (parcel_id, status, updated_by, notes)
       VALUES ($1, $2, $3, $4)`,
      [parcelId, 'picked_up', req.user.id, 'Driver claimed parcel']
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
       WHERE user_id = $2
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
       WHERE user_id = $3
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

    const driverStatus = driverResult.rows[0].status;
    if (driverStatus === 'busy') {
      return res.status(400).json({ error: 'Driver is busy with another delivery' });
    }
    if (driverStatus !== 'available' && driverStatus !== 'offline') {
      return res.status(400).json({ error: 'Driver is not available for assignment' });
    }

    // Check if parcel exists and is not already assigned
    const parcelResult = await pool.query(
      'SELECT id, status FROM parcels WHERE id = $1',
      [parcelId]
    );

    if (parcelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Parcel not found' });
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
  body('vehiclePlate').optional().trim()
], authorize('driver'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { licenseNumber, vehicleType, vehiclePlate } = req.body;

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

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.user.id);

    const result = await pool.query(
      `UPDATE drivers 
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $${paramCount}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    res.json({
      message: 'Driver profile updated successfully',
      driver: result.rows[0]
    });
  } catch (error) {
    console.error('Update driver profile error:', error);
    res.status(500).json({ error: 'Failed to update driver profile' });
  }
});

module.exports = router;


