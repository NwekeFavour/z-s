const express = require("express");
const router = express.Router();
const {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  deleteAllNotifications,
} = require("../controllers/notificationController");
const { protect } = require("../middleware/authMiddleware");

// GET all notifications for user
router.get("/", getNotifications);
router.delete('/clear-all', protect, deleteAllNotifications);

// Mark one as read
router.put("/:id/read", markNotificationRead);

// Mark all read
router.put("/mark-all", markAllNotificationsRead);

// Delete
router.delete("/:id", deleteNotification);

module.exports = router;
