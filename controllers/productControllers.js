const db = require('../db');
const cloudinary = require("../utils/dinary");
const { createNotification } = require('./notificationController');
// ===============================
// Get all products (with optional filters)
// @route   GET /api/products

exports.getAllProducts = async (req, res) => {
  try {
    const { category, sort = "recent", page = 1, limit = 10 } = req.query;

    const offset = (page - 1) * limit;
    const params = [];
    let i = 1;

    // Select fields explicitly and cast unlimited_stock to boolean
    let query = `
      SELECT 
        p.id,
        p.name,
        p.description,
        p.price,
        p.discount_percentage,
        p.category,
        p.stock,
        COALESCE(p.unlimited_stock, false)::boolean AS unlimited_stock,
        p.is_featured,
        p.created_at,
        p.updated_at,
        COALESCE(JSON_AGG(pi.image_url) FILTER (WHERE pi.id IS NOT NULL), '[]') AS images
      FROM products p
      LEFT JOIN product_images pi ON p.id = pi.product_id
      WHERE 1=1
    `;

    // Optional category filter
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
    // console.log("Products fetched:", rows);
    for (const product of rows) {
      if (product.stock !== null && product.stock < 5 && !product.unlimited_stock) {
        await createNotification({
          user_id: null,
          title: "Low Stock Alert",
          message: `${product.name} is running low (${product.stock} left).`,
          type: "stock",
          data: product,    // pass only the product, not array
          triggeredBy: "System",
        });
      }
    }

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
      unlimited_stock,
    } = req.body;

    let is_featured = req.body.is_featured === 'true';
    const unlimited = unlimited_stock === "true" || unlimited_stock === true;

    // Validate max image count
    if (req.files && req.files.length > 5) {
      return res.status(400).json({
        message: "You cannot upload more than 5 images.",
      });
    }

    // Validate each image size ≤ 5MB
    if (req.files) {
      for (const file of req.files) {
        if (file.size > 5 * 1024 * 1024) {
          return res.status(400).json({
            message: "Each image must be less than 5MB.",
          });
        }
      }
    }

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

    // Determine final stock value
    const finalStock = unlimited ? null : stock; // or 0 if you prefer

    // Insert main product
    const insertProduct = `
      INSERT INTO products 
      (name, description, price, discount_percentage, category, stock, unlimited_stock, is_featured, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *
    `;

    const { rows } = await db.query(insertProduct, [
      name,
      description,
      price,
      discount_percentage,
      category,
      finalStock,
      unlimited,
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

    let {
      name,
      description,
      price,
      discount_percentage,
      category,
      stock,
      is_featured,
      unlimited_stock
    } = req.body;

    // --- Parse numbers ---
    price = price !== undefined ? parseFloat(price) : undefined;
    discount_percentage = discount_percentage !== undefined ? parseInt(discount_percentage) : undefined;
    stock = stock !== undefined && stock !== "" ? parseInt(stock) : undefined;

    // --- Parse booleans ---
    is_featured = is_featured !== undefined ? is_featured === "true" : undefined;
    unlimited_stock = unlimited_stock !== undefined ? unlimited_stock === "true" : undefined;

    if (unlimited_stock) stock = null;

    // --- Dynamic query for product fields ---
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) fields.push(`name=$${idx++}`), values.push(name);
    if (description !== undefined) fields.push(`description=$${idx++}`), values.push(description);
    if (price !== undefined) fields.push(`price=$${idx++}`), values.push(price);
    if (discount_percentage !== undefined) fields.push(`discount_percentage=$${idx++}`), values.push(discount_percentage);
    if (category !== undefined) fields.push(`category=$${idx++}`), values.push(category);
    if (stock !== undefined) fields.push(`stock=$${idx++}`), values.push(stock);
    if (is_featured !== undefined) fields.push(`is_featured=$${idx++}`), values.push(is_featured);
    if (unlimited_stock !== undefined) fields.push(`unlimited_stock=$${idx++}`), values.push(unlimited_stock);

    fields.push(`updated_at=NOW()`);
    const query = `UPDATE products SET ${fields.join(", ")} WHERE id=$${idx} RETURNING *`;
    values.push(productId);

    const { rows } = await db.query(query, values);
    if (!rows.length) return res.status(404).json({ message: "Product not found" });
    const updatedProduct = rows[0];

    // --- Handle new images if any ---
    if (req.files?.length > 0) {
      const uploadedUrls = [];
      for (const file of req.files) {
        const url = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "products" },
            (err, result) => err ? reject(err) : resolve(result.secure_url)
          );
          stream.end(file.buffer);
        });
        uploadedUrls.push(url);
      }

      // Insert new images into product_images (keep old ones)
      for (const url of uploadedUrls) {
        await db.query(
          "INSERT INTO product_images (product_id, image_url) VALUES ($1, $2)",
          [productId, url]
        );
      }
    }

    // --- Fetch all images (old + new) ---
    const { rows: imageRows } = await db.query(
      "SELECT image_url FROM product_images WHERE product_id=$1 ORDER BY id ASC",
      [productId]
    );
    updatedProduct.images = imageRows.map(r => r.image_url);

    res.json(updatedProduct);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
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
