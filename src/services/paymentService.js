const pool = require('../config/database');
const axios = require('axios');

// Initialize payment (Stripe example)
async function initializePayment(parcelId, userId, amount, currency = 'USD') {
  try {
    // Create payment record
    const paymentResult = await pool.query(
      `INSERT INTO payments (parcel_id, user_id, amount, payment_method, payment_status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [parcelId, userId, amount, 'stripe']
    );

    const payment = paymentResult.rows[0];

    // Initialize Stripe payment (example - requires Stripe SDK)
    // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    // const paymentIntent = await stripe.paymentIntents.create({
    //   amount: Math.round(amount * 100), // Convert to cents
    //   currency: currency.toLowerCase(),
    //   metadata: { parcelId, paymentId: payment.id },
    // });

    // For now, return payment record
    // In production, return paymentIntent.client_secret for frontend
    return {
      paymentId: payment.id,
      amount: payment.amount,
      // clientSecret: paymentIntent.client_secret,
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
  handlePaymentWebhook,
  refundPayment,
};


