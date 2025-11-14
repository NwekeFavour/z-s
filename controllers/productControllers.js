const db = require('../db');

// ===============================
// Get all products (with optional filters)
// @route   GET /api/products
exports.getAllProducts = async (req, res) => {
  try {
    const { category, sort, page = 1, limit = 10 } = req.query;
    let query = 'SELECT * FROM products';
    const params = [];
    let whereAdded = false;

    // Filter by category
    if (category) {
      query += ' WHERE category_id = $1';
      params.push(category);
      whereAdded = true;
    }

    // Sorting
    if (sort === 'price') {
      query += whereAdded ? ' ORDER BY price ASC' : ' ORDER BY price ASC';
    } else {
      query += whereAdded ? ' ORDER BY created_at DESC' : ' ORDER BY created_at DESC';
    }

    // Pagination
    const offset = (page - 1) * limit;
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// ===============================
// Get single product by ID
// @route   GET /api/products/:id
exports.getProductById = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// ===============================
// Search products by keyword
// @route   GET /api/products/search?query=keyword
exports.searchProducts = async (req, res) => {
  try {
    const keyword = `%${req.query.query}%`;
    const { rows } = await db.query(
      'SELECT * FROM products WHERE name ILIKE $1',
      [keyword]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// ===============================
// Create a new product (admin only)
// @route   POST /api/products
exports.createProduct = async (req, res) => {
  try {
    const { name, description, price, category_id, stock, images, brand } = req.body;

    const insertQuery = `
      INSERT INTO products 
        (name, description, price, category_id, stock, images, brand, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `;

    const { rows } = await db.query(insertQuery, [name, description, price, category_id, stock, images, brand]);
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// ===============================
// Update a product (admin only)
// @route   PUT /api/products/:id
exports.updateProduct = async (req, res) => {
  try {
    const { name, description, price, category_id, stock, images, brand } = req.body;
    const productId = req.params.id;

    const updateQuery = `
      UPDATE products
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          price = COALESCE($3, price),
          category_id = COALESCE($4, category_id),
          stock = COALESCE($5, stock),
          images = COALESCE($6, images),
          brand = COALESCE($7, brand),
          updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `;

    const { rows } = await db.query(updateQuery, [name, description, price, category_id, stock, images, brand, productId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// ===============================
// Delete a product (admin only)
// @route   DELETE /api/products/:id
exports.deleteProduct = async (req, res) => {
  try {
    const { rows } = await db.query('DELETE FROM products WHERE id = $1 RETURNING *', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json({ message: 'Product removed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};