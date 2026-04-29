const express = require('express');
const cors = require('cors');
const { clerkMiddleware } = require('@clerk/express');
const helmet = require('helmet');
const compression = require('compression');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(clerkMiddleware());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  },
}));
app.use(express.urlencoded({ extended: true }));

// Root – show API info (so base URL isn’t “Route not found”)
app.get('/', (req, res) => {
  res.json({
    name: 'Naomi Express API',
    status: 'ok',
    docs: {
      health: '/health',
      auth: '/api/auth (login, register, me)',
      parcels: '/api/parcels',
      drivers: '/api/drivers',
      admin: '/api/admin',
      payments: '/api/payments'
    }
  });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/parcels', require('./routes/parcels'));
app.use('/api/drivers', require('./routes/drivers'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/addresses', require('./routes/addresses'));
// Lazy-load payments so a paymentService load error doesn't crash the whole API
app.use('/api/payments', (req, res, next) => {
  try {
    const paymentsRouter = require('./routes/payments');
    return paymentsRouter(req, res, next);
  } catch (err) {
    console.error('Payments route load error:', err);
    res.status(500).json({ error: 'Payments module failed to load', message: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Naomi Express API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Only start listening when run directly (not when required by Vercel serverless)
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Accessible at http://localhost:${PORT} or http://YOUR_IP:${PORT}`);
  });
}

module.exports = app;
