const db = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const sendEmail = require('../utils/sendEmail');

// =========================
// Helper: Generate JWT
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// =========================
// Register a new user
exports.registerUser = async (req, res) => {
  try {
    const { name, email, password, isAdmin = false } = req.body;

    // Check if user exists
    const userExists = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) return res.status(400).json({ message: 'User already exists' });

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const { rows } = await db.query(
      'INSERT INTO users (name, email, password, is_admin, created_at, updated_at) VALUES ($1,$2,$3,$4,NOW(),NOW()) RETURNING id,name,email,is_admin',
      [name, email, hashedPassword, isAdmin]
    );

    const user = rows[0];
    res.status(201).json({
      _id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.is_admin,
      message: 'User Successfully Registered',
      token: generateToken(user.id)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// =========================
// Login user
exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);

    if (rows.length === 0) return res.status(401).json({ message: 'Invalid credentials' });

    const user = rows[0];

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) return res.status(401).json({ message: 'Invalid credentials' });

    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.is_admin,
      token: generateToken(user.id),
      message: 'User successfully logged in'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// =========================
// Logout user
// @route   POST /api/users/logout
// @access  Private
exports.logoutUser = async (req, res) => {
  // With JWT, logout is client-side (delete token)
  // Optionally, you could implement token blacklist in DB if you want server-side invalidation
  res.status(200).json({ message: 'User logged out successfully' });
};

// =========================
// Forgot password
// @route   POST /api/users/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Find user
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });

    const user = rows[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(20).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expire = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save token and expiry in DB
    await db.query(
      'UPDATE users SET reset_password_token = $1, reset_password_expire = $2 WHERE id = $3',
      [hashedToken, expire, user.id]
    );

    // Construct reset URL
    const resetUrl = `${req.protocol}://${req.get('host')}/api/users/reset-password/${resetToken}`;
    const message = `You requested a password reset. PUT request to: \n\n ${resetUrl} \nIf you did not request this, ignore this email.`;

    // Send email
    try {
      await sendEmail({
        email: user.email,
        subject: 'Password Reset Request',
        message
      });

      res.status(200).json({ message: 'Reset link sent to email' });
    } catch (err) {
      // On failure, clear token
      await db.query(
        'UPDATE users SET reset_password_token = NULL, reset_password_expire = NULL WHERE id = $1',
        [user.id]
      );
      return res.status(500).json({ message: 'Email could not be sent' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// =========================
// Reset password
// @route   PUT /api/users/reset-password/:resetToken
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const { resetToken } = req.params;
    const { password } = req.body;

    if (!password) return res.status(400).json({ message: 'Password is required' });

    // Hash token
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Find user with matching token and not expired
    const { rows } = await db.query(
      'SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expire > NOW()',
      [hashedToken]
    );

    if (rows.length === 0) return res.status(400).json({ message: 'Invalid or expired token' });

    const user = rows[0];

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password and clear reset token
    await db.query(
      'UPDATE users SET password = $1, reset_password_token = NULL, reset_password_expire = NULL, updated_at = NOW() WHERE id = $2',
      [hashedPassword, user.id]
    );

    res.status(200).json({ message: 'Password reset successful' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};


// =========================
// Get user profile
exports.getUserProfile = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, name, email, is_admin FROM users WHERE id = $1', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// =========================
// Update user profile
exports.updateUserProfile = async (req, res) => {
  try {
    const { name, email, password, isAdmin } = req.body;

    // If password provided, hash it
    const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;

    const query = `
      UPDATE users
      SET name = COALESCE($1,name),
          email = COALESCE($2,email),
          password = COALESCE($3,password),
          is_admin = COALESCE($4,is_admin),
          updated_at = NOW()
      WHERE id = $5
      RETURNING id,name,email,is_admin
    `;
    const params = [name, email, hashedPassword, isAdmin, req.user.id];

    const { rows } = await db.query(query, params);

    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });

    res.json({ ...rows[0], token: generateToken(rows[0].id) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// =========================
// Get all addresses
exports.getUserAddresses = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM addresses WHERE user_id = $1', [req.user.id]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// =========================
// Add a new address
exports.addAddress = async (req, res) => {
  try {
    const { full_name, street, city, state, postal_code, country } = req.body;
    const { rows } = await db.query(
      `INSERT INTO addresses (user_id, full_name, street, city, state, postal_code, country)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, full_name, street, city, state, postal_code, country]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// =========================
// Update an address
exports.updateAddress = async (req, res) => {
  try {
    const { full_name, street, city, state, postal_code, country } = req.body;
    const { rows } = await db.query(
      `UPDATE addresses
       SET full_name = COALESCE($1,full_name),
           street = COALESCE($2,street),
           city = COALESCE($3,city),
           state = COALESCE($4,state),
           postal_code = COALESCE($5,postal_code),
           country = COALESCE($6,country)
       WHERE id = $7 AND user_id = $8
       RETURNING *`,
      [full_name, street, city, state, postal_code, country, req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Address not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// =========================
// Delete an address
exports.deleteAddress = async (req, res) => {
  try {
    const { rows } = await db.query(
      'DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Address not found' });
    res.json({ message: 'Address deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};