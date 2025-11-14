const db = require('../db');

// @desc    Get all categories
// @route   GET /api/categories
// @access  Public
const getAllCategories = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM categories ORDER BY name');
    res.status(200).json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error, unable to fetch categories' });
  }
};

// @desc    Get all products in a specific category
// @route   GET /api/categories/:id/products
// @access  Public
const getProductsByCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;

    // Check if category exists
    const categoryRes = await db.query('SELECT * FROM categories WHERE id = $1', [categoryId]);
    if (categoryRes.rows.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }

    // Get products in this category
    const productsRes = await db.query(
      'SELECT * FROM products WHERE category_id = $1 ORDER BY name',
      [categoryId]
    );

    res.status(200).json(productsRes.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error, unable to fetch products' });
  }
};

module.exports = {
  getAllCategories,
  getProductsByCategory
};