import { Kafka, EachMessagePayload } from "kafkajs";
import { SchemaRegistry } from "@kafkajs/confluent-schema-registry";
import { db } from "../config/db.js";
import * as schema from "../config/schema.js";
import { eq } from "drizzle-orm";

const { ordersTable, orderStatusesTable } = schema;

// Config Kafka
const kafka = new Kafka({
  clientId: "order-service-consumer",
  brokers: [process.env.KAFKA_BROKERS || "localhost:9092"],
});

const registry = new SchemaRegistry({
  host: process.env.SCHEMA_REGISTRY_URL || "http://localhost:8081",
});

// Group ID ต้องไม่ซ้ำกับ Service อื่น
const consumer = kafka.consumer({ groupId: "order-payment-listener-group" });

// Interface ของ Event ที่ส่งมาจาก Payment Service
interface PaymentSucceededPayload {
  paymentId: string;
  orderId: string;
  amount: number;
  timestamp: string;
}

export async function connectAndStartConsumer() {
  await consumer.connect();
  console.log("Order Consumer connected.");

  //ฟัง topic นี้
  await consumer.subscribe({ topic: "payment.succeeded", fromBeginning: true });
  console.log("Subscribed to topic: payment.succeeded");

  await consumer.run({
    eachMessage: async ({ topic, message }: EachMessagePayload) => {
      if (!message.value) return;

      try {
        // ถอดรหัสข้อความ
        const decodedPayload = (await registry.decode(
          message.value
        )) as PaymentSucceededPayload;
        console.log(
          `[payment.succeeded] Processing Order: ${decodedPayload.orderId}`
        );

        // หา ID ของสถานะ 'paid'
        const paidStatus = await db.query.orderStatusesTable.findFirst({
          where: eq(orderStatusesTable.statusName, "paid"),
        });

        if (!paidStatus) {
          console.error("Status 'paid' not found in DB");
          return;
        }

        // อัปเดตสถานะ Order เป็น 'paid'
        await db
          .update(ordersTable)
          .set({
            statusId: paidStatus.id,
            updatedAt: new Date(),
          })
          .where(eq(ordersTable.id, decodedPayload.orderId));

        console.log(`Order ${decodedPayload.orderId} updated to PAID`);
      } catch (err) {
        console.error("Error processing payment message:", err);
      }
    },
  });
}
