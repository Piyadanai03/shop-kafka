import type { Request, Response } from 'express';
import { db } from '../config/db.js';
import * as schema from '../config/schema.js';
import { eq, and } from 'drizzle-orm';

const { cartItemsTable, productsTable, inventoryTable } = schema;

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

//เพิ่มของลงตะกร้า
export const addItemToCart = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { sku, qty } = req.body;

  if (!sku || !qty || qty <= 0) {
    return res.status(400).json({ error: "SKU and positive quantity are required" });
  }

  try {
    const newCartItem = await db.transaction(async (tx) => {
      // เช็คสต็อก (จาก Inventory แทน Product)
      const [inventory] = await tx
        .select({ available: inventoryTable.available })
        .from(inventoryTable)
        .where(eq(inventoryTable.sku, sku))
        .for('update'); // ล็อก Inventory

      if (!inventory) {
        throw new Error("Product inventory not found"); 
      }

      // หาของในตะกร้า (เหมือนเดิม)
      const existingItem = await tx.query.cartItemsTable.findFirst({
        where: and(
          eq(cartItemsTable.userId, userId),
          eq(cartItemsTable.sku, sku)
        ),
      });

      let newQty = qty;
      if (existingItem) {
        newQty += existingItem.qty;
      }

      // เช็คสต็อก available
      //เปลี่ยนเป็น inventory.available
      if (inventory.available < newQty) {
        throw new Error("Insufficient stock");
      }

      //UPSERT 
      if (existingItem) {
        const [updated] = await tx.update(cartItemsTable)
          .set({ qty: newQty, updatedAt: new Date() })
          .where(eq(cartItemsTable.id, existingItem.id))
          .returning();
        return updated;
      } else {
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
    // ปรับ Error Message นิดหน่อย
    if (err.message.includes('Insufficient stock') || err.message.includes('inventory not found')) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: "Failed to add item to cart" });
  }
};

//ลบของออกจากตะกร้า
export const removeItemFromCart = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { itemId } = req.params;

  if (!itemId) {
    return res.status(400).json({ error: "Item ID is required" });
  }

  try {
    const [deleted] = await db
      .delete(cartItemsTable)
      .where(
        and(
          eq(cartItemsTable.id, String(itemId)),
          eq(cartItemsTable.userId, userId)
        )
      )
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

// updateItemQty
export const updateItemQty = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { itemId } = req.params;
  const { qty } = req.body;

  if (!itemId || qty === undefined || qty < 0) {
    return res.status(400).json({ error: "Item ID and non-negative quantity are required" });
  }

  try {
    //ใช้ Transaction เพื่อความชัวร์
    const result = await db.transaction(async (tx) => {
      
      // หา cart item ก่อน
      const existingItem = await tx.query.cartItemsTable.findFirst({
        where: and(
          eq(cartItemsTable.id, String(itemId)),
          eq(cartItemsTable.userId, userId)
        ),
      });

      if (!existingItem) {
        throw new Error("Item not found in cart");
      }

      // ถ้า qty = 0 → ลบออกจากตะกร้า
      if (qty === 0) {
        await tx.delete(cartItemsTable).where(eq(cartItemsTable.id, itemId));
        return { message: "Item removed (qty = 0)" };
      }

      // เช็ค Stock จาก Inventory (แทน Product)
      const [inventory] = await tx
        .select({ available: inventoryTable.available })
        .from(inventoryTable)
        .where(eq(inventoryTable.sku, existingItem.sku))
        .for('update'); // ล็อกแถวเพื่อความชัวร์

      if (!inventory) {
        throw new Error("Product inventory not found");
      }

      // เช็คว่ามีของพอไหม
      if (inventory.available < qty) {
        throw new Error("Insufficient stock");
      }

      // ทำการอัปเดต
      const [updated] = await tx
        .update(cartItemsTable)
        .set({
          qty,
          updatedAt: new Date(),
        })
        .where(eq(cartItemsTable.id, itemId))
        .returning();
      
      return updated;
    });

    return res.status(200).json(result);

  } catch (err: any) {
    console.error("Failed to update item quantity:", err);
    if (err.message === "Item not found in cart") return res.status(404).json({ error: err.message });
    if (err.message === "Product inventory not found") return res.status(404).json({ error: err.message });
    if (err.message === "Insufficient stock") return res.status(400).json({ error: err.message });
    
    return res.status(500).json({ error: "Failed to update item quantity" });
  }
};
