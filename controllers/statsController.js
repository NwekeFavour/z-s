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
exports.getCustomersCount = async (req, res) => {
  try {
    // 1. Get latest 10 customers with their order count
    const customers = await db.query(`
      SELECT 
        u.id,
        u.name,
        u.created_at AS joined,
        (
          SELECT COUNT(*) 
          FROM orders o 
          WHERE o.user_id = u.id
        ) AS orders
      FROM users u
      WHERE u.is_admin = false
      ORDER BY u.created_at DESC
      LIMIT 10
    `);

    // 2. Get total number of non-admin customers
    const count = await db.query(`
      SELECT COUNT(*) 
      FROM users 
      WHERE is_admin = false
    `);

    // 3. Send final response
    res.json({
      count: parseInt(count.rows[0].count, 10),
      list: customers.rows,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

exports.getCustomerOrderHistory = async (req, res) => {
  try {
    const { id } = req.params;

    // 1️⃣ Get all orders for the customer, including cart_items
    const orders = await db.query(`
      SELECT 
        o.id,
        o.payment_method,
        o.total_price,
        o.is_paid,
        o.paid_at,
        o.is_shipped,
        o.shipped_at,
        o.is_delivered,
        o.delivered_at,
        o.status,
        o.created_at,
        o.cart_items
      FROM orders o
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC
    `, [id]);

    // 2️⃣ Get all order_items grouped by order_id
    const items = await db.query(`
      SELECT 
        order_id,
        product_id,
        name,
        price,
        quantity,
        image
      FROM order_items
      WHERE order_id IN (
        SELECT id FROM orders WHERE user_id = $1
      )
    `, [id]);

    // 3️⃣ Attach items to their respective orders
    const ordersWithItems = orders.rows.map(order => ({
      ...order,
      // Prefer actual order_items if available, otherwise fall back to cart_items snapshot
      items: items.rows.filter(item => item.order_id === order.id).length > 0
        ? items.rows.filter(item => item.order_id === order.id)
        : order.cart_items || []
    }));

    res.json({
      user_id: id,
      total_orders: orders.rows.length,
      orders: ordersWithItems
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch order history", error: err.message });
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