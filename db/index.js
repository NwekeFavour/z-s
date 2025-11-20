require('dotenv').config();
const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  
  keepAliveInitialDelayMillis: 10000,
});

// Log unexpected errors
pool.on('error', (err) => {
  console.error('Unexpected pg pool error', err);
});
  
// ---------- RETRY FUNCTION HERE ----------
async function queryWithRetry(text, params, retries = 3) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error("Query failed, retrying...", retries, err.message);

    if (retries === 0) throw err;

    // Wait before retry
    await new Promise(res => setTimeout(res, 500));

    return queryWithRetry(text, params, retries - 1);
  }
}
// -----------------------------------------

module.exports = {
  query: queryWithRetry, // use retry version everywhere
  getClient: () => pool.connect(),
};
