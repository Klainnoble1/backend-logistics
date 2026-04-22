const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /api/auth/me
 * @desc    Get current authenticated user details from local database
 * @access  Private
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const table = req.user.accountType === 'driver' ? 'drivers' : 'users';
    const result = await pool.query(
      `SELECT id, email, phone, full_name, ${table === 'users' ? 'role,' : ''} created_at FROM ${table} WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found in local database' });
    }

    const dbUser = result.rows[0];
    res.json({
      user: {
        id: dbUser.id,
        email: dbUser.email,
        fullName: dbUser.full_name,
        phone: dbUser.phone,
        role: req.user.accountType === 'driver' ? 'driver' : dbUser.role,
        createdAt: dbUser.created_at
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/**
 * @route   PUT /api/auth/profile
 * @desc    Update user profile (fullName, phone)
 * @access  Private
 */
router.put('/profile', [
  body('fullName').optional().trim().notEmpty(),
  body('phone').optional().trim(),
], authenticate, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { fullName, phone } = req.body;
    const table = req.user.accountType === 'driver' ? 'drivers' : 'users';
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (fullName !== undefined) {
      updates.push(`full_name = $${paramCount++}`);
      values.push(fullName);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramCount++}`);
      values.push(phone === '' ? null : phone);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.user.id);
    const result = await pool.query(
      `UPDATE ${table} SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING id, email, phone, full_name, ${table === 'users' ? 'role,' : ''} created_at`,
      values
    );

    const dbUser = result.rows[0];
    res.json({
      user: {
        id: dbUser.id,
        email: dbUser.email,
        fullName: dbUser.full_name,
        phone: dbUser.phone,
        role: req.user.accountType === 'driver' ? 'driver' : dbUser.role,
        createdAt: dbUser.created_at
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * @route   POST /api/auth/push-token
 * @desc    Register Expo push token for notifications
 * @access  Private
 */
router.post('/push-token', [
  body('expoPushToken').trim().notEmpty(),
  body('deviceId').optional().trim(),
], authenticate, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { expoPushToken, deviceId } = req.body;
    
    await pool.query(
      `INSERT INTO user_push_tokens (user_id, expo_push_token, device_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, expo_push_token) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, expoPushToken, deviceId || null]
    );
    res.json({ message: 'Push token registered' });
  } catch (error) {
    console.error('Push token error:', error);
    res.status(500).json({ error: 'Failed to register push token' });
  }
});

module.exports = router;


