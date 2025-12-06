CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  reset_password_token TEXT,
  reset_password_expire TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);



CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  discount_percentage SMALLINT CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
  category VARCHAR(255) NOT NULL,
  stock INTEGER NOT NULL CHECK (stock >= 0),
  rating NUMERIC(3,2) DEFAULT 0,
  num_reviews INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT FALSE,
  unlimited_stock BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE product_images (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL
);

CREATE TABLE carts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cart_items (
  id SERIAL PRIMARY KEY,
  cart_id INTEGER REFERENCES carts(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  price NUMERIC(10,2) NOT NULL, 
  discount_percentage SMALLINT DEFAULT 0 CHECK (discount_percentage >= 0 AND discount_percentage <= 100)
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  payment_method VARCHAR(100) NOT NULL,
  total_amount NUMERIC(10, 2) NOT NULL,
  is_paid BOOLEAN DEFAULT FALSE,
  paid_at TIMESTAMPTZ,
  is_shipped BOOLEAN DEFAULT FALSE,
  shipped_at TIMESTAMPTZ,
  is_delivered BOOLEAN DEFAULT FALSE,
  delivered_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'processing' 
     CHECK (status IN ('processing', 'shipped', 'delivered', 'cancelled')),
  payment_status VARCHAR(50) DEFAULT 'unpaid',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE shipping_addresses (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  full_name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(50) NOT NULL,
  address_line1 VARCHAR(255) NOT NULL,     -- e.g. "221B Baker Street"
  city VARCHAR(255) NOT NULL,         -- e.g. "London"
  postcode VARCHAR(20) NOT NULL,           -- e.g. "NW1 6XE"
  country VARCHAR(100) NOT NULL DEFAULT 'United Kingdom'
);


CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  name VARCHAR(255),
  price NUMERIC(10,2),
  quantity INTEGER,
  image TEXT
);

CREATE TABLE addresses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  phone_number VARCHAR(50) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  address_line1 VARCHAR(255) NOT NULL,
  city VARCHAR(150) NOT NULL,
  postcode VARCHAR(20) NOT NULL,
  country VARCHAR(100) DEFAULT 'United Kingdom'
);



CREATE TABLE wishlists (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, product_id) -- ensures a user cannot add the same product multiple times
);

CREATE TABLE wishlist_items (
  id SERIAL PRIMARY KEY,
  wishlist_id INTEGER REFERENCES wishlists(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 1 CHECK (quantity >= 1),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wishlist_id, product_id) -- prevents duplicate items
);

CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INT,
  title TEXT,
  message TEXT,
  type VARCHAR(50),
  data JSONB,
  triggered_by TEXT,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NO                   -- timestamp of last update
);

-- Optional: index for faster retrieval of unread notifications
CREATE INDEX idx_notifications_user_read 
ON notifications(user_id, is_read);
