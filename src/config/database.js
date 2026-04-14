const { Pool } = require('pg');
require('dotenv').config();

let poolConfig;

if (process.env.DATABASE_URL) {
  try {
    // Force allow self-signed certs globally for this process if it's failing at the pool level
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    // Strip sslmode=require if it exists as it can override the pg-pool ssl setting
    let connectionString = process.env.DATABASE_URL;
    if (connectionString.includes('sslmode=require')) {
      connectionString = connectionString.replace(/[\?&]sslmode=require/, '');
    }

    poolConfig = {
      connectionString: connectionString,
      ssl: { 
        rejectUnauthorized: false 
      },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
    };
  } catch (e) {
    console.warn('Invalid DATABASE_URL:', e.message);
  }
}
if (!poolConfig) {
  poolConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { 
      rejectUnauthorized: false 
    },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
  };
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) console.error('Database connection error:', err);
  else if (res) console.log('Database connected at', res.rows[0].now);
});

module.exports = pool;

