const db = require('../db');
const cloudinary = require("../utils/dinary")
// ===============================
// Get all products (with optional filters)
// @route   GET /api/products

exports.getAllProducts = async (req, res) => {
  try {
    const { category, sort = "recent", page = 1, limit = 10 } = req.query;

    const offset = (page - 1) * limit;

    const params = [];
    let i = 1;

    let query = `
      SELECT 
        p.*, 
        COALESCE(JSON_AGG(pi.image_url) FILTER (WHERE pi.id IS NOT NULL), '[]') AS images
      FROM products p
      LEFT JOIN product_images pi ON p.id = pi.product_id
      WHERE 1=1
    `;

    if (category) {
      query += ` AND p.category = $${i}`;
      params.push(category);
      i++;
    }

    query += ` GROUP BY p.id `;

    // Sorting
    if (sort === "priceLow") {
      query += ` ORDER BY p.price ASC `;
    } else if (sort === "priceHigh") {
      query += ` ORDER BY p.price DESC `;
    } else {
      query += ` ORDER BY p.created_at DESC `;
    }

    // Pagination
    query += ` LIMIT $${i} OFFSET $${i + 1} `;
    params.push(limit, offset);

    const { rows } = await db.query(query, params);

    res.json(rows);

  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ message: "Server error" });
  }
};



// ===============================
// Get single product by ID
// @route   GET /api/products/:id
// controllers/productController.js
exports.getProductById = async (req, res) => {
  try {
    const productId = req.params.id;
    // Fetch the main product
    const { rows: productRows } = await db.query(
      `SELECT * FROM products WHERE id = $1`,
      [productId]
    );
    if (!productRows.length) {
      return res.status(404).json({ message: "Product not found" });
    }
    const product = productRows[0];
    // Fetch all images for this product
    const { rows: imageRows } = await db.query(
      `SELECT image_url FROM product_images WHERE product_id = $1`,
      [productId]
    );

    // Attach images array to the product
    product.images = imageRows.map((img) => img.image_url);

    res.json(product);
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
    const productId = req.params.id;

    // 1. Check if the product exists in any orders
    const orderCheck = await db.query(
      'SELECT 1 FROM order_items WHERE product_id = $1 LIMIT 1',
      [productId]
    );
    if (orderCheck.rows.length > 0) {
      return res.status(400).json({
        message: 'Cannot delete product because it is included in existing orders.'
      });
    }

    // 2. Check if the product exists in any carts
    const cartCheck = await db.query(
      'SELECT 1 FROM cart_items WHERE product_id = $1 LIMIT 1',
      [productId]
    );
    if (cartCheck.rows.length > 0) {
      return res.status(400).json({
        message: 'Cannot delete product because it is currently in some users\' carts.'
      });
    }

    // 3. Safe to delete
    const { rows } = await db.query(
      'DELETE FROM products WHERE id = $1 RETURNING *',
      [productId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json({ message: 'Product removed successfully' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};
