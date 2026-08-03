const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { initializePayment } = require('../services/paymentService');

const router = express.Router();

router.use(authenticate);

const mapPartner = (row) => ({
  id: row.id,
  email: row.email,
  phone: row.phone,
  fullName: row.full_name,
  businessName: row.business_name,
  accountType: row.account_type || 'partner',
  commissionPercentage: parseFloat(row.commission_percentage || 0),
  walletBalance: parseFloat(row.wallet_balance || 0),
  totalOrders: row.total_orders || 0,
  completedOrders: row.completed_orders || 0,
  bankName: row.bank_name,
  accountNumber: row.account_number,
  accountName: row.account_name,
  isActive: row.is_active,
  createdAt: row.created_at,
});

const mapOrder = (row) => ({
  id: row.id,
  trackingId: row.tracking_id,
  recipientName: row.recipient_name,
  recipientPhone: row.recipient_phone,
  pickupAddress: row.pickup_address,
  deliveryAddress: row.delivery_address,
  parcelType: row.parcel_type,
  weight: parseFloat(row.weight || 0),
  serviceType: row.service_type,
  status: row.status,
  price: parseFloat(row.price || 0),
  commissionPercentage: parseFloat(row.partner_commission_percentage || 0),
  commissionAmount: parseFloat(row.partner_commission_amount || 0),
  commissionCreditedAt: row.partner_commission_credited_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const generateTemporaryPassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
  const bytes = crypto.randomBytes(14);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
};

const getDefaultCommissionPercentage = async (client = pool) => {
  const result = await client.query(
    `SELECT value FROM app_settings WHERE key = 'partner_default_commission_percentage'`
  );
  const rawValue = result.rows[0]?.value;
  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) ? numericValue : 10;
};

router.get('/me', authorize('partner'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM partners WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Partner profile not found' });
    }

    const ordersResult = await pool.query(
      `SELECT COUNT(*)::int AS total_orders,
              COUNT(*) FILTER (WHERE status = 'delivered')::int AS completed_orders,
              COALESCE(SUM(partner_commission_amount) FILTER (WHERE partner_commission_credited_at IS NOT NULL), 0) AS credited_total
       FROM parcels
       WHERE partner_id = $1`,
      [req.user.id]
    );

    res.json({
      partner: {
        ...mapPartner(result.rows[0]),
        totalOrders: ordersResult.rows[0]?.total_orders || 0,
        completedOrders: ordersResult.rows[0]?.completed_orders || 0,
        creditedTotal: parseFloat(ordersResult.rows[0]?.credited_total || 0),
      },
    });
  } catch (error) {
    console.error('Get partner profile error:', error);
    res.status(500).json({ error: 'Failed to get partner profile' });
  }
});

router.get('/me/orders', authorize('partner'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM parcels
       WHERE partner_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    res.json({ orders: result.rows.map(mapOrder) });
  } catch (error) {
    console.error('Get partner orders error:', error);
    res.status(500).json({ error: 'Failed to get partner orders' });
  }
});

router.post('/me/orders/:orderId/payment-link', authorize('partner'), async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await pool.query(
      `SELECT p.*, u.email AS sender_email
       FROM parcels p
       INNER JOIN users u ON p.sender_id = u.id
       WHERE p.id = $1 AND p.partner_id = $2
       LIMIT 1`,
      [orderId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Partner order not found' });
    }

    const order = result.rows[0];
    if (order.status !== 'created') {
      return res.status(400).json({ error: 'Payment links can only be generated for unpaid orders' });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const returnUrl = `${baseUrl}/api/payments/recipient-complete`;
    const callbackUrl = `${baseUrl}/api/payments/paystack-callback?returnUrl=${encodeURIComponent(returnUrl)}`;
    const email = order.sender_email || req.user.email || 'recipient@example.com';

    const payment = await initializePayment(order.id, order.sender_id, order.price, email, callbackUrl, {
      return_url: returnUrl,
      initiated_by: 'partner',
      partner_id: req.user.id,
      recipient_name: order.recipient_name,
      recipient_phone: order.recipient_phone,
      tracking_id: order.tracking_id,
    });

    if (!payment.authorization_url) {
      return res.status(503).json({
        error: payment.message || 'Payment provider is not configured',
        payment,
      });
    }

    res.status(201).json({
      message: 'Payment link generated',
      paymentLink: payment.authorization_url,
      reference: payment.reference,
      paymentId: payment.paymentId,
      amount: payment.amount,
      order: mapOrder(order),
    });
  } catch (error) {
    console.error('Generate partner payment link error:', error);
    res.status(500).json({ error: error.response?.data?.message || 'Failed to generate payment link' });
  }
});

router.put('/me/bank', [
  body('bankName').trim().notEmpty(),
  body('accountNumber').trim().isLength({ min: 10, max: 10 }).isNumeric(),
  body('accountName').trim().notEmpty(),
], authorize('partner'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { bankName, accountNumber, accountName } = req.body;
    const result = await pool.query(
      `UPDATE partners
       SET bank_name = $1, account_number = $2, account_name = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING bank_name, account_number, account_name`,
      [bankName, accountNumber, accountName, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Partner profile not found' });
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
    console.error('Save partner bank error:', error);
    res.status(500).json({ error: 'Failed to save bank details' });
  }
});

router.post('/me/withdraw', [
  body('amount').isFloat({ min: 1000, max: 2000000 }),
], authorize('partner'), async (req, res) => {
  const client = await pool.connect();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const amount = parseFloat(req.body.amount);
    await client.query('BEGIN');

    const partnerResult = await client.query(
      `SELECT id, wallet_balance, bank_name, account_number, account_name, full_name, business_name
       FROM partners
       WHERE id = $1
       FOR UPDATE`,
      [req.user.id]
    );

    if (partnerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Partner profile not found' });
    }

    const partner = partnerResult.rows[0];
    if (!partner.bank_name || !partner.account_number || !partner.account_name) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Please add your bank details before requesting a payout' });
    }

    const currentBalance = parseFloat(partner.wallet_balance || 0);
    if (amount > currentBalance) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Insufficient balance. Your current balance is ₦${currentBalance.toFixed(2)}` });
    }

    await client.query(
      `UPDATE partners SET wallet_balance = wallet_balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [amount, partner.id]
    );

    const withdrawalResult = await client.query(
      `INSERT INTO partner_withdrawals (partner_id, amount, status, bank_name, account_number, account_name)
       VALUES ($1, $2, 'pending', $3, $4, $5)
       RETURNING *`,
      [partner.id, amount, partner.bank_name, partner.account_number, partner.account_name]
    );

    const adminResult = await client.query(`SELECT id FROM users WHERE role = 'admin'`);
    const partnerName = partner.business_name || partner.full_name;
    for (const admin of adminResult.rows) {
      await client.query(
        `INSERT INTO notifications (user_id, parcel_id, type, title, message)
         VALUES ($1, NULL, 'partner_payout_request', $2, $3)`,
        [
          admin.id,
          'Partner Payout Request',
          `Partner ${partnerName} requested a payout of ₦${amount.toLocaleString('en-NG')}.`,
        ]
      );
    }

    await client.query('COMMIT');

    const withdrawal = withdrawalResult.rows[0];
    res.status(201).json({
      message: 'Payout request submitted successfully.',
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
    console.error('Partner payout request error:', error);
    res.status(500).json({ error: 'Failed to process payout request' });
  } finally {
    client.release();
  }
});

router.get('/me/withdrawals', authorize('partner'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM partner_withdrawals WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
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
    console.error('Get partner withdrawals error:', error);
    res.status(500).json({ error: 'Failed to get payout history' });
  }
});

router.get('/', authorize('admin'), async (req, res) => {
  try {
    const [partnerResult, defaultCommissionPercentage] = await Promise.all([
      pool.query(`SELECT * FROM partners ORDER BY created_at DESC`),
      getDefaultCommissionPercentage(),
    ]);
    res.json({
      partners: partnerResult.rows.map(mapPartner),
      settings: { defaultCommissionPercentage },
    });
  } catch (error) {
    console.error('Admin get partners error:', error);
    res.status(500).json({ error: 'Failed to get partners' });
  }
});

router.get('/settings', authorize('admin'), async (req, res) => {
  try {
    const defaultCommissionPercentage = await getDefaultCommissionPercentage();
    res.json({ settings: { defaultCommissionPercentage } });
  } catch (error) {
    console.error('Get partner settings error:', error);
    res.status(500).json({ error: 'Failed to get partner settings' });
  }
});

router.put('/settings', [
  body('defaultCommissionPercentage').isFloat({ min: 0, max: 100 }),
], authorize('admin'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const defaultCommissionPercentage = Number(req.body.defaultCommissionPercentage);
    await pool.query(
      `INSERT INTO app_settings (key, value)
       VALUES ('partner_default_commission_percentage', $1::jsonb)
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(defaultCommissionPercentage)]
    );

    res.json({ settings: { defaultCommissionPercentage } });
  } catch (error) {
    console.error('Update partner settings error:', error);
    res.status(500).json({ error: 'Failed to update partner settings' });
  }
});

router.post('/', [
  body('email').isEmail().normalizeEmail(),
  body('fullName').trim().notEmpty(),
  body('phone').optional().trim(),
  body('businessName').optional().trim(),
  body('accountType').optional().isIn(['partner', 'business_owner']),
  body('commissionPercentage').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
  body('isActive').optional().isBoolean(),
], authorize('admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      email,
      fullName,
      phone,
      businessName,
      accountType = 'partner',
      isActive = true,
    } = req.body;

    await client.query('BEGIN');
    const defaultCommissionPercentage = await getDefaultCommissionPercentage(client);
    const commissionPercentage = req.body.commissionPercentage === undefined || req.body.commissionPercentage === null || req.body.commissionPercentage === ''
      ? defaultCommissionPercentage
      : Number(req.body.commissionPercentage);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const userResult = await client.query(
      `INSERT INTO users (email, phone, full_name, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, 'partner', $5)
       ON CONFLICT (email) DO UPDATE
         SET role = 'partner',
             password_hash = EXCLUDED.password_hash,
             phone = COALESCE(EXCLUDED.phone, users.phone),
             full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), users.full_name),
             is_active = EXCLUDED.is_active,
             updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [email, phone || null, fullName, passwordHash, isActive]
    );

    const partnerResult = await client.query(
      `INSERT INTO partners (
         id, email, phone, full_name, business_name, account_type, password_hash,
         commission_percentage, is_active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (email) DO UPDATE
         SET phone = COALESCE(EXCLUDED.phone, partners.phone),
             password_hash = EXCLUDED.password_hash,
             full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), partners.full_name),
             business_name = EXCLUDED.business_name,
             account_type = EXCLUDED.account_type,
             commission_percentage = EXCLUDED.commission_percentage,
             is_active = EXCLUDED.is_active,
             updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        userResult.rows[0].id,
        email,
        phone || null,
        fullName,
        businessName || null,
        accountType,
        passwordHash,
        commissionPercentage,
        isActive,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({
      partner: mapPartner(partnerResult.rows[0]),
      temporaryPassword,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Admin create partner error:', error);
    res.status(500).json({ error: 'Failed to create partner' });
  } finally {
    client.release();
  }
});

router.put('/:partnerId', [
  body('commissionPercentage').optional().isFloat({ min: 0, max: 100 }),
  body('isActive').optional().isBoolean(),
  body('businessName').optional().trim(),
  body('accountType').optional().isIn(['partner', 'business_owner']),
], authorize('admin'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const updates = [];
    const values = [];
    let index = 1;

    if (req.body.commissionPercentage !== undefined) {
      updates.push(`commission_percentage = $${index++}`);
      values.push(req.body.commissionPercentage);
    }
    if (req.body.isActive !== undefined) {
      updates.push(`is_active = $${index++}`);
      values.push(req.body.isActive);
    }
    if (req.body.businessName !== undefined) {
      updates.push(`business_name = $${index++}`);
      values.push(req.body.businessName || null);
    }
    if (req.body.accountType !== undefined) {
      updates.push(`account_type = $${index++}`);
      values.push(req.body.accountType);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.partnerId);
    const result = await pool.query(
      `UPDATE partners SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${index}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Partner not found' });
    }

    res.json({ partner: mapPartner(result.rows[0]) });
  } catch (error) {
    console.error('Admin update partner error:', error);
    res.status(500).json({ error: 'Failed to update partner' });
  }
});

router.get('/admin/withdrawals', authorize('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    const params = [];
    let query = `
      SELECT w.*, p.full_name as partner_name, p.business_name, p.email as partner_email, p.phone as partner_phone
      FROM partner_withdrawals w
      INNER JOIN partners p ON w.partner_id = p.id
    `;
    if (status) {
      query += ' WHERE w.status = $1';
      params.push(status);
    }
    query += ' ORDER BY w.created_at DESC';
    const result = await pool.query(query, params);
    res.json({
      withdrawals: result.rows.map((w) => ({
        id: w.id,
        partnerId: w.partner_id,
        partnerName: w.business_name || w.partner_name,
        partnerEmail: w.partner_email,
        partnerPhone: w.partner_phone,
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
    console.error('Admin get partner withdrawals error:', error);
    res.status(500).json({ error: 'Failed to get partner withdrawals' });
  }
});

router.put('/admin/withdrawals/:id/status', [
  body('status').isIn(['pending', 'processing', 'completed', 'failed']),
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
      `SELECT * FROM partner_withdrawals WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (withdrawalResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Partner withdrawal not found' });
    }

    const withdrawal = withdrawalResult.rows[0];
    if (status === 'failed' && withdrawal.status !== 'failed') {
      await client.query(
        `UPDATE partners SET wallet_balance = wallet_balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [withdrawal.amount, withdrawal.partner_id]
      );
    }

    const updated = await client.query(
      `UPDATE partner_withdrawals
       SET status = $1, notes = COALESCE($2, notes), updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [status, notes || null, id]
    );

    await client.query('COMMIT');
    res.json({ withdrawal: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update partner withdrawal status error:', error);
    res.status(500).json({ error: 'Failed to update partner withdrawal status' });
  } finally {
    client.release();
  }
});

module.exports = router;
