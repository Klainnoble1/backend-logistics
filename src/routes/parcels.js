const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const generateTrackingId = require('../utils/generateTrackingId');
const { calculatePrice, estimateDeliveryDate } = require('../services/pricingService');

const router = express.Router();

// Public tracking endpoint (no auth required) - must be before authenticate
router.get('/track/:trackingId', async (req, res) => {
  try {
    const { trackingId } = req.params;

    const result = await pool.query(
      'SELECT * FROM parcels WHERE tracking_id = $1',
      [trackingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Parcel not found' });
    }

    const parcel = result.rows[0];

    const historyResult = await pool.query(
      `SELECT psh.*, u.full_name as updated_by_name
       FROM parcel_status_history psh
       LEFT JOIN users u ON psh.updated_by = u.id
       WHERE psh.parcel_id = $1
       ORDER BY psh.created_at DESC`,
      [parcel.id]
    );

    res.json({
      parcel: {
        trackingId: parcel.tracking_id,
        status: parcel.status,
        currentLocation: parcel.current_location,
        estimatedDeliveryDate: parcel.estimated_delivery_date,
        recipientName: parcel.recipient_name
      },
      statusHistory: historyResult.rows
    });
  } catch (error) {
    console.error('Track parcel error:', error);
    res.status(500).json({ error: 'Failed to track parcel' });
  }
});

// All other routes require authentication
router.use(authenticate);

// Create new parcel
router.post('/', [
  body('recipientName').trim().notEmpty(),
  body('recipientPhone').trim().notEmpty(),
  body('pickupAddress').trim().notEmpty(),
  body('deliveryAddress').trim().notEmpty(),
  body('weight').isFloat({ min: 0.1 }),
  body('serviceType').isIn(['standard', 'express']),
  body('parcelType').optional().trim(),
  body('description').optional().trim(),
  body('insurance').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      recipientName,
      recipientPhone,
      pickupAddress,
      deliveryAddress,
      parcelType,
      weight,
      dimensions,
      serviceType,
      description,
      insurance = false
    } = req.body;

    // Calculate price
    const pricing = await calculatePrice(pickupAddress, deliveryAddress, weight, serviceType, insurance);
    const estimatedDelivery = estimateDeliveryDate(serviceType, pricing.distance);

    // Generate unique tracking ID
    let trackingId;
    let isUnique = false;
    while (!isUnique) {
      trackingId = generateTrackingId();
      const check = await pool.query('SELECT id FROM parcels WHERE tracking_id = $1', [trackingId]);
      if (check.rows.length === 0) {
        isUnique = true;
      }
    }

    // Create parcel (store road distance for display)
    const result = await pool.query(
      `INSERT INTO parcels (
        tracking_id, sender_id, recipient_name, recipient_phone,
        pickup_address, delivery_address, parcel_type, weight,
        dimensions, service_type, status, price, insurance,
        description, estimated_delivery_date, distance_km
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        trackingId, req.user.id, recipientName, recipientPhone,
        pickupAddress, deliveryAddress, parcelType, weight,
        JSON.stringify(dimensions || {}), serviceType, 'created',
        pricing.price, insurance, description, estimatedDelivery,
        pricing.distance
      ]
    );

    const parcel = result.rows[0];

    // Create initial status history
    await pool.query(
      `INSERT INTO parcel_status_history (parcel_id, status, location, updated_by, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [parcel.id, 'created', pickupAddress, req.user.id, 'Parcel created']
    );

    res.status(201).json({
      message: 'Parcel created successfully',
      parcel: {
        ...parcel,
        pricing: pricing.breakdown,
        estimatedDeliveryDate: estimatedDelivery
      }
    });
  } catch (error) {
    console.error('Create parcel error:', error);
    res.status(500).json({ error: 'Failed to create parcel' });
  }
});

// Get user's parcels
router.get('/', async (req, res) => {
  try {
    let query;
    let params;

    if (req.user.role === 'customer') {
      // Customers see only their parcels
      query = `
        SELECT p.*, 
               (SELECT status FROM parcel_status_history 
                WHERE parcel_id = p.id 
                ORDER BY created_at DESC LIMIT 1) as latest_status
        FROM parcels p
        WHERE p.sender_id = $1
        ORDER BY p.created_at DESC
      `;
      params = [req.user.id];
    } else if (req.user.role === 'driver') {
      // Drivers see assigned parcels
      query = `
        SELECT p.*, a.status as assignment_status,
               (SELECT status FROM parcel_status_history 
                WHERE parcel_id = p.id 
                ORDER BY created_at DESC LIMIT 1) as latest_status
        FROM parcels p
        INNER JOIN assignments a ON p.id = a.parcel_id
        INNER JOIN drivers d ON a.driver_id = d.id
        WHERE d.user_id = $1
        ORDER BY p.created_at DESC
      `;
      params = [req.user.id];
    } else {
      // Admin sees all parcels
      query = `
        SELECT p.*, 
               (SELECT status FROM parcel_status_history 
                WHERE parcel_id = p.id 
                ORDER BY created_at DESC LIMIT 1) as latest_status
        FROM parcels p
        ORDER BY p.created_at DESC
      `;
      params = [];
    }

    const result = await pool.query(query, params);
    res.json({ parcels: result.rows });
  } catch (error) {
    console.error('Get parcels error:', error);
    res.status(500).json({ error: 'Failed to get parcels' });
  }
});

// Get parcel by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user has access to this parcel
    let query;
    let params;

    if (req.user.role === 'customer') {
      query = 'SELECT * FROM parcels WHERE id = $1 AND sender_id = $2';
      params = [id, req.user.id];
    } else if (req.user.role === 'driver') {
      query = `
        SELECT p.* FROM parcels p
        INNER JOIN assignments a ON p.id = a.parcel_id
        INNER JOIN drivers d ON a.driver_id = d.id
        WHERE p.id = $1 AND d.user_id = $2
      `;
      params = [id, req.user.id];
    } else {
      query = 'SELECT * FROM parcels WHERE id = $1';
      params = [id];
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Parcel not found' });
    }

    // Get status history
    const historyResult = await pool.query(
      `SELECT psh.*, u.full_name as updated_by_name
       FROM parcel_status_history psh
       LEFT JOIN users u ON psh.updated_by = u.id
       WHERE psh.parcel_id = $1
       ORDER BY psh.created_at DESC`,
      [id]
    );

    res.json({
      parcel: result.rows[0],
      statusHistory: historyResult.rows
    });
  } catch (error) {
    console.error('Get parcel error:', error);
    res.status(500).json({ error: 'Failed to get parcel' });
  }
});

// Update parcel status (driver/admin only)
router.put('/:id/status', [
  body('status').isIn(['created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned']),
  body('location').optional().trim(),
  body('notes').optional().trim()
], authorize('driver', 'admin'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { status, location, notes } = req.body;

    // Check if parcel exists and user has access
    let parcelQuery;
    let parcelParams;

    if (req.user.role === 'driver') {
      parcelQuery = `
        SELECT p.* FROM parcels p
        INNER JOIN assignments a ON p.id = a.parcel_id
        INNER JOIN drivers d ON a.driver_id = d.id
        WHERE p.id = $1 AND d.user_id = $2
      `;
      parcelParams = [id, req.user.id];
    } else {
      parcelQuery = 'SELECT * FROM parcels WHERE id = $1';
      parcelParams = [id];
    }

    const parcelResult = await pool.query(parcelQuery, parcelParams);

    if (parcelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Parcel not found or access denied' });
    }

    const parcel = parcelResult.rows[0];

    // Update parcel status
    const updateData = {
      status,
      current_location: location || parcel.current_location,
      updated_at: new Date()
    };

    if (status === 'delivered') {
      updateData.actual_delivery_date = new Date().toISOString().split('T')[0];
    }

    await pool.query(
      `UPDATE parcels 
       SET status = $1, current_location = $2, actual_delivery_date = $3, updated_at = $4
       WHERE id = $5`,
      [updateData.status, updateData.current_location, updateData.actual_delivery_date, updateData.updated_at, id]
    );

    // Add to status history
    await pool.query(
      `INSERT INTO parcel_status_history (parcel_id, status, location, updated_by, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, status, location || parcel.current_location, req.user.id, notes || '']
    );

    res.json({
      message: 'Parcel status updated successfully',
      parcel: { ...parcel, ...updateData }
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'Failed to update parcel status' });
  }
});

module.exports = router;


