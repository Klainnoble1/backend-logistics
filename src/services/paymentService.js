const crypto = require('crypto');
const pool = require('../config/database');
const axios = require('axios');
const { notifyDriversNewParcelAvailable } = require('./notificationService');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = 'https://api.paystack.co';

function buildPaymentReference(paymentId) {
  const shortId = String(paymentId).split('-')[0].toUpperCase();
  const timestamp = Date.now().toString(36).toUpperCase();
  return `OPRIME-${shortId}-${timestamp}`;
}

async function getPaymentById(paymentId) {
  const result = await pool.query(
    'SELECT * FROM payments WHERE id = $1',
    [paymentId]
  );
  return result.rows[0] || null;
}

async function getPaymentForUser(paymentId, userId) {
  const result = await pool.query(
    'SELECT * FROM payments WHERE id = $1 AND user_id = $2',
    [paymentId, userId]
  );
  return result.rows[0] || null;
}

async function hasCompletedPaymentForParcel(parcelId) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM payments
       WHERE parcel_id = $1 AND payment_status = 'completed'
     ) AS has_completed_payment`,
    [parcelId]
  );

  return Boolean(result.rows[0]?.has_completed_payment);
}

async function publishPaidParcelToDrivers(parcelId) {
  const parcelResult = await pool.query(
    'SELECT id, tracking_id, status FROM parcels WHERE id = $1',
    [parcelId]
  );

  if (parcelResult.rows.length === 0) {
    return;
  }

  const parcel = parcelResult.rows[0];
  if (parcel.status !== 'paid') {
    return;
  }

  await notifyDriversNewParcelAvailable(parcel.id, parcel.tracking_id);
}

// Initialize payment with Paystack
async function initializePayment(parcelId, userId, amount, email, callbackUrl, metadata = {}) {
  let payment = null;
  try {
    await pool.query(
      `UPDATE payments
       SET payment_status = 'failed', updated_at = CURRENT_TIMESTAMP
       WHERE parcel_id = $1 AND user_id = $2 AND payment_status = 'pending'`,
      [parcelId, userId]
    );

    const paymentResult = await pool.query(
      `INSERT INTO payments (parcel_id, user_id, amount, payment_method, payment_status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [parcelId, userId, amount, 'paystack']
    );

    payment = paymentResult.rows[0];
    const reference = buildPaymentReference(payment.id);

    await pool.query(
      `UPDATE payments
       SET transaction_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [reference, payment.id]
    );

    if (!PAYSTACK_SECRET) {
      return {
        paymentId: payment.id,
        amount: Number(payment.amount),
        authorization_url: null,
        reference,
        message: 'Paystack not configured. Set PAYSTACK_SECRET_KEY.',
      };
    }

    const amountKobo = Math.round(Number(amount) * 100);
    const res = await axios.post(
      `${PAYSTACK_BASE}/transaction/initialize`,
      {
        email: email || 'customer@example.com',
        amount: amountKobo,
        currency: 'NGN',
        reference,
        callback_url: callbackUrl || undefined,
        metadata: {
          parcel_id: parcelId,
          payment_id: payment.id,
          user_id: userId,
          ...metadata,
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
      amount: Number(payment.amount),
      authorization_url: data.authorization_url,
      access_code: data.access_code,
      reference: data.reference || reference,
    };
  } catch (error) {
    if (payment?.id) {
      await markPaymentFailed(payment.id, payment.transaction_id).catch(() => null);
    }
    console.error('Initialize payment error:', error);
    throw error;
  }
}

// Confirm payment
async function confirmPayment(paymentId, transactionId) {
  try {
    const existing = await getPaymentById(paymentId);
    if (!existing) {
      throw new Error('Payment not found');
    }

    if (existing.payment_status === 'completed') {
      return existing;
    }

    const result = await pool.query(
      `UPDATE payments
       SET payment_status = 'completed',
           transaction_id = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [transactionId || existing.transaction_id, paymentId]
    );

    const confirmedPayment = result.rows[0];

    // Update parcel status to 'paid' and record history
    try {
      await pool.query(
        "UPDATE parcels SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [confirmedPayment.parcel_id]
      );
      await pool.query(
        `INSERT INTO parcel_status_history (parcel_id, status, location, updated_by, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [confirmedPayment.parcel_id, 'paid', 'Payment Service', confirmedPayment.user_id, 'Payment confirmed successfully']
      );
    } catch (dbError) {
      console.error('Failed to update parcel status to paid:', dbError);
    }

    publishPaidParcelToDrivers(confirmedPayment.parcel_id).catch((error) => {
      console.error('Publish paid parcel to drivers error:', error);
    });

    return confirmedPayment;
  } catch (error) {
    console.error('Confirm payment error:', error);
    throw error;
  }
}

async function markPaymentFailed(paymentId, transactionId) {
  const result = await pool.query(
    `UPDATE payments
     SET payment_status = 'failed',
         transaction_id = COALESCE($1, transaction_id),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING *`,
    [transactionId || null, paymentId]
  );

  if (result.rows.length === 0) {
    throw new Error('Payment not found');
  }

  return result.rows[0];
}

// Verify Paystack transaction by reference
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
    if (!res.data?.status || !data) {
      return {};
    }

    // Robustly parse metadata
    let metadata = data.metadata || {};
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (e) {
        console.error('Failed to parse Paystack metadata string:', e);
        metadata = {};
      }
    }

    return {
      paymentId: metadata.payment_id || null,
      reference: data.reference || reference,
      status: data.status || null,
      amount: data.amount != null ? Number(data.amount) / 100 : null,
      paidAt: data.paid_at || null,
      channel: data.channel || null,
      gatewayResponse: data.gateway_response || null,
      customerEmail: data.customer?.email || null,
      metadata: metadata,
    };
  } catch (error) {
    console.error('Verify Paystack reference error:', error.response?.data || error.message || error);
    return {};
  }
}

function isPaystackWebhookSignatureValid(rawBody, signature) {
  if (!PAYSTACK_SECRET || !rawBody || !signature) {
    return false;
  }

  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET)
    .update(rawBody)
    .digest('hex');

  return hash === signature;
}

async function handlePaystackWebhook(event) {
  try {
    if (!event || !event.event || !event.data) {
      return;
    }

    if (event.event === 'charge.success') {
      let metadata = event.data.metadata || {};
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata);
        } catch (e) {
          metadata = {};
        }
      }

      const paymentId = metadata.payment_id;
      const reference = event.data.reference;
      if (paymentId) {
        await confirmPayment(paymentId, reference || null);
      }
    }

    if (event.event === 'charge.failed') {
      let metadata = event.data.metadata || {};
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata);
        } catch (e) {
          metadata = {};
        }
      }

      const paymentId = metadata.payment_id;
      const reference = event.data.reference;
      if (paymentId) {
        await markPaymentFailed(paymentId, reference || null);
      }
    }
  } catch (error) {
    console.error('Handle payment webhook error:', error);
    throw error;
  }
}

// Refund payment
async function refundPayment(paymentId, amount) {
  try {
    const payment = await getPaymentById(paymentId);

    if (!payment) {
      throw new Error('Payment not found');
    }

    if (payment.payment_status !== 'completed') {
      throw new Error('Payment not completed');
    }

    await pool.query(
      `UPDATE payments
       SET payment_status = 'refunded', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [paymentId]
    );

    return { success: true, amount };
  } catch (error) {
    console.error('Refund payment error:', error);
    throw error;
  }
}

module.exports = {
  initializePayment,
  confirmPayment,
  markPaymentFailed,
  verifyPaystackReference,
  isPaystackWebhookSignatureValid,
  handlePaystackWebhook,
  refundPayment,
  getPaymentForUser,
  hasCompletedPaymentForParcel,
};


