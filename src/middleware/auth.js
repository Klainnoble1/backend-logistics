const { getAuth, clerkClient } = require('@clerk/express');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const CLERK_MANAGED_PASSWORD = 'clerk_managed';

const authenticate = async (req, res, next) => {
  try {
    // 1. Try Custom JWT (for local admin/users)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded) {
          req.user = decoded;
          return next();
        }
      } catch (err) {
        // Not a valid custom JWT, continue to Clerk
      }
    }

    // 2. Try Clerk
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const headerRole = req.get('x-app-role');
    const requestedRole = headerRole === 'driver' ? 'driver' : headerRole === 'partner' ? 'partner' : 'customer';
    const table = requestedRole === 'driver' ? 'drivers' : requestedRole === 'partner' ? 'partners' : 'users';
    const columns = `id, email, phone, full_name, ${requestedRole === 'customer' ? 'role,' : ''} is_active`;

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
      const partnerAccountType =
        clerkUser.publicMetadata.accountType === 'business_owner' ||
        clerkUser.unsafeMetadata?.accountType === 'business_owner'
          ? 'business_owner'
          : 'partner';
      const partnerBusinessName =
        clerkUser.publicMetadata.businessName ||
        clerkUser.unsafeMetadata?.businessName ||
        null;
      const partnerPhone =
        clerkUser.publicMetadata.phone ||
        clerkUser.unsafeMetadata?.phone ||
        null;
      const syncTable = role === 'driver' ? 'drivers' : role === 'partner' ? 'partners' : 'users';
      const syncColumns = `id, email, phone, full_name, ${role === 'customer' ? 'role,' : ''} is_active`;

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
        } else if (role === 'partner') {
          const userResult = await pool.query(
            `INSERT INTO users (email, full_name, password_hash, role, is_active, clerk_id, profile_pic)
             VALUES ($1, $2, $3, 'partner', true, $4, $5)
             ON CONFLICT (email) DO UPDATE
               SET role = 'partner',
                   clerk_id = COALESCE(users.clerk_id, EXCLUDED.clerk_id),
                   full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), users.full_name),
                   profile_pic = COALESCE(EXCLUDED.profile_pic, users.profile_pic),
                   updated_at = CURRENT_TIMESTAMP
             RETURNING id`,
            [email, fullName, CLERK_MANAGED_PASSWORD, userId, clerkUser.imageUrl || null]
          );

          result = await pool.query(
            `INSERT INTO partners (id, email, phone, full_name, business_name, account_type, password_hash, is_active, clerk_id, profile_pic)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)
             ON CONFLICT (email) DO UPDATE
               SET clerk_id = COALESCE(partners.clerk_id, EXCLUDED.clerk_id),
                   phone = COALESCE(EXCLUDED.phone, partners.phone),
                   full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), partners.full_name),
                   business_name = COALESCE(EXCLUDED.business_name, partners.business_name),
                   account_type = EXCLUDED.account_type,
                   profile_pic = COALESCE(EXCLUDED.profile_pic, partners.profile_pic),
                   updated_at = CURRENT_TIMESTAMP
             RETURNING ${syncColumns}`,
            [
              userResult.rows[0].id,
              email,
              partnerPhone,
              fullName,
              partnerBusinessName,
              partnerAccountType,
              CLERK_MANAGED_PASSWORD,
              userId,
              clerkUser.imageUrl || null,
            ]
          );
          if (result.rows[0]?.id !== userResult.rows[0].id) {
            await pool.query(
              `INSERT INTO users (id, email, full_name, password_hash, role, is_active, clerk_id, profile_pic)
               VALUES ($1, $2, $3, $4, 'partner', true, $5, $6)
               ON CONFLICT (email) DO UPDATE
                 SET role = 'partner',
                     clerk_id = COALESCE(users.clerk_id, EXCLUDED.clerk_id),
                     full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), users.full_name),
                     profile_pic = COALESCE(EXCLUDED.profile_pic, users.profile_pic),
                     updated_at = CURRENT_TIMESTAMP`,
              [result.rows[0].id, email, fullName, CLERK_MANAGED_PASSWORD, userId, clerkUser.imageUrl || null]
            );
          }
        } else {
          result = await pool.query(
            `INSERT INTO users (email, full_name, password_hash, role, is_active, clerk_id, profile_pic)
             VALUES ($1, $2, $3, $4, true, $5, $6)
             RETURNING ${syncColumns}`,
            [email, fullName, CLERK_MANAGED_PASSWORD, role, userId, clerkUser.imageUrl || null]
          );
        }
      }

      if (role === 'partner' && result.rows[0]) {
        await pool.query(
          `UPDATE partners
           SET account_type = $2,
               business_name = COALESCE($3, business_name),
               phone = COALESCE($4, phone),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [result.rows[0].id, partnerAccountType, partnerBusinessName, partnerPhone]
        );
      }

      localUser = result.rows[0];
    }

    if (!localUser.is_active) {
      return res.status(401).json({ error: 'Account is inactive' });
    }

    if (requestedRole === 'partner') {
      await pool.query(
        `INSERT INTO users (id, email, full_name, password_hash, role, is_active, clerk_id)
         VALUES ($1, $2, $3, $4, 'partner', true, $5)
         ON CONFLICT (id) DO UPDATE
           SET role = 'partner',
               clerk_id = COALESCE(users.clerk_id, EXCLUDED.clerk_id),
               full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), users.full_name),
               updated_at = CURRENT_TIMESTAMP`,
        [localUser.id, localUser.email, localUser.full_name, CLERK_MANAGED_PASSWORD, userId]
      );
    }

    req.user = {
      id: localUser.id,
      clerkId: userId,
      email: localUser.email,
      role: localUser.role || requestedRole,
      accountType: localUser.role === 'admin' ? 'admin' : (table === 'drivers' ? 'driver' : table === 'partners' ? 'partner' : 'user')
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
