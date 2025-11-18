import { pgTable, text, uuid, timestamp, integer, numeric } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// --- ตารางที่เรา "ยืม" มาอ่าน ---
export const usersTable = pgTable('users', {
  id: uuid('id').primaryKey(),
});

export const productsTable = pgTable('products', {
  id: uuid('id').primaryKey(),
  sku: text('sku').unique().notNull(),
  name: text('name').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  stock: integer('stock').default(0),
});

// --- ตารางที่เรา "เป็นเจ้าของ" ---
export const cartItemsTable = pgTable('cart_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull().references(() => productsTable.sku, { onDelete: 'cascade' }),
  qty: integer('qty').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// --- Relations ---
export const cartRelations = relations(cartItemsTable, ({ one }) => ({
  // "ดึงข้อมูล product มาด้วย"
  product: one(productsTable, {
    fields: [cartItemsTable.sku],
    references: [productsTable.sku],
  }),
}));