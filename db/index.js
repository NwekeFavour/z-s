require('dotenv').config();
// db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // optional: max connections, idle timeout
  ssl: {
    rejectUnauthorized: false 
  },
  max: 10,
  idleTimeoutMillis: 30000,
});  
    
pool.on('error', (err) => {
  console.error('Unexpected pg pool error', err);
  process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(), // for transactions
};
