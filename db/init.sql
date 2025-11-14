CREATE TABLE roles (
  id UUID PRIMARY KEY,
  role_name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

INSERT INTO roles (id, role_name)
VALUES 
  ('550e8400-e29b-41d4-a716-446655440000', 'admin'),
  ('550e8400-e29b-41d4-a716-446655440001', 'user');


CREATE TABLE users (
  id UUID PRIMARY KEY,
  role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);


CREATE TABLE products (
  id UUID PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL CHECK (price >= 0),
  stock INT DEFAULT 0 CHECK (stock >= 0),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);


CREATE TABLE cart_items (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  sku TEXT REFERENCES products(sku) ON DELETE CASCADE,
  qty INT NOT NULL CHECK (qty > 0),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);


CREATE TABLE order_statuses (
  id SERIAL PRIMARY KEY,
  status_name TEXT UNIQUE NOT NULL,
  description TEXT,
  priority INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);


CREATE TABLE orders (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  total NUMERIC NOT NULL CHECK (total >= 0),
  status_id INT REFERENCES order_statuses(id),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);


CREATE TABLE order_items (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  sku TEXT REFERENCES products(sku),
  qty INT NOT NULL CHECK (qty > 0),
  price NUMERIC NOT NULL CHECK (price >= 0),
  created_at TIMESTAMP DEFAULT now()
);


CREATE TABLE inventory (
  sku TEXT PRIMARY KEY REFERENCES products(sku),
  available INT NOT NULL CHECK (available >= 0),
  reserved INT DEFAULT 0 CHECK (reserved >= 0),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
