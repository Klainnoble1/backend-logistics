const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root – show API info (so base URL isn’t “Route not found”)
app.get('/', (req, res) => {
  res.json({
    name: 'Oprime Logistics API',
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
app.use('/api/payments', require('./routes/payments'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Oprime Logistics API is running' });
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

