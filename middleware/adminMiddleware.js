const jwt = require('jsonwebtoken');
const db = require('../db'); // your PostgreSQL db connection

// Admin-only access middleware
const adminOnly = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // attach decoded payload (should contain user id)

    // Fetch user from PostgreSQL
    const query = 'SELECT * FROM users WHERE id = $1';
    const { rows } = await db.query(query, [req.user.id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = rows[0];

    // Check if user is admin
    if (!user.is_admin) {
      return res.status(403).json({ message: 'Not authorized as admin' });
    }

    // All good, continue
    next();
  } catch (err) {
    console.error(err);
    res.status(401).json({ message: 'Token is invalid or expired' });
  }
};

module.exports = { adminOnly };
