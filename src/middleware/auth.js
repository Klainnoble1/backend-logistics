const { getAuth, clerkClient } = require('@clerk/express');
const pool = require('../config/database');

const CLERK_MANAGED_PASSWORD = 'clerk_managed';

const authenticate = async (req, res, next) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const requestedRole = req.get('x-app-role') === 'driver' ? 'driver' : 'customer';
    const table = requestedRole === 'driver' ? 'drivers' : 'users';
    const columns = `id, email, phone, full_name, ${requestedRole !== 'driver' ? 'role,' : ''} is_active`;

    // 1. Check if user already exists locally by clerk_id
    let result = await pool.query(
      `SELECT ${columns} FROM ${table} WHERE clerk_id = $1`,
      [userId]
    );

    let localUser = result.rows[0];

    // 2. If not found locally, fetch from Clerk and sync
    if (!localUser) {
      const clerkUser = await clerkClient.users.getUser(userId);
      const email = clerkUser.primaryEmailAddress?.emailAddress || clerkUser.emailAddresses[0]?.emailAddress;
      const fullName =
        `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() ||
        email ||
        'Clerk User';
      
      const role = clerkUser.publicMetadata.role || requestedRole;
      const syncTable = role === 'driver' ? 'drivers' : 'users';
      const syncColumns = `id, email, phone, full_name, ${role !== 'driver' ? 'role,' : ''} is_active`;

      // Try search by email to link
      if (email) {
        result = await pool.query(
          `SELECT ${syncColumns} FROM ${syncTable} WHERE email = $1`,
          [email]
        );

        if (result.rows.length > 0) {
          const existing = result.rows[0];
          result = await pool.query(
            `UPDATE ${syncTable}
             SET clerk_id = $1,
                 full_name = COALESCE(NULLIF($2, ''), full_name),
                 profile_pic = COALESCE($3, profile_pic),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $4
             RETURNING ${syncColumns}`,
            [userId, fullName, clerkUser.imageUrl || null, existing.id]
          );
        }
      }

      if (result.rows.length === 0) {
        if (role === 'driver') {
          result = await pool.query(
            `INSERT INTO drivers (email, full_name, password_hash, is_active, clerk_id, profile_pic, status)
             VALUES ($1, $2, $3, true, $4, $5, 'offline')
             RETURNING ${syncColumns}`,
            [email, fullName, CLERK_MANAGED_PASSWORD, userId, clerkUser.imageUrl || null]
          );
        } else {
          result = await pool.query(
            `INSERT INTO users (email, full_name, password_hash, role, is_active, clerk_id, profile_pic)
             VALUES ($1, $2, $3, $4, true, $5, $6)
             RETURNING ${syncColumns}`,
            [email, fullName, CLERK_MANAGED_PASSWORD, role, userId, clerkUser.imageUrl || null]
          );
        }
      }
      localUser = result.rows[0];
    }

    if (!localUser.is_active) {
      return res.status(401).json({ error: 'Account is inactive' });
    }

    req.user = {
      id: localUser.id,
      clerkId: userId,
      email: localUser.email,
      role: localUser.role || (requestedRole === 'driver' ? 'driver' : 'customer'),
      accountType: localUser.role === 'admin' ? 'admin' : (table === 'drivers' ? 'driver' : 'user')
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
