const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
  forgotPassword,
  resetPassword,
  getUserAddresses,
  addAddress,
  updateAddress,
  deleteAddress,  
  verifyOTP,
  sendOTP,
  updateShippingFee,
  getShippingFee,
  submitFeedback
} = require('../controllers/userControllers');
const { protect } = require('../middleware/authMiddleware');
const { adminOnly } = require('../middleware/adminMiddleware');

// Registration and Authentication
router.post('/register', verifyOTP);
router.post("/register/send-otp", sendOTP);
router.post('/login', loginUser);
router.post('/logout', protect, logoutUser);

//to check logged in user
router.get('/me', protect, (req, res) => {
  res.json(req.user); // req.user is set by the protect middleware
});
// Password Recovery
router.post('/forgot-password', forgotPassword);
router.put('/reset-password/:token', resetPassword); // (this is for resetting after getting token)

// feedback
router.post('/feedback', protect, submitFeedback);

// Profile
router.get('/profile', protect, getUserProfile);
router.put('/profile', protect, updateUserProfile);
router.get("/shipping-fee", protect, getShippingFee);
router.put("/shipping-fee/:id", protect, adminOnly, updateShippingFee);

// Address Management
router.get('/addresses', protect, getUserAddresses);
router.post('/addresses', protect, addAddress);
router.put('/addresses/:id', protect, updateAddress);
router.delete('/addresses/:id', protect, deleteAddress);
  
module.exports = router;
