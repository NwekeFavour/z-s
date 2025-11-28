const pool = require('../db');
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.createOrder = async (req, res) => {
  const { user_id, payment_method, items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ message: "No order items" });
  }

  const total_price = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const total_price_cents = Math.round(total_price * 100); // Stripe requires cents

  try {
    // Insert order with cart_items as JSONB
    const orderResult = await pool.query(
      `INSERT INTO orders (user_id, payment_method, total_price, cart_items)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [user_id, payment_method, total_price, JSON.stringify(items)]
    );

    const order = orderResult.rows[0]; // order.id will be like ORD101

    // Insert order_items for records
    for (const item of items) {
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, name, price, quantity, image)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.product_id, item.name, item.price, item.quantity, item.image]
      );
    }

    // Stripe PaymentIntent
    let client_secret = null;
    if (payment_method === "stripe") {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: total_price_cents,
        currency: "gbp",
        metadata: {
          order_id: order.id,
          user_id: user_id.toString(),
        },
      });
      client_secret = paymentIntent.client_secret;
    }

    res.status(201).json({
      order_id: order.id,
      total_price,
      client_secret,
      cart_items: items, // snapshot for frontend/admin
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create order", error: err.message });
  }
};




// GET ALL ORDERS
exports.getOrders = async (req, res) => {
  try {
    // 1️⃣ Fetch orders with customer info
    const ordersResult = await pool.query(`
      SELECT 
        o.*,
        u.name AS customer_name,
        u.email AS customer_email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `);

    const orders = ordersResult.rows;

    if (orders.length === 0) {
      return res.json([]);
    }

    // 2️⃣ Fetch all order items for these orders
    const orderIds = orders.map((o) => o.id);
    const itemsResult = await pool.query(`
      SELECT oi.*, p.name AS product_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ANY($1)
    `, [orderIds]);

    const orderItems = itemsResult.rows;

    // 3️⃣ Map items to their respective orders, fallback to cart_items if empty
    const ordersWithItems = orders.map(order => {
      const itemsForOrder = orderItems.filter(item => item.order_id === order.id);

      // If no order_items exist, parse cart_items
      const items = itemsForOrder.length > 0
        ? itemsForOrder.map(i => ({
            id: i.id,
            product_id: i.product_id,
            name: i.product_name,
            price: i.price,
            quantity: i.quantity,
            image: i.image
          }))
        : (order.cart_items ? JSON.parse(order.cart_items) : []);

      return {
        ...order,
        items
      };
    });

    res.json(ordersWithItems);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch orders", error: err.message });
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


// DELETE /api/orders/:id
exports.deleteOrder = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM order_items WHERE order_id = $1", [id]); // delete items first
    await pool.query("DELETE FROM orders WHERE id = $1", [id]); // then delete order
    res.json({ message: "Order deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete order", error: err.message });
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
