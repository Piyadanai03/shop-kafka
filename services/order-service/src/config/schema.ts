import { pgTable, text, uuid, timestamp, integer, numeric, serial } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const usersTable = pgTable('users', {
  id: uuid('id').primaryKey(),
});

export const productsTable = pgTable('products', {
  id: uuid('id').primaryKey(),
  sku: text('sku').unique().notNull(),
  name: text('name').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
});

export const inventoryTable = pgTable('inventory', {
  sku: text('sku').primaryKey().references(() => productsTable.sku),
  available: integer('available').notNull(),
  reserved: integer('reserved').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});


export const orderStatusesTable = pgTable('order_statuses', {
  id: serial('id').primaryKey(),
  statusName: text('status_name').unique().notNull(),
  description: text('description'),
  priority: integer('priority').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const ordersTable = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  total: numeric('total', { precision: 10, scale: 2 }).notNull(),
  statusId: integer('status_id').notNull().references(() => orderStatusesTable.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const orderItemsTable = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => ordersTable.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull().references(() => productsTable.sku),
  qty: integer('qty').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(), // ราคาสินค้า ณ วันที่ซื้อ
  createdAt: timestamp('created_at').defaultNow(),
});

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
  product: one(productsTable, {
    fields: [orderItemsTable.sku],
    references: [productsTable.sku],
  }),
}));