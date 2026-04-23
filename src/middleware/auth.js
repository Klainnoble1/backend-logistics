const { getAuth, clerkClient } = require('@clerk/express');
const pool = require('../config/database');

const CLERK_MANAGED_PASSWORD = 'clerk_managed';

const authenticate = async (req, res, next) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // 1. Get user details from Clerk
    const clerkUser = await clerkClient.users.getUser(userId);
    const email = clerkUser.primaryEmailAddress?.emailAddress || clerkUser.emailAddresses[0]?.emailAddress;
    const fullName =
      `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() ||
      email ||
      'Clerk User';
    const requestedRole = req.get('x-app-role');
    const role =
      clerkUser.publicMetadata.role ||
      (requestedRole === 'driver' ? 'driver' : 'customer');
    const table = role === 'driver' ? 'drivers' : 'users';
    const columns = `id, email, phone, full_name, ${role !== 'driver' ? 'role,' : ''} is_active`;

    // 2. Sync Clerk identity with local UUID account.
    let result = await pool.query(
      `SELECT ${columns} FROM ${table} WHERE clerk_id = $1`,
      [userId]
    );

    if (result.rows.length === 0 && email) {
      result = await pool.query(
        `SELECT ${columns} FROM ${table} WHERE email = $1`,
        [email]
      );

      if (result.rows.length > 0) {
        const existing = result.rows[0];
        result = await pool.query(
          `UPDATE ${table}
           SET clerk_id = $1,
               full_name = COALESCE(NULLIF($2, ''), full_name),
               profile_pic = COALESCE($3, profile_pic),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4
           RETURNING ${columns}`,
          [userId, fullName, clerkUser.imageUrl || null, existing.id]
        );
      }
    }

    if (result.rows.length === 0) {
      // Create local record if missing
      if (role === 'driver') {
        result = await pool.query(
          `INSERT INTO drivers (email, full_name, password_hash, is_active, clerk_id, profile_pic, status)
           VALUES ($1, $2, $3, true, $4, $5, 'offline')
           RETURNING ${columns}`,
          [email, fullName, CLERK_MANAGED_PASSWORD, userId, clerkUser.imageUrl || null]
        );
      } else {
        result = await pool.query(
          `INSERT INTO users (email, full_name, password_hash, role, is_active, clerk_id, profile_pic)
           VALUES ($1, $2, $3, $4, true, $5, $6)
           RETURNING ${columns}`,
          [email, fullName, CLERK_MANAGED_PASSWORD, role, userId, clerkUser.imageUrl || null]
        );
      }
    }

    const localUser = result.rows[0];
    if (!localUser.is_active) {
      return res.status(401).json({ error: 'Account is inactive' });
    }

    req.user = {
      id: localUser.id,
      clerkId: userId,
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


