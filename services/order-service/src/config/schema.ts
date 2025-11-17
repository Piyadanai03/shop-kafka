import { pgTable, text, uuid, timestamp, integer, numeric, serial, foreignKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const usersTable = pgTable('users', {
  id: uuid('id').primaryKey(),
  role_id: uuid('role_id').notNull(),
  username: text('username').unique().notNull(),
  email: text('email').unique().notNull(),
  password: text('password').notNull(),
  fullName: text('full_name'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// (Map ไปยังตาราง 'products' ที่ product-service สร้าง)
export const productsTable = pgTable('products', {
  id: uuid('id').primaryKey(),
  sku: text('sku').unique().notNull(),
  name: text('name').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(), // Drizzle ใช้ '10, 2' ไม่ได้
  stock: integer('stock').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// == ตารางที่ Order-Service เป็นเจ้าของ ==

// (Map ไปยังตาราง 'order_statuses')
export const orderStatusesTable = pgTable('order_statuses', {
  id: serial('id').primaryKey(),
  statusName: text('status_name').unique().notNull(),
  description: text('description'),
  priority: integer('priority').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// (Map ไปยังตาราง 'orders')
export const ordersTable = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  total: numeric('total', { precision: 10, scale: 2 }).notNull(),
  statusId: integer('status_id').notNull().references(() => orderStatusesTable.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// (Map ไปยังตาราง 'order_items')
export const orderItemsTable = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => ordersTable.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull().references(() => productsTable.sku), // อ้างอิง SKU
  qty: integer('qty').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(), // ราคา "ณ ตอนที่ซื้อ"
  createdAt: timestamp('created_at').defaultNow(),
});

// (Map ไปยังตาราง 'cart_items') - เผื่อ Service นี้ต้องอ่าน
export const cartItemsTable = pgTable('cart_items', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull().references(() => productsTable.sku, { onDelete: 'cascade' }),
    qty: integer('qty').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});


// ------------------------------------
// (ขั้นสูง) การกำหนด Relations (สำหรับ Drizzle)
// ------------------------------------
export const orderRelations = relations(ordersTable, ({ one, many }) => ({
  status: one(orderStatusesTable, {
    fields: [ordersTable.statusId],
    references: [orderStatusesTable.id],
  }),
  user: one(usersTable, {
    fields: [ordersTable.userId],
    references: [usersTable.id],
  }),
  items: many(orderItemsTable),
}));

export const orderItemRelations = relations(orderItemsTable, ({ one }) => ({
  order: one(ordersTable, {
    fields: [orderItemsTable.orderId],
    references: [ordersTable.id],
  }),
  // (เผื่อ) ถ้าอยากดึงข้อมูล Product พร้อมกัน
  product: one(productsTable, {
    fields: [orderItemsTable.sku],
    references: [productsTable.sku],
  })
}));

// (เผื่อ) ถ้าอยากดึง Cart
export const userRelations = relations(usersTable, ({ many }) => ({
  carts: many(cartItemsTable),
  orders: many(ordersTable),
}));

export const cartRelations = relations(cartItemsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [cartItemsTable.userId],
    references: [usersTable.id],
  }),
  product: one(productsTable, {
    fields: [cartItemsTable.sku],
    references: [productsTable.sku],
  }),
}));