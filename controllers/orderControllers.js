const pool = require('../db');

// CREATE ORDER
exports.createOrder = async (req, res) => {
  const { user_id, payment_method, items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ message: "No order items" });
  }

  // Calculate total price
  const total_price = items.reduce((acc, item) => acc + item.price * item.quantity, 0);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert into orders table
    const orderResult = await client.query(
      `INSERT INTO orders (user_id, payment_method, total_price)
       VALUES ($1, $2, $3) RETURNING *`,
      [user_id, payment_method, total_price]
    );
    const order = orderResult.rows[0];

    // Insert into order_items
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, name, price, quantity, image)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.product_id, item.name, item.price, item.quantity, item.image]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({ order_id: order.id, total_price });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: "Failed to create order", error: err.message });
  } finally {
    client.release();
  }
};

// GET ALL ORDERS
exports.getOrders = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch orders" });
  }
};

// GET ORDER BY ID (with items)
exports.getOrderById = async (req, res) => {
  const { id } = req.params;
  try {
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ message: "Order not found" });

    const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [id]);
    order.items = itemsResult.rows;

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch order" });
  }
};

// UPDATE ORDER STATUS
exports.updateOrderStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatus = ['processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatus.includes(status)) return res.status(400).json({ message: "Invalid status" });

  try {
    const result = await pool.query(
      `UPDATE orders
       SET status = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: "Order not found" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update order" });
  }
};


// Get current user's wishlist
exports.getWishList = async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch only wishlist items that actually exist for the user
    const wishlistRes = await pool.query(
      `SELECT wi.id AS item_id,
              wi.quantity,
              p.id AS product_id,
              p.name,
              p.price,
              p.discount_percentage,
              p.stock
       FROM wishlist_items wi
       INNER JOIN wishlists w ON wi.wishlist_id = w.id
       INNER JOIN products p ON wi.product_id = p.id
       WHERE w.user_id = $1`,
      [userId]
    );

    res.json(wishlistRes.rows);
    // console.log(wishlistRes.rows)
  } catch (err) {
    console.error("Wishlist fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
};



// Add product to wishlist
exports.addToWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id, quantity = 1 } = req.body;

    if (!product_id) {
      return res.status(400).json({ message: "Product ID is required" });
    }

    // Ensure wishlist exists
    let wishlistRes = await pool.query(
      "SELECT id FROM wishlists WHERE user_id=$1",
      [userId]
    );

    let wishlistId;
    if (wishlistRes.rows.length === 0) {
      const createRes = await pool.query(
        "INSERT INTO wishlists(user_id) VALUES($1) RETURNING id",
        [userId]
      );
      wishlistId = createRes.rows[0].id;
    } else {
      wishlistId = wishlistRes.rows[0].id;
    }

    // Insert or update quantity
    await pool.query(
      `INSERT INTO wishlist_items (wishlist_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (wishlist_id, product_id)
       DO UPDATE SET quantity = wishlist_items.quantity + EXCLUDED.quantity`,
      [wishlistId, product_id, quantity]
    );

    // Fetch the product info to return
    const productRes = await pool.query(
      `SELECT p.id AS product_id, p.name, p.price, p.discount_percentage, p.stock, wi.quantity AS wishlist_quantity
       FROM products p
       INNER JOIN wishlist_items wi ON wi.product_id = p.id
       WHERE wi.wishlist_id = $1 AND p.id = $2`,
      [wishlistId, product_id]
    );

    res.json({ message: "Product added to wishlist", product: productRes.rows[0] });
  } catch (err) {
    console.error("Wishlist Error:", err);

    res.status(500).json({
      message: err.detail || err.message || "Server error",
    });
  }
};

// Remove product from wishlist
exports.deleteWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id } = req.params;

    const wishlistRes = await pool.query(
      "SELECT id FROM wishlists WHERE user_id=$1",
      [userId]
    );

    if (!wishlistRes.rows.length)
      return res.status(404).json({ message: "Wishlist not found" });

    await pool.query(
      "DELETE FROM wishlist_items WHERE wishlist_id=$1 AND product_id=$2",
      [wishlistRes.rows[0].id, product_id]
    );

    res.json({ message: "Product removed from wishlist" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// DELETE /api/orders/wishlist/clear
exports.clearWishlist = async (req, res) => {
  try {
    const userId = req.user.id
    const wishlistRes = await pool.query("SELECT id FROM wishlists WHERE user_id=$1", [userId]);

    if (!wishlistRes.rows.length) return res.status(404).json({ message: "Wishlist not found" });

    await pool.query("DELETE FROM wishlist_items WHERE wishlist_id=$1", [wishlistRes.rows[0].id]);
    res.json({ message: "Wishlist cleared" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
