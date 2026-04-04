const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const {
  initializePayment,
  confirmPayment,
  refundPayment,
  verifyPaystackReference,
  handlePaystackWebhook,
  isPaystackWebhookSignatureValid,
  getPaymentForUser,
  markPaymentFailed,
} = require('../services/paymentService');

const router = express.Router();
const DEFAULT_RETURN_URL = process.env.APP_URL || 'oprime-logistics://payment-return';

const buildRedirectUrl = (rawReturnUrl, params = {}) => {
  const destination = resolveReturnUrl(rawReturnUrl);
  const target = new URL(destination);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      target.searchParams.set(key, String(value));
    }
  });

  return target.toString();
};

const getConfiguredWebOrigins = () =>
  [process.env.APP_URL, process.env.WEB_APP_URL]
    .filter(Boolean)
    .map((entry) => {
      try {
        return new URL(entry).origin;
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);

const isAllowedReturnUrl = (value) => {
  if (!value || typeof value !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(value);
    const protocol = parsed.protocol.toLowerCase();

    if (protocol === 'oprime-logistics:' || protocol === 'naomi-logistics:' || protocol === 'exp:' || protocol === 'exps:' || protocol === 'mobile-logistics:') {
      return true;
    }

    if (protocol === 'http:' || protocol === 'https:') {
      if (['localhost', '127.0.0.1'].includes(parsed.hostname)) {
        return true;
      }
      
      // Allow any IP address in dev mode
      if (process.env.NODE_ENV === 'development' && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(parsed.hostname)) {
        return true;
      }

      const allowedOrigins = getConfiguredWebOrigins();
      return allowedOrigins.includes(parsed.origin);
    }

    return false;
  } catch (error) {
    return false;
  }
};

const resolveReturnUrl = (value) => (
  isAllowedReturnUrl(value) ? value : DEFAULT_RETURN_URL
);

// Paystack webhook (no auth)
router.post('/paystack-webhook', (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const rawBody = req.rawBody || JSON.stringify(req.body || {});

  if (!isPaystackWebhookSignatureValid(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid Paystack signature' });
  }

  res.sendStatus(200);

  handlePaystackWebhook(req.body).catch((error) => {
    console.error('Paystack webhook processing error:', error);
  });
});

// Paystack callback (no auth - user returns from Paystack redirect)
router.get('/paystack-callback', async (req, res) => {
  try {
    const { reference, returnUrl } = req.query;
    console.log(`Paystack callback received - Ref: ${reference}, ReturnUrl: ${returnUrl}`);

    if (!reference) {
      return res.redirect(buildRedirectUrl(returnUrl, {
        payment: 'error',
        message: 'missing_reference',
      }));
    }

    const verified = await verifyPaystackReference(reference);
    
    const finalReturnUrl = returnUrl || verified.metadata?.return_url || DEFAULT_RETURN_URL;

    if (!verified.paymentId) {
      console.warn(`Paystack callback missing paymentId - Metadata: ${JSON.stringify(verified.metadata || {})}`);
      return res.redirect(buildRedirectUrl(finalReturnUrl, {
        payment: 'error',
        message: 'invalid_metadata',
      }));
    }

    const finalStatus = verified.status === 'success' ? 'success' : (verified.status === 'abandoned' ? 'cancelled' : 'failed');
    
    if (finalStatus === 'success') {
      await confirmPayment(verified.paymentId, reference);
    } else {
      await markPaymentFailed(verified.paymentId, reference).catch(() => null);
    }

    const redirectParams = {
      payment: finalStatus,
      paymentStatus: verified.status || finalStatus,
      paymentId: verified.paymentId,
      reference,
      message: verified.gatewayResponse || (finalStatus === 'success' ? 'Payment confirmed' : 'Payment not completed'),
    };

    const targetUrl = buildRedirectUrl(finalReturnUrl, redirectParams);
    console.log(`Paystack verification: ${finalStatus}, Redirecting to: ${targetUrl}`);

    // If it's a mobile custom scheme OR an Expo Go URL, prefer a direct 302 redirect
    // as WebBrowser.openAuthSessionAsync expects it to close the session
    const isMobileScheme = targetUrl.includes('://') && !targetUrl.startsWith('http');
    const isExpoUrl = targetUrl.startsWith('exp://') || targetUrl.startsWith('exps://');

    if (isMobileScheme || isExpoUrl) {
      // Force direct redirect for mobile/expo
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.redirect(302, targetUrl);
    }

    // Return HTML page for web/other cases
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Processing Payment...</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f9fbfd; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; color: #1e293b; }
            .card { background: white; padding: 32px; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); text-align: center; max-width: 400px; width: 90%; }
            .status-icon { width: 64px; height: 64px; border-radius: 32px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 32px; }
            .success { background: #dcfce7; color: #15803d; }
            .error { background: #fee2e2; color: #b91c1c; }
            h1 { font-size: 20px; margin-bottom: 8px; font-weight: 800; }
            p { color: #64748b; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
            .btn { background: #2563eb; color: white; border: none; padding: 12px 24px; border-radius: 12px; font-weight: 600; text-decoration: none; display: inline-block; transition: all 0.2s; }
            .btn:active { transform: scale(0.98); }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="status-icon ${finalStatus === 'success' ? 'success' : 'error'}">
              ${finalStatus === 'success' ? '✓' : '×'}
            </div>
            <h1>Payment ${finalStatus === 'success' ? 'Successful' : 'Failed'}</h1>
            <p>You are being redirected back to the ${process.env.APP_NAME || 'Logistics'} app...</p>
            <a href="${targetUrl}" id="redirect-btn" class="btn">Return to App</a>
          </div>
          <script>
            // Attempt to redirect immediately
            window.location.href = "${targetUrl}";
            
            // Fallback for some browsers/environments
            setTimeout(function() {
              document.getElementById('redirect-btn').style.display = 'inline-block';
            }, 2000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Paystack callback error:', error);
    const targetUrl = buildRedirectUrl(req.query.returnUrl, {
      payment: 'error',
      message: 'verification_failed',
    });
    return res.redirect(targetUrl);
  }
});

// All other routes require authentication
router.use(authenticate);

// Initialize payment (Paystack)
router.post('/initialize', [
  body('parcelId').isUUID(),
  body('amount').isFloat({ min: 0 }),
  body('returnUrl').optional().isString().trim().notEmpty(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { parcelId, amount, returnUrl } = req.body;

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
    const safeReturnUrl = resolveReturnUrl(returnUrl);
    const callbackUrl = `${baseUrl}/api/payments/paystack-callback?returnUrl=${encodeURIComponent(safeReturnUrl)}`;
    const email = req.user.email || 'customer@example.com';

    const payment = await initializePayment(parcelId, req.user.id, amount, email, callbackUrl, {
      return_url: safeReturnUrl,
    });

    res.json({
      message: 'Payment initialized',
      payment,
    });
  } catch (error) {
    console.error('Initialize payment error:', error);
    res.status(500).json({ error: error.response?.data?.message || 'Failed to initialize payment' });
  }
});

// Verify payment by Paystack reference
router.get('/verify/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const verified = await verifyPaystackReference(reference);

    if (!verified.paymentId) {
      return res.status(404).json({ error: 'Payment not found for reference' });
    }

    const payment = await getPaymentForUser(verified.paymentId, req.user.id);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    let finalPayment = payment;

    if (verified.status === 'success') {
      finalPayment = await confirmPayment(verified.paymentId, reference);
    } else if (verified.status === 'failed' || verified.status === 'abandoned') {
      finalPayment = await markPaymentFailed(verified.paymentId, reference);
    }

    res.json({
      message: verified.status === 'success' ? 'Payment verified' : 'Payment not completed',
      verified: {
        paymentId: verified.paymentId,
        paymentStatus: verified.status || finalPayment.payment_status,
        reference: verified.reference || reference,
        amount: verified.amount,
        paidAt: verified.paidAt,
        channel: verified.channel,
        gatewayResponse: verified.gatewayResponse,
      },
      payment: finalPayment,
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
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


