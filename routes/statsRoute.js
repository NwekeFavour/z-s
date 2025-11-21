const express = require('express');
const router = express.Router();
const { getUsersCount, getOrdersStats, getProductsStats, getMonthlySales, getCategories } = require('../controllers/statsController');
const { adminOnly } = require('../middleware/adminMiddleware');
const { protect } = require('../middleware/authMiddleware');

router.get('/users/count', protect, adminOnly, getUsersCount);
router.get('/products/categories', getCategories)
router.get('/orders/stats', protect, adminOnly, getOrdersStats);
router.get('/products/stats', protect, adminOnly, getProductsStats);
router.get('/sales/monthly', protect, adminOnly, getMonthlySales);

module.exports = router;
