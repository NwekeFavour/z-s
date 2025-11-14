const db = require('../db');

// Get current user's cart
const getCart = async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch cart and items with product details
    const query = `
      SELECT ci.id as item_id, ci.quantity, p.id as product_id, p.name, p.price, p.stock
      FROM carts c
      LEFT JOIN cart_items ci ON c.id = ci.cart_id
      LEFT JOIN products p ON ci.product_id = p.id
      WHERE c.user_id = $1
    `;
    const { rows } = await db.query(query, [userId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Cart not found or empty' });
    }

    res.status(200).json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error, unable to fetch cart' });
  }
};

// Add item to cart
const addItemToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity } = req.body;

    // Check if product exists
    const productRes = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
    if (productRes.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Find or create the user's cart
    let cartRes = await db.query('SELECT * FROM carts WHERE user_id = $1', [userId]);
    let cartId;

    if (cartRes.rows.length === 0) {
      // Create new cart
      const insertCart = await db.query('INSERT INTO carts (user_id) VALUES ($1) RETURNING id', [userId]);
      cartId = insertCart.rows[0].id;
    } else {
      cartId = cartRes.rows[0].id;
    }

    // Check if item already exists
    const itemRes = await db.query('SELECT * FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cartId, productId]);

    if (itemRes.rows.length > 0) {
      // Update quantity
      await db.query('UPDATE cart_items SET quantity = quantity + $1 WHERE id = $2', [quantity, itemRes.rows[0].id]);
    } else {
      // Insert new item
      await db.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)', [cartId, productId, quantity]);
    }

    res.status(201).json({ message: 'Item added to cart' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error, unable to add item to cart' });
  }
};

// Update item quantity
const updateItemQuantity = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { quantity } = req.body;

    if (quantity <= 0) {
      return res.status(400).json({ message: 'Quantity must be greater than 0' });
    }

    const result = await db.query('UPDATE cart_items SET quantity = $1 WHERE id = $2 RETURNING *', [quantity, itemId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Item not found' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error, unable to update item' });
  }
};

// Remove item from cart
const removeItemFromCart = async (req, res) => {
  try {
    const { itemId } = req.params;

    const result = await db.query('DELETE FROM cart_items WHERE id = $1 RETURNING *', [itemId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Item not found in cart' });
    }

    res.status(200).json({ message: 'Item removed from cart' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error, unable to remove item' });
  }
};

// Clear the entire cart
const clearCart = async (req, res) => {
  try {
    const userId = req.user.id;

    const cartRes = await db.query('SELECT id FROM carts WHERE user_id = $1', [userId]);
    if (cartRes.rows.length === 0) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    const cartId = cartRes.rows[0].id;
    await db.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);

    res.status(200).json({ message: 'Cart cleared' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error, unable to clear cart' });
  }
};

module.exports = {
  getCart,
  addItemToCart,
  updateItemQuantity,
  removeItemFromCart,
  clearCart
};
