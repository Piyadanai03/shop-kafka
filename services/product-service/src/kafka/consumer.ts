import { Kafka, EachMessagePayload } from 'kafkajs';
import { SchemaRegistry, SchemaType } from '@kafkajs/confluent-schema-registry';
import { sequelize } from '../config/db';
import Product from '../models/product.models';
import { Op } from 'sequelize';

//ตั้งค่า Kafka และ Schema Registry
const kafka = new Kafka({
  clientId: 'product-service-consumer',
  brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
});

const registry = new SchemaRegistry({
  host: process.env.SCHEMA_REGISTRY_URL || 'http://localhost:8081',
});

// สร้าง Consumer (สำคัญ: groupId ต้องไม่ซ้ำกัน)
const consumer = kafka.consumer({ groupId: 'product-stock-updater-group' });

//Interface สำหรับ Payload ที่ส่งมาจาก Order-Service
interface OrderItem {
  sku: string;
  qty: number;
  price: number;
}
interface OrderCreatedPayload {
  orderId: string;
  userId: string;
  items: OrderItem[];
}

/**
 * 🚀 ฟังก์ชันหลัก: เชื่อมต่อและเริ่ม Consumer
 */
export async function connectAndStartConsumer() {
  await consumer.connect();
  console.log('Product Consumer connected.');

  // "ฟัง" Topic 'order.created'
  await consumer.subscribe({ topic: 'order.created', fromBeginning: true });
  console.log('Subscribed to topic: order.created');

  // เริ่มรัน Consumer
  await consumer.run({
    eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
      if (!message.value) return;

      try {
        // Decode Avro Message
        const decodedPayload = (await registry.decode(
          message.value
        )) as OrderCreatedPayload;
        
        console.log(`[order.created] Received Order: ${decodedPayload.orderId}`);

        //ดึงรายการสินค้า (SKU และจำนวน)
        const itemsToUpdate = decodedPayload.items;
        if (!itemsToUpdate || itemsToUpdate.length === 0) {
          console.warn(`Order ${decodedPayload.orderId} has no items to update.`);
          return;
        }

        // เริ่ม Transaction
        // อัปเดตสต็อกสินค้าทั้งหมดในครั้งเดียว (All or Nothing)
        const t = await sequelize.transaction();
        
        try {
          // 4. วนลูปอัปเดตสต็อกทีละตัว
          for (const item of itemsToUpdate) {
            console.log(`Updating stock for SKU: ${item.sku}, Qty: ${item.qty}`);
            
            // อัปเดตสต็อก: stock = stock - item.qty
            const [affectedRows] = await Product.update(
              { stock: sequelize.literal(`stock - ${item.qty}`) },
              {
                where: {
                  sku: item.sku,
                  stock: { [Op.gte]: item.qty } //ป้องกันสต็อกติดลบ
                },
                transaction: t,
              }
            );

            //เช็คว่าอัปเดตสำเร็จหรือไม่
            // ถ้า affectedRows = 0 หมายความว่าสต็อกไม่พอ (where clause ล้มเหลว)
            if (affectedRows === 0) {
              throw new Error(`Insufficient stock for SKU: ${item.sku} or SKU not found.`);
            }
          }

          //ถ้าทุกอย่างสำเร็จ -> Commit Transaction
          await t.commit();
          console.log(`✅ Stock updated successfully for Order: ${decodedPayload.orderId}`);

        } catch (updateError: any) {
          //ถ้ามี Error (เช่น สต็อกไม่พอ) -> Rollback
          await t.rollback();
          console.error(`Failed to update stock for Order ${decodedPayload.orderId}: ${updateError.message}`);
          // (ในระบบจริง, ตรงนี้จะส่ง message นี้ไปที่ Dead Letter Queue (DLQ)
          // เพื่อให้ Admin มาตรวจสอบว่าทำไมสต็อกไม่พอ)
        }

      } catch (err) {
        console.error('Error processing message:', err);
      }
    },
  });
}