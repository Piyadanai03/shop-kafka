import type { Request, Response } from "express";
import { db } from "../config/db.js";
import * as schema from "../config/schema.js";
import { eq, and } from "drizzle-orm";

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

//เพิ่มของลงตะกร้า
export const addItemToCart = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { sku, qty } = req.body;

  if (!sku || !qty || qty <= 0) {
    return res
      .status(400)
      .json({ error: "SKU and positive quantity are required" });
  }

  try {
    const newCartItem = await db.transaction(async (tx) => {
      // เช็คสต็อก
      const [product] = await tx
        .select({ stock: productsTable.stock })
        .from(productsTable)
        .where(eq(productsTable.sku, sku))
        .for("update");

      if (!product) {
        throw new Error("Product not found");
      }

      //หาว่ามีของชิ้นนี้ในตะกร้าหรือยัง
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

      //เช็คสต็อกอีกครั้ง
      if (!product.stock || product.stock < newQty) {
        throw new Error("Insufficient stock");
      }

      //(เพิ่ม/อัปเดต) ของในตะกร้า
      if (existingItem) {
        // อัปเดต
        const [updated] = await tx
          .update(cartItemsTable)
          .set({ qty: newQty, updatedAt: new Date() })
          .where(eq(cartItemsTable.id, existingItem.id))
          .returning();
        return updated;
      } else {
        // เพิ่มใหม่
        const [inserted] = await tx
          .insert(cartItemsTable)
          .values({
            userId: userId,
            sku: sku,
            qty: qty,
          })
          .returning();
        return inserted;
      }
    });

    return res.status(201).json(newCartItem);
  } catch (err: any) {
    console.error("Failed to add item to cart:", err);
    if (
      err.message.includes("Insufficient stock") ||
      err.message.includes("Product not found")
    ) {
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
    return res
      .status(400)
      .json({ error: "Item ID and non-negative quantity are required" });
  }

  try {
    // หา cart item ก่อน
    const existingItem = await db.query.cartItemsTable.findFirst({
      where: and(
        eq(cartItemsTable.id, String(itemId)),
        eq(cartItemsTable.userId, userId)
      ),
    });

    if (!existingItem) {
      return res.status(404).json({ error: "Item not found in cart" });
    }

    //ถ้า qty = 0 → ลบออกจากตะกร้า
    if (qty === 0) {
      await db.delete(cartItemsTable).where(eq(cartItemsTable.id, itemId));
      return res.status(200).json({ message: "Item removed (qty = 0)" });
    }

    //เช็ค stock จาก products
    const [product] = await db
      .select({
        stock: productsTable.stock,
      })
      .from(productsTable)
      .where(eq(productsTable.sku, existingItem.sku));

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    if (product.stock == null || product.stock < qty) {
      return res.status(400).json({ error: "Insufficient stock" });
    }

    //ทำการอัปเดต
    const [updated] = await db
      .update(cartItemsTable)
      .set({
        qty,
        updatedAt: new Date(),
      })
      .where(eq(cartItemsTable.id, itemId))
      .returning();

    return res.status(200).json(updated);
  } catch (err: any) {
    console.error("Failed to update item quantity:", err);
    return res.status(500).json({ error: "Failed to update item quantity" });
  }
};
