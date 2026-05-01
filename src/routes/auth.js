const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const multer = require('multer');
const { uploadBuffer } = require('../utils/cloudinary');

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

/**
 * @access  Public
 */
router.post('/register', upload.fields([
  { name: 'profilePicture', maxCount: 1 },
  { name: 'licenseImage', maxCount: 1 },
  { name: 'motorcycleReg', maxCount: 1 }
]), [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('fullName').notEmpty(),
  body('phone').notEmpty(),
  body('role').isIn(['user', 'driver']).optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, fullName, phone, role } = req.body;
    const isDriver = role === 'driver';
    const table = isDriver ? 'drivers' : 'users';

    // Check if email exists
    const existing = await pool.query(`SELECT id FROM ${table} WHERE email = $1`, [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let profilePictureUrl = null;
    let licenseImageUrl = null;
    let motorcycleRegUrl = null;

    if (isDriver) {
      if (req.files) {
        if (req.files.profilePicture) {
          profilePictureUrl = await uploadBuffer(req.files.profilePicture[0].buffer, 'drivers/profiles');
        }
        if (req.files.licenseImage) {
          licenseImageUrl = await uploadBuffer(req.files.licenseImage[0].buffer, 'drivers/licenses');
        }
        if (req.files.motorcycleReg) {
          motorcycleRegUrl = await uploadBuffer(req.files.motorcycleReg[0].buffer, 'drivers/registrations');
        }
      }

      // If we received documents, mark as verified automatically
      const hasDocs = profilePictureUrl && licenseImageUrl && motorcycleRegUrl;
      const verificationStatus = hasDocs ? 'verified' : 'pending';
      const driverStatus = 'offline';

      const result = await pool.query(
        `INSERT INTO drivers (
          email, password_hash, full_name, phone, 
          profile_picture_url, license_image_url, motorcycle_reg_url,
          verification_status, status, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true) RETURNING id`,
        [email, passwordHash, fullName, phone, profilePictureUrl, licenseImageUrl, motorcycleRegUrl, verificationStatus, driverStatus]
      );

      res.status(201).json({ message: 'Driver registered successfully', id: result.rows[0].id });
    } else {
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, phone, role, is_active) 
         VALUES ($1, $2, $3, $4, 'user', true) RETURNING id`,
        [email, passwordHash, fullName, phone]
      );
      res.status(201).json({ message: 'User registered successfully', id: result.rows[0].id });
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register' });
  }
});

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
      `SELECT id, email, phone, full_name, ${table === 'users' ? 'role,' : 'verification_status,'} created_at FROM ${table} WHERE id = $1`,
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
        verificationStatus: req.user.accountType === 'driver' ? dbUser.verification_status : undefined,
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


