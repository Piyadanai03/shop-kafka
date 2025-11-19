import type { Request, Response } from 'express';
import { db } from '../config/db.js';
import * as schema from '../config/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { produceOrderCreated } from '../kafka/producer.js';

const { productsTable, ordersTable, orderItemsTable, orderStatusesTable } = schema;

//Interface สำหรับ Body ที่ส่งเข้ามา
interface CartItemInput {
  sku: string;
  qty: number;
}

/**
 * 1. สร้าง Order
 */
export const createOrder = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  // อ่าน Input จาก req.body
  const items = req.body.items as CartItemInput[];

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Cart items are required' });
  }

  try {
    const newOrder = await db.transaction(async (tx) => {
      //ดึง SKUs และ Qty จาก req.body
      const skus = items.map(item => item.sku);
      const cartMap = new Map(items.map(item => [item.sku, item.qty]));

      // ล็อกแถว
      const products = await tx
        .select()
        .from(productsTable)
        .where(inArray(productsTable.sku, skus))
        .for('update'); 

      //ตรวจสอบสต็อกและคำนวณราคารวม
      let total = 0;
      const orderItemsPayload: any[] = [];
      const orderItemsData: any[] = [];

      for (const product of products) {
        const qtyInCart = cartMap.get(product.sku!);
        if (!qtyInCart) {
          throw new Error(`Product SKU ${product.sku} not in body?`);
        }
        if (product.stock! < qtyInCart) {
          throw new Error(`Insufficient stock for ${product.name} (SKU: ${product.sku})`);
        }

        const price = parseFloat(product.price!);
        total += price * qtyInCart;

        //แปลงเป็น "สตางค์" สำหรับ Kafka
        orderItemsPayload.push({
            sku: product.sku!,
            qty: qtyInCart,
            price: Math.round(price * 100), // (สตางค์)
        });
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

      //สร้าง Order
      const createdOrder = await tx.insert(ordersTable).values({
        userId: userId,
        total: total.toFixed(2),
        statusId: statusId,
      }).returning({
        id: ordersTable.id,
        createdAt: ordersTable.createdAt,
      });
      
      const newOrderId = createdOrder[0]!.id;
      const newOrderCreatedAt = createdOrder[0]!.createdAt;

      //สร้าง Order Items
      const itemsToInsert = orderItemsData.map(item => ({
        ...item,
        orderId: newOrderId,
      }));
      await tx.insert(orderItemsTable).values(itemsToInsert);

      // ส่ง Event ไป Kafka (เหมือนเดิม)
      await produceOrderCreated({
        orderId: newOrderId,
        userId: userId,
        total: Math.round(total * 100),
        statusName: statusName,
        createdAt: newOrderCreatedAt?.getTime(),
        items: orderItemsPayload,
      });

      return { ...createdOrder[0]!, total, items: orderItemsData };
    });

    return res.status(201).json(newOrder);

  } catch (err: any) {
    console.error("Order creation failed:", err);
    if (err.message.includes('Insufficient stock') || err.message.includes('Cart items are required')) {
        return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: "Failed to create order" });
  }
};

/**
 * 2. ดูประวัติการสั่งซื้อ
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
      orderBy: (orders: { createdAt: any; } , { desc }: any) => [desc(orders.createdAt)],
    });

    return res.json(orders);
  } catch (err) {
    console.error("Failed to get order history:", err);
    return res.status(500).json({ error: "Failed to retrieve orders" });
  }
};