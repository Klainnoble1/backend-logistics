// Vercel serverless entry: forwards all requests to the Express app
let app;
try {
  app = require('../src/server');
} catch (err) {
  console.error('Server load error:', err);
  const express = require('express');
  app = express();
  app.use((req, res) => {
    res.status(500).json({
      error: 'Server failed to load',
      message: err.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    });
  });
}
module.exports = app;
