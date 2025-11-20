const db = require('../db');
const cloudinary = require("../utils/dinary")
// ===============================
// Get all products (with optional filters)
// @route   GET /api/products
exports.getAllProducts = async (req, res) => {
  try {
    const { category, sort = "recent", page = 1, limit = 10 } = req.query;

    let query = `SELECT * FROM products`;
    const params = [];
    let whereAdded = false;

    // Filter by category
    if (category) {
      query += ` WHERE category_id = $1`;
      params.push(category);
      whereAdded = true;
    }

    // Sorting
    if (sort === "priceLow") {
      query += whereAdded ? ` ORDER BY price ASC` : ` ORDER BY price ASC`;
    } else if (sort === "priceHigh") {
      query += whereAdded ? ` ORDER BY price DESC` : ` ORDER BY price DESC`;
    } else {
      query += whereAdded ? ` ORDER BY created_at DESC` : ` ORDER BY created_at DESC`;
    }

    // Pagination
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};


// ===============================
// Get single product by ID
// @route   GET /api/products/:id
exports.getProductById = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM products WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    res.json(rows[0]);
  } catch (error) {
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
    const {
      name,
      description,
      price,
      discount_percentage,
      category,
      stock,
      brand,
    } = req.body;
    let is_featured = req.body.is_featured === 'true';
    // Upload images to Cloudinary
    let imageUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "products" },
            (err, result) => {
              if (err) return reject(err);
              resolve(result.secure_url);
            }
          );
          stream.end(file.buffer);
        });

        imageUrls.push(url);
      }
    }

    // Insert main product
    const insertProduct = `
      INSERT INTO products 
      (name, description, price, discount_percentage, category, stock, brand, is_featured,  created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *
    `;

    const { rows } = await db.query(insertProduct, [
      name,
      description,
      price,
      discount_percentage,
      category,
      stock,
      brand,
      is_featured,
    ]);

    const product = rows[0];

    // Insert image URLs into product_images
    if (imageUrls.length > 0) {
      const values = imageUrls.map((_, i) => `($1, $${i + 2})`).join(",");
      const imageQuery = `
        INSERT INTO product_images (product_id, image_url)
        VALUES ${values}
      `;
      await db.query(imageQuery, [product.id, ...imageUrls]);
    }

    res.status(201).json({
      ...product,
      images: imageUrls,
    });
  } catch (err) {
    console.error("CREATE PRODUCT ERROR:", err);
    res.status(500).json({
      message: err.message,
    });
  }
};




// ===============================
// Update a product (admin only)
// @route   PUT /api/products/:id
exports.updateProduct = async (req, res) => {
  try {
    const productId = req.params.id;

    const {
      name,
      description,
      price,
      discount_percentage,
      category,
      stock,
      brand,
      is_featured
    } = req.body;

    const imageUrls = req.files?.length
      ? req.files.map(file => file.path).filter(Boolean)
      : [];

    // Update the product details
    const updateQuery = `
      UPDATE products SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        price = COALESCE($3, price),
        discount_percentage = COALESCE($4, discount_percentage),
        category = COALESCE($5, category),
        stock = COALESCE($6, stock),
        brand = COALESCE($7, brand),
        is_featured = COALESCE($8, is_featured),
        updated_at = NOW()
      WHERE id = $9
      RETURNING *
    `;

    const { rows } = await db.query(updateQuery, [
      name,
      description,
      price,
      discount_percentage,
      category,
      stock,
      brand,
      is_featured,
      productId
    ]);

    if (!rows.length)
      return res.status(404).json({ message: "Product not found" });

    // If there are new images, replace old images
    if (imageUrls.length > 0) {
      // Delete existing images first
      await db.query(
        "DELETE FROM product_images WHERE product_id = $1",
        [productId]
      );

      // Insert new images
      const values = imageUrls.map((_, i) => `($1, $${i + 2})`).join(", ");
      const imageQuery = `
        INSERT INTO product_images (product_id, image_url)
        VALUES ${values}
      `;
      await db.query(imageQuery, [productId, ...imageUrls]);
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