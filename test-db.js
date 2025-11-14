const db = require('./db');

(async () => {
  try {
    const res = await db.query('SELECT NOW()');
    console.log('Connected at:', res.rows[0].now);
    process.exit();
  } catch (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
})();
      