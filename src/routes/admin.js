const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes require admin authentication
router.use(authenticate);
router.use(authorize('admin'));

// Get dashboard statistics
router.get('/dashboard', async (req, res) => {
  try {
    // Total parcels
    const totalParcels = await pool.query('SELECT COUNT(*) as count FROM parcels');
    
    // Parcels by status
    const parcelsByStatus = await pool.query(
      `SELECT status, COUNT(*) as count 
       FROM parcels 
       GROUP BY status`
    );

    // Total revenue
    const revenue = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total 
       FROM payments 
       WHERE payment_status = 'completed'`
    );

    // Total drivers
    const totalDrivers = await pool.query('SELECT COUNT(*) as count FROM drivers');

    // Available drivers
    const availableDrivers = await pool.query(
      `SELECT COUNT(*) as count 
       FROM drivers 
       WHERE status = 'available'`
    );

    // Unassigned parcels (created, no assignment yet)
    const unassignedCount = await pool.query(
      `SELECT COUNT(*) as count FROM parcels p
       WHERE p.status = 'created'
       AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.parcel_id = p.id)`
    );

    // Recent parcels
    const recentParcels = await pool.query(
      `SELECT p.*, u.full_name as sender_name
       FROM parcels p
       INNER JOIN users u ON p.sender_id = u.id
       ORDER BY p.created_at DESC
       LIMIT 10`
    );

    res.json({
      statistics: {
        totalParcels: parseInt(totalParcels.rows[0].count),
        parcelsByStatus: parcelsByStatus.rows.reduce((acc, row) => {
          acc[row.status] = parseInt(row.count);
          return acc;
        }, {}),
        totalRevenue: parseFloat(revenue.rows[0].total),
        totalDrivers: parseInt(totalDrivers.rows[0].count),
        availableDrivers: parseInt(availableDrivers.rows[0].count),
        unassignedCount: parseInt(unassignedCount.rows[0].count)
      },
      recentParcels: recentParcels.rows
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to get dashboard data' });
  }
});

// Get all parcels with filters
router.get('/parcels', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT p.*, u.full_name as sender_name, u.email as sender_email,
             a.id as assignment_id, a.driver_id as assigned_driver_id,
             du.full_name as assigned_driver_name
      FROM parcels p
      INNER JOIN users u ON p.sender_id = u.id
      LEFT JOIN assignments a ON a.parcel_id = p.id
      LEFT JOIN drivers dr ON dr.id = a.driver_id
      LEFT JOIN users du ON du.id = dr.user_id
    `;
    const params = [];
    let paramCount = 1;

    if (status) {
      query += ` WHERE p.status = $${paramCount++}`;
      params.push(status);
    }

    query += ` ORDER BY p.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM parcels';
    if (status) {
      countQuery += ' WHERE status = $1';
    }
    const countResult = await pool.query(countQuery, status ? [status] : []);

    res.json({
      parcels: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
      }
    });
  } catch (error) {
    console.error('Get parcels error:', error);
    res.status(500).json({ error: 'Failed to get parcels' });
  }
});

// Get analytics/reports
router.get('/analytics', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let dateFilter = '';
    const params = [];
    if (startDate && endDate) {
      dateFilter = 'WHERE p.created_at BETWEEN $1 AND $2';
      params.push(startDate, endDate);
    }

    // Revenue by date
    const revenueByDate = await pool.query(
      `SELECT DATE(p.created_at) as date, COALESCE(SUM(pay.amount), 0) as revenue
       FROM parcels p
       LEFT JOIN payments pay ON p.id = pay.parcel_id AND pay.payment_status = 'completed'
       ${dateFilter}
       GROUP BY DATE(p.created_at)
       ORDER BY date DESC
       LIMIT 30`,
      params
    );

    // Parcels by service type
    const parcelsByService = await pool.query(
      `SELECT service_type, COUNT(*) as count
       FROM parcels
       ${dateFilter}
       GROUP BY service_type`,
      params
    );

    // Average delivery time
    const avgDeliveryTimeFilter = startDate && endDate
      ? 'AND created_at BETWEEN $1 AND $2'
      : '';
    const avgDeliveryTime = await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (actual_delivery_date::timestamp - created_at::timestamp)) / 86400) as avg_days
       FROM parcels
       WHERE actual_delivery_date IS NOT NULL ${avgDeliveryTimeFilter}`,
      startDate && endDate ? [startDate, endDate] : []
    );

    res.json({
      revenueByDate: revenueByDate.rows,
      parcelsByService: parcelsByService.rows,
      averageDeliveryTime: parseFloat(avgDeliveryTime.rows[0]?.avg_days || 0)
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Create/Update pricing rule
router.post('/pricing-rules', [
  body('ruleName').trim().notEmpty(),
  body('basePrice').isFloat({ min: 0 }),
  body('pricePerKm').isFloat({ min: 0 }),
  body('pricePerKg').isFloat({ min: 0 }),
  body('weightIncludedKg').optional().isFloat({ min: 0 }),
  body('expressSurcharge').isFloat({ min: 0 }),
  body('insuranceFee').isFloat({ min: 0 }),
  body('minPrice').isFloat({ min: 0 }),
  body('maxPrice').optional().isFloat({ min: 0 }),
  body('isActive').isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      ruleName,
      basePrice,
      pricePerKm,
      pricePerKg,
      weightIncludedKg = 5,
      expressSurcharge,
      insuranceFee,
      minPrice,
      maxPrice,
      isActive
    } = req.body;

    // If setting as active, deactivate all other rules
    if (isActive) {
      await pool.query('UPDATE pricing_rules SET is_active = false');
    }

    const result = await pool.query(
      `INSERT INTO pricing_rules (
        rule_name, base_price, price_per_km, price_per_kg, weight_included_kg,
        express_surcharge, insurance_fee, min_price, max_price, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [ruleName, basePrice, pricePerKm, pricePerKg, weightIncludedKg, expressSurcharge, insuranceFee, minPrice, maxPrice, isActive]
    );

    res.status(201).json({
      message: 'Pricing rule created successfully',
      rule: result.rows[0]
    });
  } catch (error) {
    console.error('Create pricing rule error:', error);
    res.status(500).json({ error: 'Failed to create pricing rule' });
  }
});

// Get all pricing rules
router.get('/pricing-rules', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM pricing_rules ORDER BY created_at DESC'
    );

    res.json({ rules: result.rows });
  } catch (error) {
    console.error('Get pricing rules error:', error);
    res.status(500).json({ error: 'Failed to get pricing rules' });
  }
});

// Update pricing rule
router.put('/pricing-rules/:id', [
  body('ruleName').optional().trim().notEmpty(),
  body('basePrice').optional().isFloat({ min: 0 }),
  body('pricePerKm').optional().isFloat({ min: 0 }),
  body('pricePerKg').optional().isFloat({ min: 0 }),
  body('weightIncludedKg').optional().isFloat({ min: 0 }),
  body('expressSurcharge').optional().isFloat({ min: 0 }),
  body('insuranceFee').optional().isFloat({ min: 0 }),
  body('minPrice').optional().isFloat({ min: 0 }),
  body('maxPrice').optional().isFloat({ min: 0 }),
  body('isActive').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const updates = req.body;

    // If setting as active, deactivate all other rules
    if (updates.isActive === true) {
      await pool.query('UPDATE pricing_rules SET is_active = false WHERE id != $1', [id]);
    }

    const updateFields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        updateFields.push(`${dbKey} = $${paramCount++}`);
        values.push(updates[key]);
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE pricing_rules 
       SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pricing rule not found' });
    }

    res.json({
      message: 'Pricing rule updated successfully',
      rule: result.rows[0]
    });
  } catch (error) {
    console.error('Update pricing rule error:', error);
    res.status(500).json({ error: 'Failed to update pricing rule' });
  }
});

module.exports = router;


