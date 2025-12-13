// controllers/orderController.js
const pool = require('../db');
const Stripe = require("stripe");
const { createNotification } = require('./notificationController');
const crypto = require("crypto");
const sendEmail = require('../utils/sendEmail');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);



exports.getOrderToggle =  async (req, res) => {
  const result = await pool.query("SELECT enabled FROM order_settings LIMIT 1");
  res.json(result.rows[0]);
}

exports.updateOrderToggle = async (req, res) => {
  const { enabled } = req.body || {};
  if (enabled === undefined) {
    return res.status(400).json({ error: "Missing 'enabled' in request body" });
  }

  try {
    await pool.query("UPDATE order_settings SET enabled = $1", [enabled]);
    res.json({ message: "Updated", enabled });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database update failed" });
  }
};

// Create a PaymentIntent - frontend calls THIS endpoint
// ================= Create Order =================
exports.createCheckoutSession = async (req, res) => {
  const user_id = req.user.id;
  const { items, shipping_address, shippingFeePercent } = req.body;

  if (!items || !items.length) return res.status(400).json({ message: "No order items" });

  try {
    // 1️⃣ Check ordering enabled
    const setting = await pool.query("SELECT enabled FROM order_settings LIMIT 1");
    if (!setting.rows[0]?.enabled) return res.status(403).json({ message: "Ordering is disabled" });

    // 2️⃣ Fetch user
    const userRes = await pool.query("SELECT id, name, email FROM users WHERE id = $1", [user_id]);
    const user = userRes.rows[0];

    // 3️⃣ Validate stock
    for (const item of items) {
      const stockRes = await pool.query(
        `SELECT stock, unlimited_stock, name FROM products WHERE id = $1`,
        [item.product_id]
      );
      const product = stockRes.rows[0];
      if (!product) throw new Error(`Product not found: ${item.name}`);
      if (!product.unlimited_stock && product.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }
    }

    // 4️⃣ Calculate totals
    const itemsTotal = items.reduce((acc, i) => acc + i.price * i.quantity, 0);
    const shippingAmount = itemsTotal * ((Number(shippingFeePercent) || 0) / 100);

    // 5️⃣ Stripe line items
    const line_items = items.map(i => ({
      price_data: {
        currency: "gbp",
        product_data: { name: i.name, images: i.image ? [i.image] : [] },
        unit_amount: Math.round(i.price * 100),
      },
      quantity: i.quantity,
    }));

    if (shippingAmount > 0) {
      line_items.push({
        price_data: {
          currency: "gbp",
          product_data: { name: "Shipping Fee" },
          unit_amount: Math.round(shippingAmount * 100),
        },
        quantity: 1,
      });
    }

    // 6️⃣ Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "bacs_debit"], // UK bank transfer included
      mode: "payment",
      customer_email: user.email,
      line_items,
      metadata: {
        user_id: user.id.toString(),
        shipping_address,
        items: JSON.stringify(items),
        shipping_fee: shippingAmount.toFixed(2),
      },
      success_url: `${process.env.FRONTEND_URL}/settings?tab=My+Orders`,
      cancel_url: `${process.env.FRONTEND_URL}/cart`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ================= Stripe Webhook =================
exports.stripeWebhook = async (req, res) => {
  let event;

  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature error:", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // 1️⃣ Payment status
    if (session.payment_status !== "paid") return res.status(200).send("Payment not completed");

    // 2️⃣ Extract metadata
    if (!session.metadata?.user_id) return res.status(200).send("No metadata");

    const user_id = session.metadata.user_id;
    const items = JSON.parse(session.metadata.items);
    const shipping_address = session.metadata.shipping_address;
    const shipping_fee = parseFloat(session.metadata.shipping_fee || 0);
    const itemsTotal = items.reduce((acc, i) => acc + i.price * i.quantity, 0);
    const total_amount = itemsTotal + shipping_fee;
    const paymentIntentId = session.payment_intent;

    const client = await pool.getClient();

    try {
      const existing = await client.query(
        "SELECT id FROM orders WHERE stripe_payment_id = $1",
        [paymentIntentId]
      );
      if (existing.rows.length) return res.status(200).send("Order already processed");

      await client.query("BEGIN");

      const orderNumber = `ORD${Math.floor(100 + Math.random() * 900)}`;

      const orderResult = await client.query(
        `INSERT INTO orders 
          (user_id, payment_method, total_amount, is_paid, paid_at, cart_items, shipping_address, order_number, stripe_payment_id)
          VALUES ($1, 'stripe', $2, TRUE, NOW(), $3, $4, $5, $6)
          RETURNING *`,
        [user_id, total_amount, JSON.stringify(items), shipping_address, orderNumber, paymentIntentId]
      );

      const order = orderResult.rows[0];

      // Insert order items and reduce stock
      for (const item of items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, name, price, quantity, image)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [order.id, item.product_id, item.name, item.price, item.quantity, item.image]
        );

        await client.query(
          `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1`,
          [item.quantity, item.product_id]
        );
      }

      // Delivery token
      const deliveryToken = crypto.randomBytes(32).toString("hex");
      await client.query(`UPDATE orders SET delivery_token = $1 WHERE id = $2`, [deliveryToken, order.id]);

      // Emails
      const userRes = await client.query(`SELECT name, email FROM users WHERE id = $1`, [user_id]);
      const user = userRes.rows[0];

      const adminRes = await client.query(`SELECT email FROM users WHERE is_admin = true`);
      const adminEmails = adminRes.rows.map(a => a.email);

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; background: #f7f7f7; padding: 20px; color: #333;">
          <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 8px;">
            <div style="background: #02498b; padding: 25px; text-align: center; color: #fff;">
              <h1>ZandMarket</h1>
              <p>Order Confirmation</p>
            </div>
            <div style="padding: 25px;">
              <p>Hi <strong>${user.name}</strong>,</p>
              <p>Thank you for your order! Your order number is <strong>${order.order_number}</strong>.</p>
              
              <p><strong>Shipping Address:</strong><br>${shipping_address || "N/A"}</p>

              <h3>Order Summary</h3>
              <table style="width:100%; border-collapse: collapse; margin-top: 10px;">
                <thead>
                  <tr>
                    <th style="text-align:left; padding:10px; background:#f0f0f0;">Item</th>
                    <th style="text-align:center; padding:10px; background:#f0f0f0;">Qty</th>
                    <th style="text-align:right; padding:10px; background:#f0f0f0;">Price</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map(i => `
                    <tr>
                      <td style="padding:10px; border-bottom:1px solid #eee;">${i.name}</td>
                      <td style="padding:10px; text-align:center; border-bottom:1px solid #eee;">${i.quantity}</td>
                      <td style="padding:10px; text-align:right; border-bottom:1px solid #eee;">£${Number(i.price).toFixed(2)}</td>
                    </tr>`).join("")}

                  <tr>
                    <td colspan="2" style="padding:10px; text-align:right; font-weight:bold;">Shipping Fee</td>
                    <td style="padding:10px; text-align:right;">£${shipping_fee.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>

              <p style="font-size:17px; margin-top:15px;"><strong>Total Paid:</strong> £${total_amount.toFixed(2)}</p>
            </div>
          </div>
        </div>
      `;
      await sendEmail({ to: user.email, subject: `ZandMarket Order ${order.order_number}`, html: htmlContent });

      const adminHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>New Order Received</h2>

          <p>A new order has been placed on ZandMarket.</p>

          <p><strong>Order Number:</strong> ${order.order_number}</p>
          <p><strong>Customer:</strong> ${user.name}</p>
          <p><strong>Total:</strong> £${total_amount.toFixed(2)}</p>
          <p><strong>Shipping Fee:</strong> £${shipping_fee.toFixed(2)}</p>

          <h3>Items</h3>
          <ul>
            ${items.map(i => `
              <li>${i.quantity} × ${i.name} — £${i.price}</li>
            `).join("")}
          </ul>

          <hr />
          
          <p style="color: red; font-size: 16px;">
            🔔 <strong>REMINDER:</strong> Don’t forget to update the order status in the admin dashboard once the product has been shipped to the customer.
          </p>
        </div>
      `;

      // Admin notifications
      for (const adminEmail of adminEmails) {
        await sendEmail({ to: adminEmail, subject: `New Order: ${order.order_number}`, html: adminHtml});
      }

      await createNotification({
        user_id: null,
        title: "New Order Received",
        message: `Order ${order.order_number} placed.`,
        type: "order",
        data: [{ id: order.id, customer_name: user.name, items, shipping_fee }],
        triggeredBy: "System",
      });

      await client.query("COMMIT");
      res.status(200).send("Order processed");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Webhook Order Error:", err);
      res.status(500).send("Webhook failed");
    } finally {
      client.release();
    }
  } else {
    res.json({ received: true });
  }
};



// // Stripe Webhook
// exports.stripeWebhook = async (req, res) => {
//   let event;

//   try {
//     const setting = await pool.query("SELECT enabled FROM order_settings LIMIT 1");

//     if (!setting.rows[0].enabled) {
//       return res.status(403).json({
//         error: "OrderingDisabled",
//         message: "Ordering is currently disabled."
//       });
//     }

//     const sig = req.headers["stripe-signature"];
//     event = stripe.webhooks.constructEvent(
//       req.body,
//       sig,
//       process.env.STRIPE_WEBHOOK_SECRET
//     );
//   } catch (err) {
//     console.error("Webhook signature error:", err);
//     return res.status(400).send(`Webhook Error: ${err.message}`);
//   }


//   if (event.type === "checkout.session.completed") {
//     const session = event.data.object;

//     // 1️⃣ Ensure payment is completed
//     if (session.payment_status !== "paid") {
//       return res.status(200).send("Not paid");
//     }

//     // 2️⃣ Extract metadata (SOURCE OF TRUTH)
//     if (!session.metadata || !session.metadata.user_id) {
//       console.log("Missing metadata, skipping event");
//       return res.status(200).send("Skipped, no metadata");
//     }

//     const user_id = session.metadata.user_id;
//     const items = JSON.parse(session.metadata.items);
//     const shipping_address = session.metadata.shipping_address;
//     const shipping_fee = parseFloat(session.metadata.shipping_fee || 0);

//     const itemsTotal = items.reduce(
//       (acc, i) => acc + i.price * i.quantity,
//       0
//     );

//     const total_amount = itemsTotal + shipping_fee;

//     const client = await pool.getClient();

//     try {
//       const existing = await client.query(
//         "SELECT id FROM orders WHERE stripe_payment_id = $1",
//         [paymentIntent.id]
//       );
//       if (existing.rows.length) {
//         console.log("Order already processed for this paymentIntent");
//         return res.status(200).send("Already processed");
//       }
//       await client.query("BEGIN");

      
//       const randomNum = Math.floor(100 + Math.random() * 900);
//       const orderNumber = `ORD${randomNum}`;

//       const orderResult = await client.query(
//         `INSERT INTO orders 
//         (user_id, payment_method, total_amount, is_paid, paid_at, cart_items, shipping_address,  order_number, stripe_payment_id)
//         VALUES ($1, 'stripe', $2, true, NOW(), $3, $4, $5, $6)
//         RETURNING *`,
//         [user_id, total_amount, JSON.stringify(items), shipping_address, orderNumber, paymentIntent.id]
//       );

//       const order = orderResult.rows[0];

//       // Order items + stock reduce
//       for (const item of items) {
//         await client.query(
//           `INSERT INTO order_items (order_id, product_id, name, price, quantity, image)
//            VALUES ($1, $2, $3, $4, $5, $6)`,
//           [order.id, item.product_id, item.name, item.price, item.quantity, item.image]
//         );

//         await client.query(
//           `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1`,
//           [item.quantity, item.product_id]
//         );
//       }

//       // Delivery token
//       const deliveryToken = crypto.randomBytes(32).toString("hex");
//       await client.query(
//         `UPDATE orders SET delivery_token = $1 WHERE id = $2`,
//         [deliveryToken, order.id]
//       );

//       // User and admin emails
//       const userRes = await client.query(`SELECT name, email FROM users WHERE id = $1`, [user_id]);
//       const user = userRes.rows[0];

//       const adminRes = await client.query(`SELECT email FROM users WHERE is_admin = true`);
//       const adminEmails = adminRes.rows.map(a => a.email);
//       // ----------------------------
//       //  USER EMAIL
//       // ----------------------------
//       const htmlContent = `
//         <div style="font-family: Arial, sans-serif; background: #f7f7f7; padding: 20px; color: #333;">
//           <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 8px;">
//             <div style="background: #02498b; padding: 25px; text-align: center; color: #fff;">
//               <h1>ZandMarket</h1>
//               <p>Order Confirmation</p>
//             </div>
//             <div style="padding: 25px;">
//               <p>Hi <strong>${user.name}</strong>,</p>
//               <p>Thank you for your order! Your order number is <strong>${order.order_number}</strong>.</p>
              
//               <p><strong>Shipping Address:</strong><br>${shipping_address || "N/A"}</p>

//               <h3>Order Summary</h3>
//               <table style="width:100%; border-collapse: collapse; margin-top: 10px;">
//                 <thead>
//                   <tr>
//                     <th style="text-align:left; padding:10px; background:#f0f0f0;">Item</th>
//                     <th style="text-align:center; padding:10px; background:#f0f0f0;">Qty</th>
//                     <th style="text-align:right; padding:10px; background:#f0f0f0;">Price</th>
//                   </tr>
//                 </thead>
//                 <tbody>
//                   ${items.map(i => `
//                     <tr>
//                       <td style="padding:10px; border-bottom:1px solid #eee;">${i.name}</td>
//                       <td style="padding:10px; text-align:center; border-bottom:1px solid #eee;">${i.quantity}</td>
//                       <td style="padding:10px; text-align:right; border-bottom:1px solid #eee;">£${Number(i.price).toFixed(2)}</td>
//                     </tr>`).join("")}

//                   <tr>
//                     <td colspan="2" style="padding:10px; text-align:right; font-weight:bold;">Shipping Fee</td>
//                     <td style="padding:10px; text-align:right;">£${shipping_fee.toFixed(2)}</td>
//                   </tr>
//                 </tbody>
//               </table>

//               <p style="font-size:17px; margin-top:15px;"><strong>Total Paid:</strong> £${total_amount.toFixed(2)}</p>
//             </div>
//           </div>
//         </div>
//       `;

//       await sendEmail({
//         to: user.email,
//         subject: `Your ZandMarket Order Confirmation ${order.order_number}`,
//         html: htmlContent,
//       });

//       //  ADMIN EMAIL + REMINDER TO UPDATE STATUS
//       const adminHtml = `
//         <div style="font-family: Arial, sans-serif; padding: 20px;">
//           <h2>New Order Received</h2>

//           <p>A new order has been placed on ZandMarket.</p>

//           <p><strong>Order Number:</strong> ${order.order_number}</p>
//           <p><strong>Customer:</strong> ${user.name}</p>
//           <p><strong>Total:</strong> £${total_amount.toFixed(2)}</p>
//           <p><strong>Shipping Fee:</strong> £${shipping_fee.toFixed(2)}</p>

//           <h3>Items</h3>
//           <ul>
//             ${items.map(i => `
//               <li>${i.quantity} × ${i.name} — £${i.price}</li>
//             `).join("")}
//           </ul>

//           <hr />
          
//           <p style="color: red; font-size: 16px;">
//             🔔 <strong>REMINDER:</strong> Don’t forget to update the order status in the admin dashboard once the product has been shipped to the customer.
//           </p>
//         </div>
//       `;

//       for (const adminEmail of adminEmails) {
//         await sendEmail({
//           to: adminEmail,
//           subject: `New Order Placed: ${order.order_number}`,
//           html: adminHtml,
//         });
//       }

//       await createNotification({
//         user_id: null,
//         title: "New Order Received",
//         message: `A new order ${order.order_number} was placed.`,
//         type: "order",
//         data: [
//           {
//             id: order.id,
//             customer_name: user.name,
//             items: items.map(i => ({
//               product_id: i.product_id,
//               name: i.name,
//               price: i.price,
//               quantity: i.quantity
//             })),
//             shipping_fee
//           }
//         ],
//         triggeredBy: "System",
//       });

//       await client.query("COMMIT");
//       return res.status(200).send("Order processed");
//     } catch (err) {
//       await client.query("ROLLBACK");
//       console.error("Webhook Order Error:", err);
//       return res.status(500).send("Webhook failed");
//     } finally {
//       client.release();
//     }
//   }

//   res.json({ received: true });
// };





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
        : (order.cart_items
            ? (typeof order.cart_items === "string"
                ? JSON.parse(order.cart_items)
                : order.cart_items)  // already an object, use as-is
            : []);

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

exports.getOrderById = async (req, res) => { 
  const { id } = req.params; const user_id = req.user.id; 
  // Make sure your auth middleware sets this 
  try { 
    // Fetch the order only if it belongs to the logged-in user 
    const orderResult = await pool.query( 'SELECT * FROM orders WHERE id = $1 AND user_id = $2', [id, user_id] );
    const order = orderResult.rows[0]; if (!order) return res.status(404).json({ message: "Order not found or not yours" }); 
    // Fetch items for this order 
    const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [id]); order.items = itemsResult.rows; res.json(order); } 
  catch (err) { 
    console.error(err);
    res.status(500).json({ message: "Failed to fetch order" }); 
  } 
};

// GET ORDER BY ID (with items)
exports.getOrdersByUser = async (req, res) => {
  const user_id = req.user.id;

  try {
    const ordersRes = await pool.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [user_id]
    );
    const orders = ordersRes.rows;

    for (const order of orders) {
      const itemsRes = await pool.query(
        'SELECT * FROM order_items WHERE order_id = $1',
        [order.id]
      );
      order.items = itemsRes.rows;
    }

    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
};




// UPDATE ORDER STATUS
exports.updateOrderStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatus = ["processing", "shipped", "delivered", "cancelled"];
  if (!validStatus.includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  try {
    // Decide flags based on status
    let is_shipped = false;
    let is_delivered = false;

    if (status === "shipped") is_shipped = true;
    if (status === "delivered") is_delivered = true;

    const query = `
      UPDATE orders
      SET status = $1,
          is_shipped = $2,
          is_delivered = $3,
          updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `;
    const result = await pool.query(query, [status, is_shipped, is_delivered, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = result.rows[0];

    // Fetch user info
    const userRes = await pool.query(
      "SELECT name, email FROM users WHERE id = $1",
      [order.user_id]
    );
    const user = userRes.rows[0];

    const frontendURL = process.env.FRONTEND_URL || "https://zandmarket.co.uk";
    const trackURL = `${frontendURL}/orders/${id}`;
    const receivedURL = `${frontendURL}/orders/${id}/confirm-delivery?token=${order.delivery_token}`;

    const html = `
      <div style="font-family: Arial, sans-serif; background: #f7f7f7; padding: 20px; color: #333;">
        <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <div style="background: #02498b; padding: 25px; text-align: center; color: #fff;">
            <h1 style="margin: 0; font-size: 24px;">ZandMarket</h1>
            <p style="margin: 5px 0 0; opacity: 0.9;">Order Status Updated</p>
          </div>

          <div style="padding: 25px;">
            <p style="font-size: 15px;">Hi <strong>${user.name}</strong>,</p>
            <p>Your order <strong>#${order.order_number}</strong> has been updated to:</p>
            <p style="font-size: 18px; font-weight: bold; text-transform: capitalize;">
              ${status}
            </p>

            <div style="margin-top: 25px; text-align: center;">
              <a href="${trackURL}"
                style="background: #02498b; color: #fff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-size: 15px;">
                Track Your Order
              </a>
            </div>

            ${status === "shipped" ? `
              <div style="margin-top: 15px; text-align: center;">
                <a href="${receivedURL}"
                  style="background: #28a745; color: #fff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-size: 15px;">
                  Mark as Received
                </a>
              </div>
            ` : ""}

            <p style="font-size: 13px; color: #666; margin-top: 25px; text-align: center;">
              Thank you for shopping with ZandMarket.<br>
              If you have any questions, reply to this email anytime.
            </p>
          </div>
        </div>
      </div>
    `;

    await sendEmail({
      to: user.email,
      subject: `Your Order #${order.order_number} is now ${status}`,
      html,
    });

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update order" });
  }
};






exports.markOrderReceived = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE orders
       SET is_delivered = TRUE,
           status = 'delivered',
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to mark order as delivered" });
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
