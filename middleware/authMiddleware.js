const jwt = require('jsonwebtoken');
const db = require('../db'); // your PostgreSQL db connection

exports.protect = async (req, res, next) => {
  let token;

  // Check for token in Authorization header
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Extract token
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Fetch user from PostgreSQL, exclude password
      const query = 'SELECT id, name, email, is_admin FROM users WHERE id = $1';
      const { rows } = await db.query(query, [decoded.id]);

      if (rows.length === 0) {
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }

      req.user = rows[0]; // attach user info to req
      next();
    } catch (error) {
      console.error('Token verification failed:', error);
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  // If no token was provided
  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};
