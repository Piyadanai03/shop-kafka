import { Kafka } from "kafkajs";
import { SchemaRegistry, SchemaType } from "@kafkajs/confluent-schema-registry";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// ตั้งค่า Kafka และ Schema Registry
const kafka = new Kafka({
  clientId: "order-service",
  brokers: [process.env.KAFKA_BROKERS || "localhost:9092"],
});

const producer = kafka.producer();
const registry = new SchemaRegistry({
  host: process.env.SCHEMA_REGISTRY_URL || "http://localhost:8081",
});

// ฟังก์ชันสำหรับโหลดและลงทะเบียน Schema
const registerSchema = async (schemaPath: string) => {
  try {
    const schemaContent = fs.readFileSync(schemaPath, "utf-8");
    const { id } = await registry.register({
      type: SchemaType.AVRO,
      schema: schemaContent,
    });
    console.log(
      `Schema registered successfully with id: ${id} for ${schemaPath}`
    );
    return id;
  } catch (err) {
    console.error(`Error registering schema ${schemaPath}:`, err);
    process.exit(1);
  }
};

let orderCreatedSchemaId: number;

// โหลดและลงทะเบียน Schema เมื่อเริ่มต้น
export async function connectProducerAndRegisterSchemas() {
  await producer.connect();
  orderCreatedSchemaId = await registerSchema(
    path.join(process.cwd(), "src/kafka/schemas/order-created.avsc")
  );
}

// ฟังก์ชันสำหรับส่งข้อความไปยัง Kafka topic
export const produceOrderCreated = async (orderPayload: any) => {
  const encoded = await registry.encode(orderCreatedSchemaId, orderPayload);
  await producer.send({
    topic: "order.created",
    messages: [
      {
        key: orderPayload.orderId, 
        value: encoded,
      },
    ],
  });
  console.log("Produced message to order.created:", orderPayload.orderId);
};