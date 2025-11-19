import { Kafka, EachMessagePayload } from 'kafkajs';
import { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { sequelize } from '../config/db.js';
import Inventory from '../models/inventory.model.js';
import { Op, QueryTypes } from 'sequelize';

const kafka = new Kafka({
  clientId: 'product-service-consumer',
  brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
});

const registry = new SchemaRegistry({
  host: process.env.SCHEMA_REGISTRY_URL || 'http://localhost:8081',
});

const consumer = kafka.consumer({ groupId: 'product-stock-updater-group' });

// Interface สำหรับ Order
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

// ⭐️ Interface สำหรับ Payment
interface PaymentSucceededPayload {
  orderId: string;
  amount: number;
  // ...
}

export async function connectAndStartConsumer() {
  await consumer.connect();
  console.log('Product Consumer connected.');

  // ฟัง 2 Topics
  await consumer.subscribe({ topic: 'order.created', fromBeginning: true });
  await consumer.subscribe({ topic: 'payment.succeeded', fromBeginning: true });
  
  console.log('Subscribed to topics: order.created, payment.succeeded');

  await consumer.run({
    eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
      if (!message.value) return;

      try {
        const decodedPayload = await registry.decode(message.value);

        // -------------------------------------------------------
        // กรณี 1: มี Order ใหม่ -> จองของ (ย้าย Available -> Reserved)
        // -------------------------------------------------------
        if (topic === 'order.created') {
          const payload = decodedPayload as OrderCreatedPayload;
          console.log(`[order.created] Reserving stock for Order: ${payload.orderId}`);
          
          const t = await sequelize.transaction();
          try {
             for (const item of payload.items) {
                const [affected] = await Inventory.update(
                  { 
                    available: sequelize.literal(`available - ${item.qty}`),
                    reserved: sequelize.literal(`reserved + ${item.qty}`)
                  },
                  { where: { sku: item.sku, available: { [Op.gte]: item.qty } }, transaction: t }
                );
                if (!affected) throw new Error(`Insufficient stock: ${item.sku}`);
             }
             await t.commit();
             console.log(`✅ Stock reserved for Order: ${payload.orderId}`);
          } catch (err: any) {
             await t.rollback();
             console.error(`Failed to reserve: ${err.message}`);
          }
        }

        // -------------------------------------------------------
        // กรณี 2: จ่ายเงินสำเร็จ -> ตัดของจริง (ลบ Reserved ทิ้ง)
        // -------------------------------------------------------
        if (topic === 'payment.succeeded') {
           const payload = decodedPayload as PaymentSucceededPayload;
           console.log(`[payment.succeeded] Finalizing stock for Order: ${payload.orderId}`);

           const t = await sequelize.transaction();
           try {
              // หาว่า Order นี้มีสินค้าอะไรบ้าง (ใช้ Raw SQL เพราะเราไม่มี Model OrderItem ใน Service นี้)
              const orderItems = await sequelize.query(
                `SELECT sku, qty FROM order_items WHERE order_id = :orderId`,
                {
                  replacements: { orderId: payload.orderId },
                  type: QueryTypes.SELECT,
                  transaction: t
                }
              ) as { sku: string; qty: number }[];

              if (orderItems.length === 0) {
                 console.warn(`No items found for order ${payload.orderId}`);
                 await t.commit(); 
                 return;
              }

              // วนลูปตัดยอด Reserved
              for (const item of orderItems) {
                 console.log(`Deducting reserved stock for SKU: ${item.sku}, Qty: ${item.qty}`);
                 
                 // ตัด reserved ออกไปเลย (เพราะของขายไปแล้ว)
                 await Inventory.update(
                   { reserved: sequelize.literal(`reserved - ${item.qty}`) },
                   { where: { sku: item.sku }, transaction: t }
                 );
              }

              await t.commit();
              console.log(`💰✅ Stock finalized (shipped) for Order: ${payload.orderId}`);

           } catch (err: any) {
              await t.rollback();
              console.error(`Failed to finalize stock: ${err.message}`);
           }
        }

      } catch (err) {
        console.error('Error processing message:', err);
      }
    },
  });
}