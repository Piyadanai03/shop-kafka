import type { Request, Response } from 'express';
import { db } from '../config/db.js';
import * as schema from '../config/schema.js';
import { eq, and } from 'drizzle-orm';

const { cartItemsTable, productsTable } = schema;

export const getCart = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const cart = await db.query.cartItemsTable.findMany({
      where: eq(cartItemsTable.userId, userId),
      with: {
        product: {
          columns: {
            name: true,
            price: true,
            stock: true,
          },
        },
      },
      orderBy: (cartItemsTable, { desc }) => [desc(cartItemsTable.createdAt)],
    });
    return res.json(cart);
  } catch (err: any) {
    console.error("Failed to get cart:", err);
    return res.status(500).json({ error: "Failed to retrieve cart" });
  }
};

// 2. เพิ่มของลงตะกร้า
export const addItemToCart = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { sku, qty } = req.body;

  if (!sku || !qty || qty <= 0) {
    return res.status(400).json({ error: "SKU and positive quantity are required" });
  }

  try {
    const newCartItem = await db.transaction(async (tx) => {
      // 1. เช็คสต็อก (และล็อกแถว)
      // ⭐️ [แก้ไข] เปลี่ยนมาใช้ .select() และ .for('update') เพื่อป้องกัน Race Condition
      const [product] = await tx
        .select({ stock: productsTable.stock })
        .from(productsTable)
        .where(eq(productsTable.sku, sku))
        .for('update'); // ⭐️ นี่คือการ "ล็อก"

      if (!product) {
        throw new Error("Product not found");
      }

      // 2. หาว่ามีของชิ้นนี้ในตะกร้าหรือยัง (โค้ดเดิม)
      const existingItem = await tx.query.cartItemsTable.findFirst({
        where: and(
          eq(cartItemsTable.userId, userId),
          eq(cartItemsTable.sku, sku)
        ),
      });

      let newQty = qty;
      if (existingItem) {
        newQty += existingItem.qty; // ⭐️ ถ้ามีอยู่แล้ว ให้บวกเพิ่ม
      }

      // 3. เช็คสต็อกอีกครั้ง (โค้ดเดิม)
      if (!product.stock || product.stock < newQty) {
        throw new Error("Insufficient stock");
      }

      // 4. ⭐️ UPSERT: (เพิ่ม/อัปเดต ใน Drizzle) (โค้ดเดิม)
      if (existingItem) {
        // อัปเดต
        const [updated] = await tx.update(cartItemsTable)
          .set({ qty: newQty, updatedAt: new Date() })
          .where(eq(cartItemsTable.id, existingItem.id))
          .returning();
        return updated;
      } else {
        // เพิ่มใหม่
        const [inserted] = await tx.insert(cartItemsTable).values({
          userId: userId,
          sku: sku,
          qty: qty,
        }).returning();
        return inserted;
      }
    });

    return res.status(201).json(newCartItem);

  } catch (err: any) {
    console.error("Failed to add item to cart:", err);
    if (err.message.includes('Insufficient stock') || err.message.includes('Product not found')) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: "Failed to add item to cart" });
  }
};

// 3. ลบของออกจากตะกร้า (โค้ดเดิม - ถูกต้อง)
export const removeItemFromCart = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { itemId } = req.params; // (โค้ดนี้ถูกต้องอยู่แล้ว)

  if (!itemId) {
    return res.status(400).json({ error: "Item ID is required" });
  }

  try {
    const [deleted] = await db.delete(cartItemsTable)
      .where(and(
        eq(cartItemsTable.id, String(itemId)),
        eq(cartItemsTable.userId, userId)
      ))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Item not found in cart" });
    }
    
    return res.status(200).json({ message: "Item removed" });
  } catch (err: any) {
    console.error("Failed to remove item:", err);
    return res.status(500).json({ error: "Failed to remove item" });
  }
};

// (คุณสามารถเพิ่ม `updateItemQty` ได้ในอนาคต โดยใช้ Logic คล้ายๆ `addItemToCart` แต่เป็นการ `set` ค่าตรงๆ)