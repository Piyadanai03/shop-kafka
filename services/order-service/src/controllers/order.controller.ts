import type { Request, Response } from 'express';
import { db } from '../config/db';
import * as schema from '../config/schema';
import { eq, inArray } from 'drizzle-orm';
import { produceOrderCreated } from '../kafka/producer';

const { cartItemsTable, productsTable, ordersTable, orderItemsTable, orderStatusesTable } = schema;

/**
 * 1. สร้าง Order จากตะกร้าสินค้า
 * (นี่คือ Logic ที่ซับซ้อนและต้องเป็น Transaction)
 */
export const createOrderFromCart = async (req: Request, res: Response) => {
  const userId = req.user!.id; // มาจาก authMiddleware

  try {
    // ⭐️ ใช้ Drizzle Transaction (db.transaction)
    // ถ้ามี Error ใดๆ เกิดขึ้น (รวมถึง Kafka fail) ทุกอย่างจะถูก Rollback
    const newOrder = await db.transaction(async (tx) => {
      // 1. ดึงสินค้าทั้งหมดในตะกร้าของ User
      const cart = await tx.select().from(cartItemsTable).where(eq(cartItemsTable.userId, userId));

      if (cart.length === 0) {
        throw new Error('Cart is empty');
      }

      // 2. ดึง SKUs และ Qty
      const skus = cart.map(item => item.sku);
      const cartMap = new Map(cart.map(item => [item.sku, item.qty]));

      // 3. ⭐️ ล็อกแถว (Lock Rows)
      // ดึงข้อมูลสินค้าล่าสุด (ราคา, สต็อก) และ "ล็อก" แถวเหล่านี้ใน DB
      // เพื่อป้องกันไม่ให้คนอื่นมาซื้อตัดหน้า (Race Condition)
      const products = await tx
        .select()
        .from(productsTable)
        .where(inArray(productsTable.sku, skus))
        .for('update'); // ⭐️ สำคัญ: SQL FOR UPDATE

      // 4. ตรวจสอบสต็อกและคำนวณราคารวม
      let total = 0;
      const orderItemsPayload: any[] = []; //สำหรับ Kafka
      const orderItemsData: any[] = [];    //สำหรับ DB

      for (const product of products) {
        const qtyInCart = cartMap.get(product.sku!);

        if (!qtyInCart) {
          throw new Error(`Product SKU ${product.sku} not in cart?`); // (Bug)
        }

        // เช็คสต็อก
        if (product.stock! < qtyInCart) {
          throw new Error(`Insufficient stock for ${product.name} (SKU: ${product.sku})`);
        }

        const price = parseFloat(product.price!);
        total += price * qtyInCart;

        // เก็บข้อมูลสำหรับสร้าง order_items
        orderItemsPayload.push({
            sku: product.sku!,
            qty: qtyInCart,
            price: price, // ราคา (double) สำหรับ Kafka
        });
        orderItemsData.push({
            sku: product.sku!,
            qty: qtyInCart,
            price: product.price!, // ราคา (string/numeric) สำหรับ DB
        });
      }

      // 5. ค้นหาสถานะ 'pending'
      const pendingStatus = await tx.select({ id: orderStatusesTable.id, name: orderStatusesTable.statusName })
        .from(orderStatusesTable)
        .where(eq(orderStatusesTable.statusName, 'pending'))
        .limit(1);

      // ⭐️ เช็คว่ามีข้อมูลหรือไม่
      if (pendingStatus.length === 0) {
        throw new Error("'pending' order status not found");
      }

      // ⭐️ ใช้ ! เพื่อบอก TypeScript ว่าเราแน่ใจว่ามีค่า
      const statusId = pendingStatus[0]!.id;
      const statusName = pendingStatus[0]!.name;

      // 6. สร้าง Order (ในตาราง 'orders')
      const createdOrder = await tx.insert(ordersTable).values({
        userId: userId,
        total: total.toFixed(2), // บันทึกเป็น Numeric/String
        statusId: statusId,
      }).returning({
        id: ordersTable.id,
        createdAt: ordersTable.createdAt,
      });
      
      // ⭐️ เช็คว่ามีข้อมูลหรือไม่
      if (createdOrder.length === 0) {
        throw new Error("Failed to create order");
      }

      // ⭐️ ใช้ ! เพื่อบอก TypeScript ว่าเราแน่ใจว่ามีค่า
      const newOrderId = createdOrder[0]!.id;
      const newOrderCreatedAt = createdOrder[0]!.createdAt;

      // 7. สร้าง Order Items (ในตาราง 'order_items')
      const itemsToInsert = orderItemsData.map(item => ({
        ...item,
        orderId: newOrderId,
      }));
      await tx.insert(orderItemsTable).values(itemsToInsert);

      // 8. ลบสินค้าออกจากตะกร้า
      await tx.delete(cartItemsTable).where(eq(cartItemsTable.userId, userId));

      // 9. ⭐️ ส่ง Event ไป Kafka (เป็นส่วนหนึ่งของ Transaction)
      // ถ้า Kafka ล่ม -> Transaction ทั้งหมดจะ Rollback
      await produceOrderCreated({
        orderId: newOrderId,
        userId: userId,
        total: total, // double
        statusName: statusName,
        createdAt: newOrderCreatedAt?.toISOString(),
        items: orderItemsPayload,
      });

      // 10. คืนค่า Order ที่สร้างเสร็จ
      return { ...createdOrder[0]!, total, items: orderItemsData };
    });

    // ⭐️ Transaction สำเร็จ
    return res.status(201).json(newOrder);

  } catch (err: any) {
    // ⭐️ Transaction ล้มเหลว (Rollbacked)
    console.error("Order creation failed:", err);
    if (err.message.includes('Insufficient stock') || err.message.includes('Cart is empty')) {
        return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: "Failed to create order" });
  }
};

/**
 * 2. ดูประวัติการสั่งซื้อ (ของตัวเอง)
 */
export const getOrderHistory = async (req: Request, res: Response) => {
  const userId = req.user!.id; // มาจาก authMiddleware

  try {
    // ใช้ Drizzle Query (db.query) เพื่อดึงข้อมูลแบบ Eager Loading (ดึง relations)
    const orders = await db.query.ordersTable.findMany({
      where: eq(ordersTable.userId, userId),
      with: {
        items: true, // ⭐️ ดึง 'order_items' มาด้วย
        status: true, // ⭐️ ดึง 'order_statuses' มาด้วย
      },
      orderBy: (orders, { desc }) => [desc(orders.createdAt)],
    });

    return res.json(orders);
  } catch (err) {
    console.error("Failed to get order history:", err);
    return res.status(500).json({ error: "Failed to retrieve orders" });
  }
};