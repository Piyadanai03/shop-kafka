import { Kafka, EachMessagePayload } from 'kafkajs';
import { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { sequelize } from '../config/db.js';
import Inventory from '../models/inventory.model.js';
import { Op } from 'sequelize';

const kafka = new Kafka({
  clientId: 'product-service-consumer',
  brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
});

const registry = new SchemaRegistry({
  host: process.env.SCHEMA_REGISTRY_URL || 'http://localhost:8081',
});

const consumer = kafka.consumer({ groupId: 'product-stock-updater-group' });

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

export async function connectAndStartConsumer() {
  await consumer.connect();
  console.log('Product Consumer connected.');

  await consumer.subscribe({ topic: 'order.created', fromBeginning: true });
  console.log('Subscribed to topic: order.created');

  await consumer.run({
    eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
      if (!message.value) return;

      try {
        const decodedPayload = (await registry.decode(
          message.value
        )) as OrderCreatedPayload;
        
        console.log(`[order.created] Processing Order: ${decodedPayload.orderId}`);

        const itemsToUpdate = decodedPayload.items;
        if (!itemsToUpdate || itemsToUpdate.length === 0) return;

        const t = await sequelize.transaction();
        
        try {
          for (const item of itemsToUpdate) {
            console.log(`Reserving stock for SKU: ${item.sku}, Qty: ${item.qty}`);
            
            // ตัด available, เพิ่ม reserved
            const [affectedRows] = await Inventory.update(
              { 
                available: sequelize.literal(`available - ${item.qty}`),
                reserved: sequelize.literal(`reserved + ${item.qty}`)
              },
              {
                where: {
                  sku: item.sku,
                  available: { [Op.gte]: item.qty } // เช็คว่ามีของให้จองพอไหม
                },
                transaction: t,
              }
            );

            if (affectedRows === 0) {
              throw new Error(`Insufficient available stock for SKU: ${item.sku}`);
            }
          }

          await t.commit();
          console.log(`Stock reserved for Order: ${decodedPayload.orderId}`);

        } catch (updateError: any) {
          await t.rollback();
          console.error(`Failed to reserve stock: ${updateError.message}`);
        }

      } catch (err) {
        console.error('Error processing message:', err);
      }
    },
  });
}