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


exports.sendOTP = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const userExists = await db.query("SELECT id FROM users WHERE email = $1", [email]);
    if (userExists.rows.length > 0)
      return res.status(400).json({ message: "Email already registered" });

    await db.query("DELETE FROM pending_users WHERE email = $1", [email]);

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await db.query(
      `INSERT INTO pending_users (name, email, password, otp, otp_expiry)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')`,
      [name, email, hashedPassword, otp]
    );

    // Send OTP via Nodemailer
    await sendEmail({
      from: `"ZandMarket ${process.env.FROM_EMAIL}"`,
      to: email,
      subject: "Verify Your Email",
      html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>OTP Verification</title>
      </head>
      <body style="margin:0; padding:0; font-family: Arial, sans-serif; background-color: #f5f7fa;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f7fa; margin:0; padding:40px 0;">
          <tr>
            <td align="center" valign="top">
              <table width="420" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 18px rgba(0,0,0,0.08); margin:0;">
                
                <!-- Top Banner -->
                <tr>
                  <td style="background-color: #02489b; text-align:center; padding: 25px 20px; color:white; font-size:22px; font-weight:bold;">
                    ZandMarket
                  </td>
                </tr>

                <!-- Greeting & OTP -->
                <tr>
                  <td style="padding: 30px 25px; text-align:center;">
                    <h2 style="margin: 0 0 10px; color:#02489b;">Hello ${name},</h2>
                    <p style="margin:0 0 25px; font-size:16px; color:#333;">Use the following OTP to complete your registration:</p>
                    <div style="display:inline-block; background-color:#02489b; color:white; font-size:28px; font-weight:bold; padding:15px 35px; border-radius:8px; letter-spacing:3px;">
                      ${otp}
                    </div>
                    <p style="margin:25px 0 0; font-size:14px; color:#555;">This OTP is valid for 10 minutes only.</p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color:#f1f3f6; text-align:center; padding:20px; font-size:12px; color:#777;">
                    © ${new Date().getFullYear()} ZandMarket. All rights reserved.
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
      `

    });


    res.json({ message: "OTP sent to email.", otp });
  } catch (err) {
    console.error("Nodemailer error:", err);
    res.status(500).json({ message: "Failed to send OTP" });
  }
};


// =========================
// Register a new user
exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    // 1️⃣ Check for OTP + Email in pending table
    const result = await db.query(
      "SELECT * FROM pending_users WHERE email = $1 AND otp = $2",
      [email, otp]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    const pendingUser = result.rows[0];

    // 2️⃣ Check expiry
    if (new Date() > pendingUser.otp_expiry) {
      return res.status(400).json({ message: "OTP expired" });
    }

    // 3️⃣ Make sure user does NOT already exist in real users table
    const existingUser = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      // Clean up pending user
      await db.query("DELETE FROM pending_users WHERE email = $1", [email]);
      return res.status(400).json({ message: "You cannot register with this email, it already exists." });
    }

    // 4️⃣ Create actual user
    const inserted = await db.query(
      `INSERT INTO users (name, email, password, is_admin, created_at, updated_at)
       VALUES ($1, $2, $3, false, NOW(), NOW())
       RETURNING id, name, email, is_admin`,
      [pendingUser.name, pendingUser.email, pendingUser.password]
    );

    // 5️⃣ Remove it from pending table
    await db.query("DELETE FROM pending_users WHERE email = $1", [email]);

    res.status(201).json({
      user: inserted.rows[0],
      message: "Email verified successfully",
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Verification failed" });
  }
};


exports.getShippingFee = async (req, res) => {
  try {
    // Fetch shipping_fee from the first user (adjust logic if needed)
    const { rows } = await db.query("SELECT shipping_fee FROM users LIMIT 1");
    res.json({ shipping_fee: rows[0]?.shipping_fee || 0 });
  } catch (err) {
    console.error("Fetch shipping fee error:", err);
    res.status(500).json({ error: "Failed to fetch shipping fee" });
  }
};

exports.updateShippingFee = async (req, res) => {
  try {
    const userId = req.user.id
    const { shipping_fee } = req.body;

    if (shipping_fee === undefined) {
      return res.status(400).json({ message: "Shipping fee is required" });
    }

    const result = await db.query(
      `UPDATE users 
       SET shipping_fee = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, name, email, shipping_fee`,
      [shipping_fee, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "Shipping fee updated successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Shipping fee update error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};





exports.getUnreadNotifications = async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await db.query(
      `SELECT *
       FROM notifications
       WHERE user_id = $1 AND is_read = FALSE
       ORDER BY created_at DESC`,
      [user_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
};


exports.markNotificationsRead = async (req, res) => {
  try {
    const { user_id } = req.params;

    await db.query(
      `UPDATE notifications
       SET is_read = TRUE, updated_at = NOW()
       WHERE user_id = $1 AND is_read = FALSE`,
      [user_id]
    );

    res.json({ message: "Notifications marked as read" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update notifications" });
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

    const { rows } = await db.query(
      'SELECT * FROM users WHERE email = $1',  
      [email]
    );

    if (rows.length === 0)
      return res.status(404).json({ message: 'User not found' });

    const user = rows[0];

    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    const expire = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    await db.query(
      'UPDATE users SET reset_password_token=$1, reset_password_expire=$2 WHERE id=$3',
      [hashedToken, expire, user.id]
    );

    // FRONTEND URL (THIS IS THE FIX)
    const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password/${resetToken}`;



    await sendEmail({
      from: "ZandMarket foodstuffs@zandmarket.co.uk",
      to: user.email,
      subject: 'Password Reset Request',
      html: `
      <div padding:40px 0;font-family:Arial,Helvetica,sans-serif;">
        <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
          
          <div style="background:#02498b;padding:24px;text-align:center;color:white;">
            <h1 style="margin:0;font-size:24px;font-weight:600;">Password Reset Request</h1>
          </div>

          <div style="padding:32px;">
            <p style="font-size:16px;color:#333;">
              Hello, you recently requested to reset your password. Click the button below to proceed:
            </p>

            <div style="text-align:center;margin:30px 0;">
              <a href="${resetUrl}"
                style="
                  background:#02498b;
                  padding:14px 26px;
                  color:white;
                  text-decoration:none;
                  border-radius:8px;
                  font-size:16px;
                  font-weight:600;
                  display:inline-block;
                "
              >
                Reset Password
              </a>
            </div>

            <p style="font-size:15px;color:#555;">
              If the button above doesn't work, copy and paste this link into your browser:
            </p>

            <p style="word-break:break-all;color:#02498b;font-size:14px;margin-top:10px;">
              ${resetUrl}
            </p>

            <p style="font-size:14px;color:#999;margin-top:30px;">
              If you didn’t request this password reset, you can safely ignore this email.
            </p>
          </div>

          <div style="background:#f9fafb;padding:18px;text-align:center;color:#777;font-size:13px;">
            © ${new Date().getFullYear()} ZandMarket. All rights reserved.
          </div>

        </div>
      </div>
    `,
    });

    res.status(200).json({ message: 'Reset link sent to email' });
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
    const { token } = req.params;   // <--- changed from resetToken
    const { password } = req.body;

    if (!password) return res.status(400).json({ message: 'Password is required' });

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const { rows } = await db.query(
      'SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expire > NOW()',
      [hashedToken]
    );

    if (rows.length === 0)
      return res.status(400).json({ message: 'Invalid or expired token' });

    const user = rows[0];

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      `UPDATE users 
       SET password = $1, reset_password_token = NULL, reset_password_expire = NULL, updated_at = NOW()
       WHERE id = $2`,
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
    const { name, email, password } = req.body;

    // Hash password only if provided
    const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;

    const query = `
      UPDATE users
      SET name = COALESCE($1,name),
          email = COALESCE($2,email),
          password = COALESCE($3,password),
          updated_at = NOW()
      WHERE id = $4
      RETURNING id, name, email
    `;
    const params = [name, email, hashedPassword, req.user.id];

    const { rows } = await db.query(query, params);

    if (rows.length === 0)
      return res.status(404).json({ message: 'User not found' });

    // Return updated user (you can generate new token if you want)
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
    const { rows } = await db.query(
      'SELECT * FROM addresses WHERE user_id = $1 ORDER BY id DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// =========================
// Add a new UK-style address
// =========================
// Add a new address
exports.addAddress = async (req, res) => {
  try {
    const {
      full_name,
      address_line1,
      city,
      postcode,
      country = "United Kingdom",
      phone_number
    } = req.body;

    const { rows } = await db.query(
      `INSERT INTO addresses 
        (user_id, full_name, phone_number, address_line1, city, postcode, country)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.user.id,
        full_name,
        phone_number,
        address_line1,
        city,
        postcode,
        country
      ]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};


// =========================
// Update address
// =========================
// Update an address
exports.updateAddress = async (req, res) => {
  try {
    const {
      full_name,
      address_line1,
      city,
      postcode,
      country,
      phone_number
    } = req.body;

    const { rows } = await db.query(
      `UPDATE addresses
       SET 
        full_name = COALESCE($1, full_name),
        address_line1 = COALESCE($2, address_line1),
        city = COALESCE($3, city),
        postcode = COALESCE($4, postcode),
        country = COALESCE($5, country),
        phone_number = COALESCE($6, phone_number)
       WHERE id = $7 AND user_id = $8
       RETURNING *`,
      [
        full_name,
        address_line1,
        city,
        postcode,
        country,
        phone_number,
        req.params.id,
        req.user.id
      ]
    );

    if (rows.length === 0) 
      return res.status(404).json({ message: "Address not found" });

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};


// =========================
// Delete address
exports.deleteAddress = async (req, res) => {
  try {
    const { rows } = await db.query(
      'DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.id]
    );

    if (rows.length === 0)
      return res.status(404).json({ message: "Address not found" });

    res.json({ message: "Address deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};
