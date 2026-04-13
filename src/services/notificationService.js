const pool = require('../config/database');
const axios = require('axios');

// Get all Expo push tokens for a user (may have multiple devices)
async function getPushTokensForUser(userId) {
  try {
    const result = await pool.query(
      'SELECT expo_push_token FROM user_push_tokens WHERE user_id = $1',
      [userId]
    );
    return result.rows.map((r) => r.expo_push_token).filter(Boolean);
  } catch (err) {
    console.error('Get push tokens error:', err);
    return [];
  }
}

// Send push notification via Expo (with sound/ringtone)
async function sendPushNotification(expoPushToken, title, message, data = {}) {
  if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken')) {
    return;
  }
  try {
    const payload = {
      to: expoPushToken,
      sound: 'default',
      title,
      body: message,
      data,
      priority: 'high',
    };
    const response = await axios.post('https://exp.host/--/api/v2/push/send', payload, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (error) {
    console.error('Push notification error:', error?.response?.data || error.message);
  }
}

// Send push to all tokens for a user (non-blocking)
async function sendPushToUser(userId, title, message, data = {}) {
  const tokens = await getPushTokensForUser(userId);
  for (const token of tokens) {
    sendPushNotification(token, title, message, data).catch(() => {});
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

// Notify customer about order/parcel status update (in-app + push with sound)
async function notifyStatusUpdate(parcelId, status, userId) {
  try {
    const parcelResult = await pool.query(
      'SELECT * FROM parcels WHERE id = $1',
      [parcelId]
    );
    if (parcelResult.rows.length === 0) return;
    const parcel = parcelResult.rows[0];

    const title = 'Order update';
    const message = `Your parcel ${parcel.tracking_id}: ${status.replace(/_/g, ' ')}`;

    await createNotification(userId, parcelId, 'status_update', title, message);
    await sendPushToUser(userId, title, message, {
      type: 'status_update',
      parcelId,
      trackingId: parcel.tracking_id,
    });
  } catch (error) {
    console.error('Notify status update error:', error);
  }
}

// Notify driver about new assignment (in-app + push with sound)
async function notifyDriverAssignment(driverId, parcelId) {
  try {
    const userId = driverId; // driverId is now the primary identity ID for drivers

    const parcelResult = await pool.query(
      'SELECT tracking_id FROM parcels WHERE id = $1',
      [parcelId]
    );
    if (parcelResult.rows.length === 0) return;
    const trackingId = parcelResult.rows[0].tracking_id;

    const title = 'New delivery assigned';
    const message = `You have been assigned parcel ${trackingId}`;

    await createNotification(userId, parcelId, 'assignment', title, message);
    await sendPushToUser(userId, title, message, {
      type: 'assignment',
      parcelId,
      trackingId,
    });
  } catch (error) {
    console.error('Notify driver assignment error:', error);
  }
}

// Notify driver when customer submits a review (in-app + push with sound)
async function notifyDriverReview(driverId, parcelId, rating, reviewComment) {
  try {
    const userId = driverId; // driverId is now the primary identity ID for drivers

    const parcelResult = await pool.query(
      'SELECT tracking_id FROM parcels WHERE id = $1',
      [parcelId]
    );
    const trackingId = parcelResult.rows.length > 0 ? parcelResult.rows[0].tracking_id : '';

    const title = 'New review';
    const message = reviewComment
      ? `You received ${rating} star(s): "${reviewComment.slice(0, 60)}${reviewComment.length > 60 ? '…' : ''}"`
      : `You received ${rating} star(s) for delivery ${trackingId}`;

    await createNotification(userId, parcelId, 'review', title, message);
    await sendPushToUser(userId, title, message, {
      type: 'review',
      parcelId,
      trackingId,
      rating: String(rating),
    });
  } catch (error) {
    console.error('Notify driver review error:', error);
  }
}

// Notify all drivers who have push tokens that a new parcel is available to claim
async function notifyDriversNewParcelAvailable(parcelId, trackingId) {
  try {
    const parcelResult = await pool.query(
      'SELECT pickup_state FROM parcels WHERE id = $1',
      [parcelId]
    );
    if (parcelResult.rows.length === 0) return;
    const state = parcelResult.rows[0].pickup_state;

    let query = `
      SELECT DISTINCT d.id as account_id
      FROM drivers d
      INNER JOIN user_push_tokens t ON t.user_id = d.id
      WHERE d.status = 'available'
    `;
    let params = [];

    if (state) {
      query += ' AND LOWER(d.state) = LOWER($1)';
      params = [state];
    }

    const result = await pool.query(query, params);
    
    const title = 'New order available';
    const message = `New parcel ${trackingId} is available in your area`;
    
    for (const row of result.rows) {
      await createNotification(row.account_id, parcelId, 'new_parcel_available', title, message);
      await sendPushToUser(row.account_id, title, message, {
        type: 'new_parcel_available',
        parcelId,
        trackingId,
      });
    }
  } catch (error) {
    console.error('Notify drivers new parcel error:', error);
  }
}

module.exports = {
  sendPushNotification,
  createNotification,
  notifyStatusUpdate,
  notifyDriverAssignment,
  notifyDriverReview,
  notifyDriversNewParcelAvailable,
  getPushTokensForUser,
};
