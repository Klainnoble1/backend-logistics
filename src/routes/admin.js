const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes require admin authentication
router.use(authenticate);
router.use(authorize('admin'));

// Helper for audit logging
const logAudit = async (adminId, action, targetType, targetId, details, ip) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs (admin_id, action, target_type, target_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [adminId, action, targetType, targetId, JSON.stringify(details), ip]
    );
  } catch (e) {
    console.error('Audit log error:', e);
  }
};

// Diagnostics - pricing check
router.get('/diag-pricing', async (req, res) => {
  if (req.user.email !== 'admin@oprime.com') return res.status(403).json({ error: 'Denied' });
  try {
    const { calculatePrice } = require('../services/pricingService');
    const result = await calculatePrice('Lagos', 'Ibadan', 1, 'standard', false);
    res.json({ status: 'ok', testResult: result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message, stack: err.stack });
  }
});

// Track admin activity middleware
router.use(async (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    try {
      // Update last_seen
      await pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [req.user.id]);
      
      // Update or Create active session in admin_activity
      const recentSession = await pool.query(
        `SELECT id, login_at FROM admin_activity 
         WHERE admin_id = $1 AND last_active_at > CURRENT_TIMESTAMP - INTERVAL '30 minutes'
         ORDER BY last_active_at DESC LIMIT 1`,
        [req.user.id]
      );

      if (recentSession.rows.length > 0) {
        const sessionId = recentSession.rows[0].id;
        const loginAt = recentSession.rows[0].login_at;
        const now = new Date();
        const duration = Math.floor((now.getTime() - new Date(loginAt).getTime()) / 1000);
        
        await pool.query(
          `UPDATE admin_activity SET 
             last_active_at = CURRENT_TIMESTAMP,
             duration_seconds = $1
           WHERE id = $2`,
          [duration, sessionId]
        );
      } else {
        await pool.query(
          `INSERT INTO admin_activity (admin_id, ip_address) VALUES ($1, $2)`,
          [req.user.id, req.ip]
        );
      }
    } catch (e) {
      console.error('Session tracking error:', e);
    }
  }
  next();
});

// Create admin (or other) user – admin only
router.post('/users', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('fullName').trim().notEmpty(),
  body('phone').optional().trim(),
  body('role').optional().isIn(['admin', 'customer', 'driver'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, fullName, phone, role = 'admin' } = req.body;

    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, phone, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, email, full_name, role, created_at`,
      [email, phone || null, passwordHash, fullName, role]
    );

    const user = result.rows[0];

    // Audit log
    await logAudit(req.user.id, 'CREATE_USER', 'user', user.id, { email, role, fullName }, req.ip);

    if (role === 'driver') {
      await pool.query(
        `INSERT INTO drivers (email, phone, password_hash, full_name, status)
         VALUES ($1, $2, $3, $4, 'offline')`,
        [email, phone || null, passwordHash, fullName]
      );
    }

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Get users with optional role filtering (admin only)
router.get('/users', async (req, res) => {
  try {
    const { role } = req.query;
    let query = 'SELECT id, email, full_name, role, is_active, last_seen, created_at FROM users';
    const params = [];

    if (role) {
      query += ' WHERE role = $1';
      params.push(role);
    }

    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);

    res.json({ users: result.rows });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Get Audit Logs (Super Admin only)
router.get('/audit-logs', async (req, res) => {
  try {
    if (req.user.email !== 'admin@oprime.com') {
      return res.status(403).json({ error: 'Access denied. Super Admin only.' });
    }

    const { limit = 50, page = 1 } = req.query;
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT al.*, u.full_name as admin_name, u.email as admin_email
       FROM audit_logs al
       INNER JOIN users u ON al.admin_id = u.id
       ORDER BY al.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const totalRes = await pool.query('SELECT COUNT(*) as count FROM audit_logs');

    res.json({
      logs: result.rows,
      total: parseInt(totalRes.rows[0].count)
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ error: 'Failed to get audit logs' });
  }
});

// Get Admin Activity (Super Admin only)
router.get('/activity', async (req, res) => {
  try {
    if (req.user.email !== 'admin@oprime.com') {
      return res.status(403).json({ error: 'Access denied. Super Admin only.' });
    }

    const result = await pool.query(
      `SELECT aa.*, u.full_name as admin_name, u.email as admin_email, u.last_seen
       FROM admin_activity aa
       INNER JOIN users u ON aa.admin_id = u.id
       ORDER BY aa.last_active_at DESC
       LIMIT 100`
    );

    res.json({ activity: result.rows });
  } catch (error) {
    console.error('Get admin activity error:', error);
    res.status(500).json({ error: 'Failed to get admin activity' });
  }
});

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
       AND EXISTS (
         SELECT 1
         FROM payments pay
         WHERE pay.parcel_id = p.id
           AND pay.payment_status = 'completed'
       )
       AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.parcel_id = p.id)`
    );

    // Parcels still awaiting a successful payment are tracked operationally as pending payments.
    const pendingPayments = await pool.query(
      `SELECT COUNT(*) as count
       FROM parcels p
       WHERE EXISTS (
         SELECT 1
         FROM payments pay
         WHERE pay.parcel_id = p.id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM payments pay
         WHERE pay.parcel_id = p.id
           AND pay.payment_status = 'completed'
       )`
    );

    const completedPayments = await pool.query(
      `SELECT COUNT(DISTINCT parcel_id) as count
       FROM payments
       WHERE payment_status = 'completed'`
    );

    // Recent parcels
    const recentParcels = await pool.query(
      `SELECT p.*, u.full_name as sender_name
       FROM parcels p
       INNER JOIN users u ON p.sender_id = u.id
       ORDER BY p.created_at DESC
       LIMIT 10`
    );

    // Recent payments
    const recentPayments = await pool.query(
      `SELECT pay.id, pay.amount, pay.payment_status, pay.payment_method, pay.transaction_id, pay.created_at,
              pr.tracking_id, pr.recipient_name, u.full_name as customer_name
       FROM payments pay
       INNER JOIN parcels pr ON pay.parcel_id = pr.id
       INNER JOIN users u ON pay.user_id = u.id
       ORDER BY pay.created_at DESC
       LIMIT 8`
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
        unassignedCount: parseInt(unassignedCount.rows[0].count),
        completedPayments: parseInt(completedPayments.rows[0].count, 10),
        pendingPayments: parseInt(pendingPayments.rows[0].count, 10),
      },
      recentParcels: recentParcels.rows,
      recentPayments: recentPayments.rows,
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
             dr.full_name as assigned_driver_name
      FROM parcels p
      INNER JOIN users u ON p.sender_id = u.id
      LEFT JOIN assignments a ON a.parcel_id = p.id
      LEFT JOIN drivers dr ON dr.id = a.driver_id
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
  body('intraStatePickupFee').optional().isFloat({ min: 0 }),
  body('intraStateDeliveryFee').optional().isFloat({ min: 0 }),
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
      intraStatePickupFee,
      intraStateDeliveryFee,
      isActive
    } = req.body;

    // If setting as active, deactivate all other rules
    if (isActive) {
      await pool.query('UPDATE pricing_rules SET is_active = false');
    }

    const result = await pool.query(
      `INSERT INTO pricing_rules (
        rule_name, base_price, price_per_km, price_per_kg, weight_included_kg,
        express_surcharge, insurance_fee, min_price, max_price, 
        intra_state_pickup_fee, intra_state_delivery_fee, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        ruleName, basePrice, pricePerKm, pricePerKg, weightIncludedKg, 
        expressSurcharge, insuranceFee, minPrice, maxPrice,
        intraStatePickupFee || 500, intraStateDeliveryFee || 500, isActive
      ]
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
  body('intraStatePickupFee').optional().isFloat({ min: 0 }),
  body('intraStateDeliveryFee').optional().isFloat({ min: 0 }),
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

// Delete pricing rule
router.delete('/pricing-rules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM pricing_rules WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pricing rule not found' });
    }
    res.json({ message: 'Pricing rule deleted successfully' });
  } catch (error) {
    console.error('Delete pricing rule error:', error);
    res.status(500).json({ error: 'Failed to delete pricing rule' });
  }
});

// --- Interstate Pricing ---

// Get all interstate rates
router.get('/interstate-pricing', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM state_pricing ORDER BY origin_state, destination_state'
    );
    res.json({ rates: result.rows });
  } catch (error) {
    console.error('Get interstate rates error:', error);
    res.status(500).json({ error: 'Failed to get interstate rates' });
  }
});

// Create/Update interstate rate
router.post('/interstate-pricing', [
  body('originState').trim().notEmpty(),
  body('destinationState').trim().notEmpty(),
  body('price').isFloat({ min: 0 }),
  body('isActive').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { originState, destinationState, price, isActive = true } = req.body;

    const result = await pool.query(
      `INSERT INTO state_pricing (origin_state, destination_state, price, is_active)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (origin_state, destination_state) 
       DO UPDATE SET price = EXCLUDED.price, is_active = EXCLUDED.is_active, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [originState, destinationState, price, isActive]
    );

    res.status(201).json({ message: 'Interstate rate saved', rate: result.rows[0] });
  } catch (error) {
    console.error('Save interstate rate error:', error);
    res.status(500).json({ error: 'Failed to save interstate rate' });
  }
});

// Update interstate rate
router.put('/interstate-pricing/:id', [
  body('price').optional().isFloat({ min: 0 }),
  body('isActive').optional().isBoolean()
], async (req, res) => {
  try {
    const { id } = req.params;
    const { price, isActive } = req.body;

    const updateFields = [];
    const values = [];
    let paramCount = 1;

    if (price !== undefined) {
      updateFields.push(`price = $${paramCount++}`);
      values.push(price);
    }
    if (isActive !== undefined) {
      updateFields.push(`is_active = $${paramCount++}`);
      values.push(isActive);
    }

    if (updateFields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(id);
    const result = await pool.query(
      `UPDATE state_pricing SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $${paramCount} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Rate path not found' });
    res.json({ message: 'Interstate rate updated', rate: result.rows[0] });
  } catch (error) {
    console.error('Update interstate rate error:', error);
    res.status(500).json({ error: 'Failed to update interstate rate' });
  }
});

// Delete interstate rate
router.delete('/interstate-pricing/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM state_pricing WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rate path not found' });
    res.json({ message: 'Interstate rate deleted' });
  } catch (error) {
    console.error('Delete interstate rate error:', error);
    res.status(500).json({ error: 'Failed to delete interstate rate' });
  }
});

// Get drivers pending verification or with documents
router.get('/drivers/verification', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, phone, verification_status, profile_picture_url, 
              license_image_url, motorcycle_reg_url, rejection_reason, created_at, is_banned
       FROM drivers
       WHERE verification_status != 'unverified' OR is_banned = true
       ORDER BY 
         CASE 
           WHEN is_banned = true THEN 3
           WHEN verification_status = 'pending' THEN 0 
           WHEN verification_status = 'rejected' THEN 2
           WHEN verification_status = 'verified' THEN 1
           ELSE 4 
         END,
         created_at DESC`
    );
    res.json({ drivers: result.rows });
  } catch (error) {
    console.error('Get driver verifications error:', error);
    res.status(500).json({ error: 'Failed to get driver verifications' });
  }
});

// Process driver verification actions
router.post('/drivers/:id/verification-action', [
  body('action').isIn(['approve', 'reject', 'ban', 'unban']),
  body('reason').optional().trim()
], async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body;

    let query = '';
    let params = [id];

    if (action === 'approve') {
      query = `UPDATE drivers SET verification_status = 'verified', rejection_reason = NULL, is_banned = false WHERE id = $1 RETURNING *`;
    } else if (action === 'reject') {
      query = `UPDATE drivers SET verification_status = 'rejected', rejection_reason = $2, is_banned = false WHERE id = $1 RETURNING *`;
      params.push(reason || 'Documents were not clear or invalid.');
    } else if (action === 'ban') {
      query = `UPDATE drivers SET is_banned = true, status = 'offline' WHERE id = $1 RETURNING *`;
    } else if (action === 'unban') {
      query = `UPDATE drivers SET is_banned = false WHERE id = $1 RETURNING *`;
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    // Audit log
    await logAudit(req.user.id, `DRIVER_${action.toUpperCase()}`, 'driver', id, { action, reason }, req.ip);

    res.json({
      message: `Driver action ${action} completed successfully`,
      driver: result.rows[0]
    });
  } catch (error) {
    console.error('Driver verification action error:', error);
    res.status(500).json({ error: 'Failed to process driver action' });
  }
});

module.exports = router;
