const jwt = require('jsonwebtoken');
const db = require('../db'); // your PostgreSQL db connection

exports.protect = async (req, res, next) => {
  let token;

  // Check for token in Authorization header
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Fetch user including can_leave_feedback column
      const query = `
        SELECT 
          id,
          name,
          email,
          is_admin,
          can_leave_feedback
        FROM users
        WHERE id = $1
      `;
      const { rows } = await db.query(query, [decoded.id]);

      if (!rows.length) {
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }

      req.user = rows[0]; // attach user info to req
      return next();
    } catch (error) {
      console.error('Token verification failed:', error);
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  } else {
    // No token provided
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};