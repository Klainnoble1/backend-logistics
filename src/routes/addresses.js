const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(authorize('customer'));

// GET /api/addresses – list saved addresses for current user
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, label, address_line, landmark, city, state, is_default, created_at, updated_at
       FROM customer_addresses
       WHERE user_id = $1
       ORDER BY is_default DESC, created_at DESC`,
      [req.user.id]
    );
    res.json({ addresses: result.rows });
  } catch (error) {
    console.error('Get addresses error:', error);
    res.status(500).json({ error: 'Failed to get addresses' });
  }
});

// POST /api/addresses – create saved address
router.post('/', [
  body('label').trim().notEmpty(),
  body('addressLine').trim().notEmpty(),
  body('landmark').optional().trim(),
  body('city').optional().trim(),
  body('state').optional().trim(),
  body('isDefault').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { label, addressLine, landmark, city, state, isDefault = false } = req.body;

    if (isDefault) {
      await pool.query(
        'UPDATE customer_addresses SET is_default = false WHERE user_id = $1',
        [req.user.id]
      );
    }

    const result = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, address_line, landmark, city, state, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.user.id, label, addressLine, landmark || null, city || null, state || null, isDefault]
    );

    res.status(201).json({ address: result.rows[0] });
  } catch (error) {
    console.error('Create address error:', error);
    res.status(500).json({ error: 'Failed to create address' });
  }
});

// PUT /api/addresses/:id – update saved address
router.put('/:id', [
  body('label').optional().trim().notEmpty(),
  body('addressLine').optional().trim().notEmpty(),
  body('landmark').optional().trim(),
  body('city').optional().trim(),
  body('state').optional().trim(),
  body('isDefault').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { label, addressLine, landmark, city, state, isDefault } = req.body;

    const existing = await pool.query(
      'SELECT id FROM customer_addresses WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Address not found' });
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (label !== undefined) { updates.push(`label = $${paramCount++}`); values.push(label); }
    if (addressLine !== undefined) { updates.push(`address_line = $${paramCount++}`); values.push(addressLine); }
    if (landmark !== undefined) { updates.push(`landmark = $${paramCount++}`); values.push(landmark || null); }
    if (city !== undefined) { updates.push(`city = $${paramCount++}`); values.push(city || null); }
    if (state !== undefined) { updates.push(`state = $${paramCount++}`); values.push(state || null); }
    if (isDefault === true) {
      await pool.query('UPDATE customer_addresses SET is_default = false WHERE user_id = $1', [req.user.id]);
      updates.push(`is_default = true`);
    } else if (isDefault === false) {
      updates.push(`is_default = false`);
    }

    if (updates.length === 0) {
      const row = await pool.query('SELECT * FROM customer_addresses WHERE id = $1', [id]);
      return res.json({ address: row.rows[0] });
    }

    values.push(id, req.user.id);
    const result = await pool.query(
      `UPDATE customer_addresses SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING *`,
      values
    );

    res.json({ address: result.rows[0] });
  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({ error: 'Failed to update address' });
  }
});

// DELETE /api/addresses/:id
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM customer_addresses WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Address not found' });
    }
    res.json({ message: 'Address deleted' });
  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({ error: 'Failed to delete address' });
  }
});

module.exports = router;
