const { Pool } = require('pg');
require('dotenv').config();

let poolConfig;
const isServerless = Boolean(process.env.VERCEL);
const maxConnections = Number(process.env.DB_POOL_MAX || (isServerless ? 1 : 3));
const idleTimeoutMillis = Number(process.env.DB_IDLE_TIMEOUT_MS || (isServerless ? 5000 : 30000));
const connectionTimeoutMillis = Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000);

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
      max: maxConnections,
      idleTimeoutMillis,
      connectionTimeoutMillis,
      allowExitOnIdle: isServerless,
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
    max: maxConnections,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    allowExitOnIdle: isServerless,
  };
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

if (process.env.DB_LOG_CONNECTION === 'true') {
  pool.query('SELECT NOW()', (err, res) => {
    if (err) console.error('Database connection error:', err);
    else if (res) console.log('Database connected at', res.rows[0].now);
  });
}

module.exports = pool;
