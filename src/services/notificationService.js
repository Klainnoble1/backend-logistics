const pool = require('../config/database');
const axios = require('axios');

// Send push notification via Expo
async function sendPushNotification(expoPushToken, title, message, data = {}) {
  try {
    const response = await axios.post('https://exp.host/--/api/v2/push/send', {
      to: expoPushToken,
      sound: 'default',
      title,
      body: message,
      data,
    }, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  } catch (error) {
    console.error('Push notification error:', error);
    throw error;
  }
}

// Create notification record
async function createNotification(userId, parcelId, type, title, message) {
  try {
    const result = await pool.query(
      `INSERT INTO notifications (user_id, parcel_id, type, title, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, parcelId, type, title, message]
    );

    return result.rows[0];
  } catch (error) {
    console.error('Create notification error:', error);
    throw error;
  }
}

// Notify user about status update
async function notifyStatusUpdate(parcelId, status, userId) {
  try {
    // Get parcel details
    const parcelResult = await pool.query(
      'SELECT * FROM parcels WHERE id = $1',
      [parcelId]
    );

    if (parcelResult.rows.length === 0) return;

    const parcel = parcelResult.rows[0];

    // Get user's push token (would be stored in users table or separate table)
    // For now, just create notification record
    const title = 'Parcel Status Updated';
    const message = `Your parcel ${parcel.tracking_id} status: ${status.replace('_', ' ')}`;

    await createNotification(
      parcel.sender_id,
      parcelId,
      'status_update',
      title,
      message
    );

    // TODO: Send actual push notification if user has token
  } catch (error) {
    console.error('Notify status update error:', error);
  }
}

// Notify driver about assignment
async function notifyDriverAssignment(driverId, parcelId) {
  try {
    // Get driver's user_id
    const driverResult = await pool.query(
      'SELECT user_id FROM drivers WHERE id = $1',
      [driverId]
    );

    if (driverResult.rows.length === 0) return;

    const userId = driverResult.rows[0].user_id;

    // Get parcel details
    const parcelResult = await pool.query(
      'SELECT tracking_id FROM parcels WHERE id = $1',
      [parcelId]
    );

    if (parcelResult.rows.length === 0) return;

    const trackingId = parcelResult.rows[0].tracking_id;

    const title = 'New Delivery Assignment';
    const message = `You have been assigned parcel ${trackingId}`;

    await createNotification(
      userId,
      parcelId,
      'assignment',
      title,
      message
    );

    // TODO: Send actual push notification if driver has token
  } catch (error) {
    console.error('Notify driver assignment error:', error);
  }
}

module.exports = {
  sendPushNotification,
  createNotification,
  notifyStatusUpdate,
  notifyDriverAssignment,
};


