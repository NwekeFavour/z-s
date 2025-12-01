// controllers/orderController.js
const pool = require('../db');
const Stripe = require("stripe");
const { createNotification } = require('./notificationController');
const sendEmail = require('../utils/sendEmail');
const crypto = require("crypto")

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Create a PaymentIntent - frontend calls THIS endpoint
exports.createOrder = async (req, res) => {
  const user_id = req.user.id;
  const { items, shipping_address } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ message: "No order items" });
  }

  const client = await pool.getClient();

  try {
    await client.query("BEGIN");

    // 1️⃣ Check stock
    for (const item of items) {
      const stockRes = await client.query(
        `SELECT stock, name FROM products WHERE id = $1 FOR UPDATE`,
        [item.product_id]
      );
      if (stockRes.rows.length === 0)
        throw new Error(`Product not found: ${item.name}`);
      if (stockRes.rows[0].stock < item.quantity)
        throw new Error(`Insufficient stock for ${stockRes.rows[0].name}`);
    }

    // 2️⃣ Calculate total
    const total_price = items.reduce((acc, i) => acc + i.price * i.quantity, 0);
    const total_price_cents = Math.round(total_price * 100);

    // 3️⃣ Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: total_price_cents,
      currency: "gbp",
      automatic_payment_methods: { enabled: true },
      metadata: {
        user_id: user_id.toString(),
        items: JSON.stringify(items),
        shipping_address: shipping_address || ''
      },
    });

    await client.query("COMMIT");

    res.status(200).json({ client_secret: paymentIntent.client_secret });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create Order Error:", err);
    res.status(400).json({ message: err.message || "Failed to create order" });
  } finally {
    client.release();
  }
};

// Stripe webhook - called by Stripe, NOT frontend
exports.stripeWebhook = async (req, res) => {
  let event;

  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature error:", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;
    const user_id = paymentIntent.metadata.user_id;
    const items = JSON.parse(paymentIntent.metadata.items);
    const shipping_address = paymentIntent.metadata.shipping_address;

    const client = await pool.getClient();

    try {
      await client.query("BEGIN");

      // 1️⃣ Create order
      const orderResult = await client.query(
        `INSERT INTO orders (user_id, payment_method, total_price, is_paid, paid_at, cart_items, shipping_address)
         VALUES ($1, 'stripe', $2, true, NOW(), $3, $4)
         RETURNING *`,
        [user_id, paymentIntent.amount / 100, JSON.stringify(items), shipping_address]
      );

      const order = orderResult.rows[0];

      // 2️⃣ Insert order_items and reduce stock
      for (const item of items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, name, price, quantity, image)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [order.id, item.product_id, item.name, item.price, item.quantity, item.image]
        );

        await client.query(
          `UPDATE products
           SET stock = stock - $1
           WHERE id = $2 AND stock >= $1`,
          [item.quantity, item.product_id]
        );
      }

      // 3️⃣ Send confirmation email
      const userRes = await client.query(`SELECT name, email FROM users WHERE id = $1`, [user_id]);
      const user = userRes.rows[0];

      const itemsHtml = items.map(i => `<li>${i.name} x ${i.quantity} - £${Number(i.price).toFixed(2)}</li>`).join("");
      // Generate unique token for delivery confirmation
      const deliveryToken = crypto.randomBytes(32).toString("hex");

      // Save it with the order
      await client.query(
        `UPDATE orders SET delivery_token = $1 WHERE id = $2`,
        [deliveryToken, order.id]
      );

      // Construct email link
      const deliveryLink = `${process.env.FRONTEND_URL}/order/${order.id}/confirm-delivery?token=${deliveryToken}`;

      const emailHtml = `
        <h2>Hi ${user.name},</h2>
        <p>Thank you for your order #${order.id}!</p>
        <p><strong>Shipping Address:</strong> ${shipping_address || 'N/A'}</p>
        <p><strong>Order Items:</strong></p>
        <ul>${itemsHtml}</ul>
        <p><strong>Total:</strong> £${Number(order.total_price).toFixed(2)}</p>
        <p>Once you receive your items, please click the link below to confirm delivery:</p>
        <p><a href="${deliveryLink}" target="_blank" style="background:#02498b;color:white;padding:10px 15px;text-decoration:none;border-radius:5px;">Confirm Delivery</a></p>
      `;

      await sendEmail({
        to: user.email,
        subject: `Order Confirmation #${order.id}`,
        html: emailHtml
      });

      await createNotification({
        user_id: null, 
        user_triggered_id: order.user_id,
        title: "New Order Received",
        message: `A new order #${order.id} was placed.`,
        type: "order"
      });

      await client.query("COMMIT");
      console.log(`Order ${order.id} processed successfully`);
      return res.status(200).send("Order processed");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Webhook Order Error:", err);
      return res.status(500).send("Webhook failed");
    } finally {
      client.release();
    }
  }

  res.json({ received: true });
};


// ordersController.js
exports.confirmDelivery = async (req, res) => {
  const { orderId } = req.params;
  const { token } = req.query;

  try {
    const orderRes = await pool.query(
      "SELECT id, is_delivered, delivery_token, user_id FROM orders WHERE id = $1",
      [orderId]
    );
    const order = orderRes.rows[0];

    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.is_delivered) return res.status(400).json({ message: "Order already marked delivered" });
    if (order.delivery_token !== token) return res.status(403).json({ message: "Invalid token" });

    await pool.query(
      "UPDATE orders SET is_delivered = true, delivered_at = NOW(), status='delivered' WHERE id = $1",
      [orderId]
    );

    res.send("Thank you! Your order has been marked as delivered.");
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to confirm delivery" });
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
