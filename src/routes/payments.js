const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { initializePayment, confirmPayment, refundPayment, verifyPaystackReference } = require('../services/paymentService');

const router = express.Router();

// Paystack callback (no auth - user returns from Paystack redirect)
router.get('/paystack-callback', async (req, res) => {
  try {
    const { reference } = req.query;
    if (!reference) {
      return res.redirect('/?payment=error&message=missing_reference');
    }
    const verified = await verifyPaystackReference(reference);
    if (!verified.paymentId) {
      return res.redirect('/?payment=error&message=invalid_metadata');
    }
    await confirmPayment(verified.paymentId, reference);
    // Redirect to app (web: same origin; native: use deep link in production)
    const appUrl = process.env.APP_URL || 'http://localhost:19006';
    return res.redirect(`${appUrl}/?payment=success&reference=${reference}`);
  } catch (error) {
    console.error('Paystack callback error:', error);
    const appUrl = process.env.APP_URL || 'http://localhost:19006';
    return res.redirect(`${appUrl}/?payment=error&message=verification_failed`);
  }
});

// All other routes require authentication
router.use(authenticate);

// Initialize payment (Paystack)
router.post('/initialize', [
  body('parcelId').isUUID(),
  body('amount').isFloat({ min: 0 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { parcelId, amount } = req.body;

    // Verify parcel belongs to user
    const parcelResult = await pool.query(
      'SELECT id, price FROM parcels WHERE id = $1 AND sender_id = $2',
      [parcelId, req.user.id]
    );

    if (parcelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Parcel not found' });
    }

    const parcel = parcelResult.rows[0];

    if (parseFloat(amount) !== parseFloat(parcel.price)) {
      return res.status(400).json({ error: 'Amount mismatch' });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const callbackUrl = `${baseUrl}/api/payments/paystack-callback`;
    const email = req.user.email || 'customer@example.com';

    const payment = await initializePayment(parcelId, req.user.id, amount, email, callbackUrl);

    res.json({
      message: 'Payment initialized',
      payment,
    });
  } catch (error) {
    console.error('Initialize payment error:', error);
    res.status(500).json({ error: error.response?.data?.message || 'Failed to initialize payment' });
  }
});

// Confirm payment
router.post('/confirm', [
  body('paymentId').isUUID(),
  body('transactionId').trim().notEmpty(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { paymentId, transactionId } = req.body;

    const payment = await confirmPayment(paymentId, transactionId);

    res.json({
      message: 'Payment confirmed',
      payment,
    });
  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// Get payment history
router.get('/history', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, pr.tracking_id, pr.recipient_name
       FROM payments p
       INNER JOIN parcels pr ON p.parcel_id = pr.id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );

    res.json({ payments: result.rows });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({ error: 'Failed to get payment history' });
  }
});

module.exports = router;


