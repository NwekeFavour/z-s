const express = require('express');
const { createOrder, getOrders, getOrderById, updateOrderStatus, getWishList, addToWishlist, deleteWishlist, clearWishlist } = require('../controllers/orderControllers');
const { protect } = require('../middleware/authMiddleware');
const router = express.Router();

// wishlists routes
router.get('/wishlist', protect, getWishList);
router.post('/wishlist', protect, addToWishlist);
router.delete('/wishlist/clear', protect, clearWishlist);
router.delete('/wishlist/:product_id', protect, deleteWishlist)

// order
router.post('/', protect, createOrder);
router.get('/', protect, getOrders);
router.get('/:id', protect, getOrderById);
router.put('/:id/status', protect, updateOrderStatus);


module.exports = router;