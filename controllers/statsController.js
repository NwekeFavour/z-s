const db = require('../db');

// =========================
// Get total users count
exports.getUsersCount = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT COUNT(*) FROM users');
    res.json({ count: parseInt(rows[0].count, 10) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// =========================
// Get orders stats
exports.getOrdersStats = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) AS total_orders,
        SUM(total_price) AS total_sales,
        AVG(total_price) AS average_order_value,
        COUNT(*) FILTER (WHERE is_paid = true) AS paid_orders,
        COUNT(*) FILTER (WHERE is_shipped = true) AS shipped_orders,
        COUNT(*) FILTER (WHERE is_delivered = true) AS delivered_orders
      FROM orders
    `);
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

exports.getCategories = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT DISTINCT category FROM products ORDER BY category ASC');
    res.json(rows.map(r => r.category)); // returns array of strings
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// =========================
// Get products stats
exports.getProductsStats = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        COUNT(*) AS total_products,
        SUM(stock) AS total_stock,
        AVG(price) AS average_price
      FROM products
    `);
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// =========================
// Get monthly sales stats
exports.getMonthlySales = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*) AS orders_count,
        SUM(total_price) AS total_sales
      FROM orders
      WHERE is_paid = true
      GROUP BY month
      ORDER BY month ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};