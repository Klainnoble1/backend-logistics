const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('fullName').trim().notEmpty(),
  body('phone').optional().trim(),
  body('role').optional().isIn(['customer', 'driver'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, fullName, phone, role = 'customer' } = req.body;
    const phoneVal = phone != null && String(phone).trim() !== '' ? String(phone).trim() : null;

    // Check if user exists (email always; phone only when provided)
    let existingUser;
    if (phoneVal) {
      existingUser = await pool.query(
        'SELECT id FROM users WHERE email = $1 OR phone = $2',
        [email, phoneVal]
      );
    } else {
      existingUser = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );
    }

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'A user with this email or phone already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (email, phone, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name, role, created_at`,
      [email, phoneVal, passwordHash, fullName, role]
    );

    const user = result.rows[0];

    // If driver, create driver record
    if (role === 'driver') {
      await pool.query(
        'INSERT INTO drivers (user_id) VALUES ($1)',
        [user.id]
      );
    }

    // Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user
    const result = await pool.query(
      'SELECT id, email, password_hash, full_name, role, is_active FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is inactive' });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Register Expo push token for the current user (for push notifications with sound)
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
    if (!expoPushToken.startsWith('ExponentPushToken')) {
      return res.status(400).json({ error: 'Invalid Expo push token' });
    }
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

// Get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, phone, full_name, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const dbUser = result.rows[0];
    // Format user to match frontend expectations
    res.json({
      user: {
        id: dbUser.id,
        email: dbUser.email,
        fullName: dbUser.full_name,
        phone: dbUser.phone,
        role: dbUser.role,
        createdAt: dbUser.created_at
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update profile (fullName, phone)
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
      `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING id, email, phone, full_name, role, created_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const dbUser = result.rows[0];
    res.json({
      user: {
        id: dbUser.id,
        email: dbUser.email,
        fullName: dbUser.full_name,
        phone: dbUser.phone,
        role: dbUser.role,
        createdAt: dbUser.created_at
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Password reset request – generates token and stores it; in production send email with link
router.post('/password-reset', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;

    const result = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.json({ message: 'If that email is registered, you will receive reset instructions.' });
    }

    const userId = result.rows[0].id;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [userId, token, expiresAt]
    );

    // Send email when configured; otherwise user gets the code from the API response (in-app).
    let emailSent = false;
    if (process.env.SEND_RESET_EMAIL === 'true' && process.env.NODEMAILER_TRANSPORT) {
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport(JSON.parse(process.env.NODEMAILER_TRANSPORT));
        const appUrl = process.env.APP_URL || 'http://localhost:19006';
        await transporter.sendMail({
          from: process.env.RESET_EMAIL_FROM || 'noreply@example.com',
          to: email,
          subject: 'Password reset – Naomi Logistics',
          text: `Use this token in the app to set a new password: ${token}\nOr open: ${appUrl}/reset-password?token=${token}`,
        });
        emailSent = true;
      } catch (mailErr) {
        console.error('Send reset email error:', mailErr);
      }
    }

    // Return token in response when email was not sent so the app can show the code (dev or no email config).
    const includeToken = !emailSent;
    res.json({
      message: 'If that email is registered, you will receive reset instructions.',
      ...(includeToken && { resetToken: token })
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// Set new password using reset token (no auth required)
router.post('/set-password', [
  body('token').trim().notEmpty(),
  body('newPassword').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token, newPassword } = req.body;

    const tokenRow = await pool.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP AND used_at IS NULL`,
      [token]
    );

    if (tokenRow.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const { id: tokenId, user_id: userId } = tokenRow.rows[0];
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, userId]
    );
    await pool.query(
      'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [tokenId]
    );

    res.json({ message: 'Password updated successfully. You can now sign in.' });
  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({ error: 'Failed to set password' });
  }
});

module.exports = router;


