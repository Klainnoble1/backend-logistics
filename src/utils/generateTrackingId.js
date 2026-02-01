const { randomBytes } = require('crypto');

function generateTrackingId() {
  // Generate a 10-character alphanumeric tracking ID
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let trackingId = '';
  
  for (let i = 0; i < 10; i++) {
    trackingId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return trackingId;
}

module.exports = generateTrackingId;


