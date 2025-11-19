import type { Request, Response } from 'express';
import { db } from '../config/db.js';
import * as schema from '../config/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { produceOrderCreated } from '../kafka/producer.js';

const { productsTable, inventoryTable, ordersTable, orderItemsTable, orderStatusesTable } = schema;

interface CartItemInput {
  sku: string;
  qty: number;
}

export const createOrder = async (req: Request, res: Response) => {
  const userId = req.user!.id; // จาก authMiddleware
  const items = req.body.items as CartItemInput[];

  // Validate Input
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Cart items are required' });
  }

  try {
    const newOrder = await db.transaction(async (tx) => {
      // 1. เตรียมข้อมูล SKU
      const skus = items.map(item => item.sku);
      const requestMap = new Map(items.map(item => [item.sku, item.qty]));

      // 2. ⭐️ ล็อก Inventory (Row Locking) เพื่อกันแย่งซื้อ
      // (เปลี่ยนจาก productsTable เป็น inventoryTable)
      const inventories = await tx
        .select()
        .from(inventoryTable)
        .where(inArray(inventoryTable.sku, skus))
        .for('update'); // Lock Rows

      // สร้าง Map เพื่อให้ค้นหาง่ายๆ O(1)
      const inventoryMap = new Map(inventories.map(inv => [inv.sku, inv]));

      // 3. ดึงข้อมูลราคาจาก Product (ไม่ต้อง Lock Product ก็ได้ เพราะราคาไม่ค่อยเปลี่ยนชนกัน)
      const products = await tx
        .select()
        .from(productsTable)
        .where(inArray(productsTable.sku, skus));
      
      const productMap = new Map(products.map(p => [p.sku, p]));

      // 4. ตรวจสอบสต็อกและคำนวณเงิน
      let total = 0; // (ทศนิยม)
      const orderItemsPayload: any[] = []; // สำหรับ Kafka (Price = Long/Satang)
      const orderItemsData: any[] = [];    // สำหรับ DB (Price = Numeric/Decimal)

      for (const item of items) {
        const inv = inventoryMap.get(item.sku);
        const prod = productMap.get(item.sku);

        // เช็คว่ามีสินค้าและ Inventory หรือไม่
        if (!prod || !inv) {
           throw new Error(`Product or Inventory not found for SKU: ${item.sku}`);
        }

        // ⭐️ เช็คสต็อก (จาก Inventory.available)
        if (inv.available < item.qty) {
            throw new Error(`Insufficient stock for ${prod.name} (SKU: ${item.sku})`);
        }

        const price = parseFloat(prod.price); // ราคาต่อชิ้น (ทศนิยม)
        total += price * item.qty;            // ราคารวม (ทศนิยม)

        // เตรียมข้อมูลสำหรับ Kafka (แปลงเป็นสตางค์ * 100)
        orderItemsPayload.push({
            sku: item.sku,
            qty: item.qty,
            price: Math.round(price * 100),
        });

        // เตรียมข้อมูลสำหรับ DB
        orderItemsData.push({
            sku: item.sku,
            qty: item.qty,
            price: prod.price, // เก็บเป็น Numeric String ตามเดิม
        });
      }

      // 5. ค้นหาสถานะ 'pending'
      const pendingStatus = await tx.query.orderStatusesTable.findFirst({
          where: eq(orderStatusesTable.statusName, 'pending')
      });

      if (!pendingStatus) {
        throw new Error("'pending' order status not found");
      }

      // 6. สร้าง Order (Header)
      // (ใช้ defaultRandom() ของ DB ในการสร้าง UUID)
      const insertResult = await tx.insert(ordersTable).values({
        userId: userId,
        total: total.toFixed(2), // แปลงเป็น String ทศนิยม 2 ตำแหน่ง
        statusId: pendingStatus.id,
      }).returning({
        id: ordersTable.id,
        createdAt: ordersTable.createdAt
      });

      const [createdOrder] = insertResult;

      if (!createdOrder || !createdOrder.id) {
        throw new Error('Failed to create order');
      }
      
      //สร้าง Order Items (Detail)
      const itemsToInsert = orderItemsData.map(item => ({
        ...item,
        orderId: createdOrder.id,
      }));
      await tx.insert(orderItemsTable).values(itemsToInsert);

      // (Product Service จะฟัง Event นี้แล้วไปตัด Inventory)
      await produceOrderCreated({
        orderId: createdOrder.id,
        userId: userId,
        total: Math.round(total * 100), // ส่ง Total เป็น Long (สตางค์)
        statusName: pendingStatus.statusName,
        createdAt: createdOrder.createdAt?.getTime(), // ส่งเป็น Timestamp (Long)
        items: orderItemsPayload,
      });

      //คืนค่าผลลัพธ์ให้ Frontend
      return { 
          ...createdOrder, 
          total: total.toFixed(2), 
          items: orderItemsData,
          status: pendingStatus 
      };
    });

    return res.status(201).json(newOrder);

  } catch (err: any) {
    console.error("Order creation failed:", err);
    
    // ส่ง Error 400 ถ้าเป็นเรื่องสต็อก
    if (err.message.includes('Insufficient stock') || err.message.includes('not found')) {
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
      orderBy: (orders, { desc }) => [desc(orders.createdAt)],
    });

    return res.json(orders);
  } catch (err) {
    console.error("Failed to get order history:", err);
    return res.status(500).json({ error: "Failed to retrieve orders" });
  }
};