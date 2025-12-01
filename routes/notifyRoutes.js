const express = require("express");
const router = express.Router();
const {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} = require("../controllers/notificationController");

// GET all notifications for user
router.get("/", getNotifications);

// Mark one as read
router.put("/:id/read", markNotificationRead);

// Mark all read
router.put("/mark-all/read", markAllNotificationsRead);

// Delete
router.delete("/:id", deleteNotification);

module.exports = router;
