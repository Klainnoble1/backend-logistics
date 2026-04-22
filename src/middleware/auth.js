const { getAuth, clerkClient } = require('@clerk/express');
const pool = require('../config/database');

const authenticate = async (req, res, next) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // 1. Get user details from Clerk
    const clerkUser = await clerkClient.users.getUser(userId);
    const email = clerkUser.emailAddresses[0]?.emailAddress;
    const fullName = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim();
    const role = clerkUser.publicMetadata.role || 'customer'; // Default to customer
    const table = role === 'driver' ? 'drivers' : 'users';

    // 2. Sync with local database
    let result = await pool.query(
      `SELECT id, email, ${role !== 'driver' ? 'role,' : ''} is_active FROM ${table} WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // Create local record if missing
      if (role === 'driver') {
        result = await pool.query(
          'INSERT INTO drivers (id, email, full_name, is_active) VALUES ($1, $2, $3, true) RETURNING id, email, is_active',
          [userId, email, fullName]
        );
      } else {
        result = await pool.query(
          'INSERT INTO users (id, email, full_name, role, is_active) VALUES ($1, $2, $3, $4, true) RETURNING id, email, role, is_active',
          [userId, email, fullName, role]
        );
      }
    }

    const localUser = result.rows[0];
    if (!localUser.is_active) {
      return res.status(401).json({ error: 'Account is inactive' });
    }

    req.user = {
      id: localUser.id,
      email: localUser.email,
      role: role === 'driver' ? 'driver' : localUser.role,
      accountType: role === 'driver' ? 'driver' : 'user'
    };

    next();
  } catch (error) {
    console.error('Clerk Auth Error:', error);
    res.status(401).json({ error: 'Authentication failed', message: error.message });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

module.exports = { authenticate, authorize };


