const pool = require('../config/database');
const axios = require('axios');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = 'https://api.paystack.co';

// Initialize payment with Paystack
async function initializePayment(parcelId, userId, amount, email, callbackUrl) {
  try {
    // Create payment record
    const paymentResult = await pool.query(
      `INSERT INTO payments (parcel_id, user_id, amount, payment_method, payment_status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [parcelId, userId, amount, 'paystack']
    );

    const payment = paymentResult.rows[0];

    if (!PAYSTACK_SECRET) {
      // No key: return payment record for testing (no redirect)
      return {
        paymentId: payment.id,
        amount: payment.amount,
        authorization_url: null,
        message: 'Paystack not configured. Set PAYSTACK_SECRET_KEY.',
      };
    }

    // Amount in kobo (NGN * 100)
    const amountKobo = Math.round(parseFloat(amount) * 100);

    const res = await axios.post(
      `${PAYSTACK_BASE}/transaction/initialize`,
      {
        email: email || 'customer@example.com',
        amount: amountKobo,
        currency: 'NGN',
        callback_url: callbackUrl || undefined,
        metadata: {
          parcel_id: parcelId,
          payment_id: payment.id,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const data = res.data?.data;
    if (!data?.authorization_url) {
      throw new Error(res.data?.message || 'Paystack did not return authorization URL');
    }

    return {
      paymentId: payment.id,
      amount: payment.amount,
      authorization_url: data.authorization_url,
      access_code: data.access_code,
      reference: data.reference,
    };
  } catch (error) {
    console.error('Initialize payment error:', error);
    throw error;
  }
}

// Confirm payment
async function confirmPayment(paymentId, transactionId) {
  try {
    const result = await pool.query(
      `UPDATE payments 
       SET payment_status = 'completed', transaction_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [transactionId, paymentId]
    );

    if (result.rows.length === 0) {
      throw new Error('Payment not found');
    }

    return result.rows[0];
  } catch (error) {
    console.error('Confirm payment error:', error);
    throw error;
  }
}

// Handle payment webhook (Stripe example)
async function handlePaymentWebhook(event) {
  try {
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const parcelId = paymentIntent.metadata.parcelId;
      const paymentId = paymentIntent.metadata.paymentId;

      await confirmPayment(paymentId, paymentIntent.id);
    }
  } catch (error) {
    console.error('Handle payment webhook error:', error);
    throw error;
  }
}

// Verify Paystack transaction by reference; returns { paymentId } from metadata for callback
async function verifyPaystackReference(reference) {
  try {
    if (!PAYSTACK_SECRET || !reference) {
      return {};
    }
    const res = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    const data = res.data?.data;
    if (!res.data?.status || !data || data.status !== 'success') {
      return {};
    }
    const paymentId = data.metadata?.payment_id || null;
    return { paymentId };
  } catch (error) {
    console.error('Verify Paystack reference error:', error);
    return {};
  }
}

// Refund payment
async function refundPayment(paymentId, amount) {
  try {
    const paymentResult = await pool.query(
      'SELECT * FROM payments WHERE id = $1',
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      throw new Error('Payment not found');
    }

    const payment = paymentResult.rows[0];

    if (payment.payment_status !== 'completed') {
      throw new Error('Payment not completed');
    }

    // Process refund (Stripe example)
    // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    // const refund = await stripe.refunds.create({
    //   payment_intent: payment.transaction_id,
    //   amount: Math.round(amount * 100),
    // });

    // Update payment status
    await pool.query(
      `UPDATE payments 
       SET payment_status = 'refunded', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [paymentId]
    );

    return { success: true };
  } catch (error) {
    console.error('Refund payment error:', error);
    throw error;
  }
}

module.exports = {
  initializePayment,
  confirmPayment,
  verifyPaystackReference,
  handlePaymentWebhook,
  refundPayment,
};


