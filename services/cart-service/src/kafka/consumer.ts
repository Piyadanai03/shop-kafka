import { Kafka, EachMessagePayload } from 'kafkajs';
import { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { db } from '../config/db.js';
import * as schema from '../config/schema.js';
import { eq } from 'drizzle-orm';

const { cartItemsTable } = schema;

// --- ตั้งค่า Kafka และ Schema Registry ---
const kafka = new Kafka({
  clientId: 'cart-service-consumer',
  brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
});

const registry = new SchemaRegistry({
  host: process.env.SCHEMA_REGISTRY_URL || 'http://localhost:8081',
});

const consumer = kafka.consumer({ groupId: 'cart-cleaner-group' });

// --- Interfaces (ควรแยกไปไฟล์กลาง) ---
interface OrderCreatedPayload {
  orderId: string;
  userId: string;
  // ... (fields อื่นๆ)
}
interface ProductDeletedPayload {
  id: string;
  sku: string;
  // ...
}

/**
 * 🚀 ฟังก์ชันหลัก: เชื่อมต่อและเริ่ม Consumer
 */
export async function connectAndStartConsumer() {
  await consumer.connect();
  console.log('Cart Consumer connected.');

  // "ฟัง" 2 Topics
  await consumer.subscribe({ topic: 'order.created', fromBeginning: true });
  await consumer.subscribe({ topic: 'product.deleted', fromBeginning: true });
  console.log('Subscribed to topics: order.created, product.deleted');

  // เริ่มรัน
  await consumer.run({
    eachMessage: async ({ topic, message }: EachMessagePayload) => {
      if (!message.value) return;

      try {
        const decodedPayload = await registry.decode(message.value);
        
        // ถ้า Order สำเร็จ -> ล้างตะกร้าของ User นั้น
        if (topic === 'order.created') {
          const { userId } = decodedPayload as OrderCreatedPayload;
          await db.delete(cartItemsTable).where(eq(cartItemsTable.userId, userId));
          console.log(`[order.created] Cart cleared for User: ${userId}`);
        }

        // ถ้า Product ถูกลบ -> ลบออกจากตะกร้า "ทุกคน"
        if (topic === 'product.deleted') {
          const { sku } = decodedPayload as ProductDeletedPayload;
          await db.delete(cartItemsTable).where(eq(cartItemsTable.sku, sku));
          console.log(`[product.deleted] Removed SKU ${sku} from all carts.`);
        }

      } catch (err) {
        console.error(`Error processing message from topic ${topic}:`, err);
      }
    },
  });
}