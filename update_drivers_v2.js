const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/routes/drivers.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update GET /me response
content = content.replace(
  /license_number, vehicle_type, vehicle_plate, u\.full_name/g,
  'state, license_number, vehicle_type, vehicle_plate, u.full_name'
);

content = content.replace(
  /status: row\.status,/g,
  'status: row.status,\n        state: row.state,'
);

// 2. Update GET /me/available-parcels
const newAvailableParcels = `router.get('/me/available-parcels', authorize('driver'), async (req, res) => {
  try {
    // Get driver operating state
    const driverResult = await pool.query(
      'SELECT state FROM drivers WHERE user_id = $1',
      [req.user.id]
    );

    if (driverResult.rows.length === 0) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    const driverState = driverResult.rows[0].state;

    if (!driverState) {
      return res.json({ 
        parcels: [], 
        message: 'Please set your operating state in your profile to see available parcels.' 
      });
    }

    const result = await pool.query(
      \`SELECT p.id, p.tracking_id, p.recipient_name, p.recipient_phone,
              p.pickup_address, p.delivery_address, p.parcel_type, p.weight,
              p.service_type, p.status, p.price, p.estimated_delivery_date,
              p.created_at, u.full_name as sender_name
       FROM parcels p
       INNER JOIN users u ON p.sender_id = u.id
       WHERE p.status = 'created'
         AND p.pickup_state = $1
         AND EXISTS (
           SELECT 1
           FROM payments pay
           WHERE pay.parcel_id = p.id
             AND pay.payment_status = 'completed'
         )
         AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.parcel_id = p.id)
       ORDER BY p.created_at DESC\`,
      [driverState]
    );`;

content = content.replace(/router\.get\('\/me\/available-parcels', authorize\('driver'\), async \(req, res\) => \{[\s\S]*?const result = await pool\.query\([\s\S]*?`SELECT[\s\S]*?ORDER BY p\.created_at DESC`[\s\S]*?\);/g, newAvailableParcels);

// 3. Update PUT /me/profile
content = content.replace(
  /body\('vehiclePlate'\)\.optional\(\)\.trim\(\)/g,
  "body('vehiclePlate').optional().trim(),\n  body('state').optional().trim()"
);

content = content.replace(
  /const \{ licenseNumber, vehicleType, vehiclePlate \} = req\.body;/g,
  'const { licenseNumber, vehicleType, vehiclePlate, state } = req.body;'
);

content = content.replace(
  /if \(vehiclePlate !== undefined\) \{[\s\S]*?values\.push\(vehiclePlate\);[\s\S]*?\}/g,
  `if (vehiclePlate !== undefined) {
      updates.push(\`vehicle_plate = \$\${paramCount++}\`);
      values.push(vehiclePlate);
    }
    if (state !== undefined) {
      updates.push(\`state = \$\${paramCount++}\`);
      values.push(state);
    }`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('drivers.js updated successfully');
process.exit(0);
