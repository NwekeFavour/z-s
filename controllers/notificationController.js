const db = require('../db');

// ------------------------------------------------------
// Create new notification
// ------------------------------------------------------
// notificationsController.js
exports.createNotification = async ({ user_id, title, message, type, data, triggeredBy }) => {
  try {
    // Skip if stock type and stock >= 5
    if (type === "stock" && data?.stock >= 5) {
      return null; // no notification needed
    }

    const jsonData = JSON.stringify(data || {});

    // Prevent duplicate for stock
    if (type === "stock") {
      const productId = data?.id;
      const existing = await db.query(
        `SELECT id FROM notifications
         WHERE type = 'stock' AND data->>'id' = $1 AND read = false
         LIMIT 1`,
        [String(productId)]
      );
      if (existing.rows.length > 0) return existing.rows[0];
    }

    // Prevent duplicate for order
    if (type === "order") {
      const orderId = data?.id;
      const existing = await db.query(
        `SELECT id FROM notifications
         WHERE type = 'order' AND data->>'id' = $1 AND read = false
         LIMIT 1`,
        [String(orderId)]
      );
      if (existing.rows.length > 0) return existing.rows[0];
    }

    const { rows } = await db.query(
      `INSERT INTO notifications 
       (user_id, title, message, type, data, triggered_by, read, created_at) 
       VALUES ($1,$2,$3,$4,$5,$6,false,NOW()) 
       RETURNING *`,
      [user_id, title, message, type, jsonData, triggeredBy || "System"]
    );

    return rows[0];

  } catch (err) {
    console.error("Error creating notification:", err.message);
    throw err;
  }
};




// ------------------------------------------------------
// Get notifications (admin sees global + personal)
// ------------------------------------------------------
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user?.id || null;

    const result = await db.query(
      `
      SELECT n.*, u.name AS triggered_by
      FROM notifications n
      LEFT JOIN users u ON n.user_triggered_id = u.id
      WHERE n.user_id = $1 OR n.user_id IS NULL
      ORDER BY n.created_at DESC
      `,
      [userId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch notifications" });
  }
};

// ------------------------------------------------------
// Mark a single notification as read
// ------------------------------------------------------
exports.markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      `
      UPDATE notifications
      SET read = TRUE, updated_at = NOW()
      WHERE id = $1
      `,
      [id]
    );

    return res.json({ success: true, message: "Notification marked as read" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ------------------------------------------------------
// Mark all notifications as read
// ------------------------------------------------------
// Instead of using an ID parameter
exports.markAllNotificationsRead = async (req, res) => {
  try {
    await db.query("UPDATE notifications SET read = true");
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};


// ------------------------------------------------------
// Delete a notification
// ------------------------------------------------------
exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(`DELETE FROM notifications WHERE id = $1`, [id]);

    return res.json({ success: true, message: "Notification deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
