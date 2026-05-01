const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   POST /api/auth/login
 * @desc    Login with email and password
 * @access  Public
 */
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    
    // Check in users table
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    let user = userRes.rows[0];
    let accountType = 'user';

    // If not in users, check in drivers
    if (!user) {
      const driverRes = await pool.query('SELECT * FROM drivers WHERE email = $1', [email]);
      user = driverRes.rows[0];
      accountType = 'driver';
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is inactive' });
    }

    // Verify password (bcrypt compare)
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role || 'driver',
        accountType: user.role === 'admin' ? 'admin' : accountType
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role || 'driver'
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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


