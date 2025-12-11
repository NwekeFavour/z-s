const express = require("express")
const router= express.Router();
const {
    getAllProducts,
    getProductById, 
    searchProducts, 
    createProduct, 
    updateProduct,     
    deleteProduct   
} = require("../controllers/productControllers")
const { protect } = require('../middleware/authMiddleware');
const {adminOnly} = require("../middleware/adminMiddleware");//my vscode was acting crazy on here
const upload = require("../middleware/dinaryMiddleware");

// Public routes (available for all users)
router.get('/', getAllProducts); // List all products
router.get('/search', searchProducts); // Search products by keyword
router.get('/:id', getProductById); // Get a single product by ID

// Admin routes (only accessible to admins)
router.post('/', protect, adminOnly, upload.array("images", 5), createProduct);
router.put('/:id', protect, adminOnly, upload.array("images", 5), updateProduct);
router.delete('/:id', protect, adminOnly, deleteProduct);

  
module.exports = router;
