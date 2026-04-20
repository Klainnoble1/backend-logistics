const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { body, validationResult } = require('express-validator');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
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
    const table = role === 'driver' ? 'drivers' : 'users';

    // Check if account exists in the specific table
    let existingAccount;
    if (phoneVal) {
      existingAccount = await pool.query(
        `SELECT id FROM ${table} WHERE email = $1 OR phone = $2`,
        [email, phoneVal]
      );
    } else {
      existingAccount = await pool.query(
        `SELECT id FROM ${table} WHERE email = $1`,
        [email]
      );
    }

    if (existingAccount.rows.length > 0) {
      return res.status(400).json({ error: `A ${role} with this email or phone already exists` });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create account in the specific table
    let result;
    if (table === 'drivers') {
      result = await pool.query(
        `INSERT INTO drivers (email, phone, password_hash, full_name, status)
         VALUES ($1, $2, $3, $4, 'offline')
         RETURNING id, email, full_name, created_at`,
        [email, phoneVal, passwordHash, fullName]
      );
    } else {
      result = await pool.query(
        `INSERT INTO users (email, phone, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, full_name, role, created_at`,
        [email, phoneVal, passwordHash, fullName, role]
      );
    }

    const account = result.rows[0];

    // Generate token with accountType
    const token = jwt.sign(
      { userId: account.id, email: account.email, role: table === 'drivers' ? 'driver' : account.role, accountType: table === 'drivers' ? 'driver' : 'user' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      message: `${role === 'driver' ? 'Driver' : 'User'} registered successfully`,
      token,
      user: {
        id: account.id,
        email: account.email,
        fullName: account.full_name,
        role: table === 'drivers' ? 'driver' : account.role
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

    const { email, password, role = 'customer' } = req.body;
    const table = role === 'driver' ? 'drivers' : 'users';

    // Find account in the specific table
    const result = await pool.query(
      `SELECT id, email, password_hash, full_name, ${table === 'users' ? 'role,' : ''} is_active FROM ${table} WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: `Invalid ${role} credentials` });
    }

    const account = result.rows[0];

    if (!account.is_active) {
      return res.status(401).json({ error: 'Account is inactive' });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, account.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: `Invalid ${role} credentials` });
    }

    // Generate token with accountType
    const token = jwt.sign(
      { userId: account.id, email: account.email, role: table === 'drivers' ? 'driver' : account.role, accountType: table === 'drivers' ? 'driver' : 'user' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: account.id,
        email: account.email,
        fullName: account.full_name,
        role: table === 'drivers' ? 'driver' : account.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Google Sign-In / Sign-Up
router.post('/google', [
  body('idToken').notEmpty(),
  body('role').optional().isIn(['customer', 'driver'])
], async (req, res) => {
  try {
    const { idToken, role = 'customer' } = req.body;
    const table = role === 'driver' ? 'drivers' : 'users';

    // 1. Verify Google Token
    // 1. Verify Google Token
    const clientIds = [
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_ID_DRIVER,
      process.env.GOOGLE_CLIENT_ID_IOS,
      process.env.GOOGLE_CLIENT_ID_ANDROID,
      process.env.GOOGLE_CLIENT_ID_DRIVER_IOS,
      process.env.GOOGLE_CLIENT_ID_DRIVER_ANDROID,
      '569746147360-5mc4elhn9i5na1ogbpmusk3k5tog0g2p.apps.googleusercontent.com', // User App Web ID
      '569746147360-rrl47k24ibrugtr8eo9u8nak4fu3lriq.apps.googleusercontent.com', // User App iOS ID
      '569746147360-u0114q12kubma4tlklmvdag3d5nuohdb.apps.googleusercontent.com', // Driver App Web ID
      '569746147360-8pdhvpbprgeojglih2mtg7o3uvfq4rgv.apps.googleusercontent.com', // Driver App iOS ID
      '569746147360-t260d2s48opec01s37q5lr26ofhnk8qm.apps.googleusercontent.com'  // Original ID
    ].filter(id => !!id);

    console.log('[GoogleAuth] Attempting to verify token for role:', role);
    console.log('[GoogleAuth] Allowed Client IDs:', clientIds);

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken,
        audience: clientIds,
      });
    } catch (err) {
      console.error('[GoogleAuth] Token verification failed:', err.message);
      return res.status(401).json({ 
        error: 'Google token verification failed', 
        details: err.message 
      });
    }
    const payload = ticket.getPayload();
    const { email, name, picture, sub: googleId } = payload;

    if (!email) {
      return res.status(400).json({ error: 'Google account must have an email' });
    }

    // 2. Check if user already exists
    let result = await pool.query(
      `SELECT id, email, full_name, ${table === 'users' ? 'role,' : ''} is_active FROM ${table} WHERE email = $1`,
      [email]
    );

    let account;
    if (result.rows.length === 0) {
      // 3. Auto-Register (Signup) if user doesn't exist
      console.log(`Auto-registering new ${role} via Google:`, email);
      
      if (table === 'drivers') {
        result = await pool.query(
          `INSERT INTO drivers (email, full_name, status, google_id, profile_pic)
           VALUES ($1, $2, 'offline', $3, $4)
           RETURNING id, email, full_name`,
          [email, name, googleId, picture]
        );
      } else {
        result = await pool.query(
          `INSERT INTO users (email, full_name, role, google_id, profile_pic)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, email, full_name, role`,
          [email, name, role, googleId, picture]
        );
      }
      account = result.rows[0];
    } else {
      // 4. Existing account - check if active
      account = result.rows[0];
      if (!account.is_active) {
        return res.status(401).json({ error: 'Account is inactive' });
      }
      
      // Update Google ID if not already set
      await pool.query(
        `UPDATE ${table} SET google_id = $1 WHERE id = $2 AND google_id IS NULL`,
        [googleId, account.id]
      );
    }

    // 5. Generate JWT Token
    const token = jwt.sign(
      { 
        userId: account.id, 
        email: account.email, 
        role: table === 'drivers' ? 'driver' : account.role, 
        accountType: table === 'drivers' ? 'driver' : 'user' 
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: 'Google login successful',
      token,
      user: {
        id: account.id,
        email: account.email,
        fullName: account.full_name,
        role: table === 'drivers' ? 'driver' : account.role
      }
    });
  } catch (error) {
    console.error('Google Auth error:', error);
    res.status(401).json({ error: 'Google authentication failed: ' + error.message });
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
    const table = req.user.accountType === 'driver' ? 'drivers' : 'users';
    const result = await pool.query(
      `SELECT id, email, phone, full_name, ${table === 'users' ? 'role,' : ''} created_at FROM ${table} WHERE id = $1`,
      [req.user.id]
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
        role: req.user.accountType === 'driver' ? 'driver' : dbUser.role,
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
        role: req.user.accountType === 'driver' ? 'driver' : dbUser.role,
        createdAt: dbUser.created_at
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile: ' + error.message });
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

    // Check users table first, then drivers
    let result = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    let foundInTable = 'users';
    if (result.rows.length === 0) {
      result = await pool.query(
        'SELECT id FROM drivers WHERE email = $1',
        [email]
      );
      foundInTable = 'drivers';
    }

    if (result.rows.length === 0) {
      return res.json({ message: 'If that email is registered, you will receive reset instructions.' });
    }

    const userId = result.rows[0].id;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Note: password_reset_tokens doesn't have a table column, but the ID is unique across both
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
          subject: 'Password reset – Naomi Express',
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


