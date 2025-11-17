import type { Request, Response } from 'express';
import { db } from '../config/db';
import * as schema from '../config/schema';
import { eq, inArray } from 'drizzle-orm';
import { produceOrderCreated } from '../kafka/producer';

const { cartItemsTable, productsTable, ordersTable, orderItemsTable, orderStatusesTable } = schema;

/**
 * 1. สร้าง Order จากตะกร้าสินค้า
 */
export const createOrderFromCart = async (req: Request, res: Response) => {
  const userId = req.user!.id; // มาจาก authMiddleware

  try {
    // ใช้ Drizzle Transaction
    const newOrder = await db.transaction(async (tx) => {
      //ดึงสินค้าทั้งหมดในตะกร้า
      const cart = await tx.select().from(cartItemsTable).where(eq(cartItemsTable.userId, userId));

      if (cart.length === 0) {
        throw new Error('Cart is empty');
      }

      // ดึง SKUs และ Qty
      const skus = cart.map(item => item.sku);
      const cartMap = new Map(cart.map(item => [item.sku, item.qty]));

      // ล็อกแถว (Lock Rows)
      const products = await tx
        .select()
        .from(productsTable)
        .where(inArray(productsTable.sku, skus))
        .for('update');

      //ตรวจสอบสต็อกและคำนวณราคารวม
      let total = 0; //(นี่คือ total แบบทศนิยม)
      const orderItemsPayload: any[] = []; //สำหรับ Kafka
      const orderItemsData: any[] = [];    //สำหรับ DB

      for (const product of products) {
        const qtyInCart = cartMap.get(product.sku!);

        if (!qtyInCart) {
          throw new Error(`Product SKU ${product.sku} not in cart?`);
        }

        if (product.stock! < qtyInCart) {
          throw new Error(`Insufficient stock for ${product.name} (SKU: ${product.sku})`);
        }

        const price = parseFloat(product.price!);
        total += price * qtyInCart;

        //เก็บข้อมูลสำหรับ Kafka เป็น "สตางค์"
        orderItemsPayload.push({
            sku: product.sku!,
            qty: qtyInCart,
            price: Math.round(price * 100),
        });
        // (เก็บข้อมูลสำหรับ DB เหมือนเดิม)
        orderItemsData.push({
            sku: product.sku!,
            qty: qtyInCart,
            price: product.price!,
        });
      }

      //ค้นหาสถานะ 'pending'
      const pendingStatus = await tx.select({ id: orderStatusesTable.id, name: orderStatusesTable.statusName })
        .from(orderStatusesTable)
        .where(eq(orderStatusesTable.statusName, 'pending'))
        .limit(1);

      if (pendingStatus.length === 0) {
        throw new Error("'pending' order status not found");
      }

      const statusId = pendingStatus[0]!.id;
      const statusName = pendingStatus[0]!.name;

      //สร้าง Order (ในตาราง 'orders')
      const createdOrder = await tx.insert(ordersTable).values({
        userId: userId,
        total: total.toFixed(2),
        statusId: statusId,
      }).returning({
        id: ordersTable.id,
        createdAt: ordersTable.createdAt,
      });
      
      if (createdOrder.length === 0) {
        throw new Error("Failed to create order");
      }

      const newOrderId = createdOrder[0]!.id;
      const newOrderCreatedAt = createdOrder[0]!.createdAt;

      //สร้าง Order Items (ในตาราง 'order_items')
      const itemsToInsert = orderItemsData.map(item => ({
        ...item,
        orderId: newOrderId,
      }));
      await tx.insert(orderItemsTable).values(itemsToInsert);

      //ลบสินค้าออกจากตะกร้า
      await tx.delete(cartItemsTable).where(eq(cartItemsTable.userId, userId));

      //ส่ง Event ไป Kafka
      await produceOrderCreated({
        orderId: newOrderId,
        userId: userId,
        total: Math.round(total * 100),
        statusName: statusName,
        createdAt: newOrderCreatedAt?.getTime(),
        items: orderItemsPayload,
      });

      //คืนค่า Order ที่สร้างเสร็จ
      return { ...createdOrder[0]!, total, items: orderItemsData };
    });

    //Transaction สำเร็จ
    return res.status(201).json(newOrder);

  } catch (err: any) {
    //Transaction ล้มเหลว (Rollbacked)
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
  const userId = req.user!.id;

  try {
    const orders = await db.query.ordersTable.findMany({
      where: eq(ordersTable.userId, userId),
      with: {
        items: true,
        status: true,
      },
      orderBy: (orders, { desc }) => [desc(orders.createdAt)],
    });

    return res.json(orders);
  } catch (err) {
    console.error("Failed to get order history:", err);
    return res.status(500).json({ error: "Failed to retrieve orders" });
  }
};