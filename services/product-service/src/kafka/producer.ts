import { Kafka } from "kafkajs";
import { SchemaRegistry, SchemaType } from "@kafkajs/confluent-schema-registry";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

//ตั้งค่า Kafka และ Schema Registry
const kafka = new Kafka({
  clientId: "product-service",
  brokers: [process.env.KAFKA_BROKERS || "localhost:9092"],
});

const producer = kafka.producer();
const registry = new SchemaRegistry({
  host: process.env.SCHEMA_REGISTRY_URL || "http://localhost:8081",
});

// สร้างฟังก์ชันสำหรับโหลดและลงทะเบียน Schema
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
    process.exit(1); // ออกจากโปรแกรมถ้าลงทะเบียน Schema ไม่ได้
  }
};

let productCreatedSchemaId: number;
let productUpdatedSchemaId: number;
let producerStockUpdatedSchemaId: number;
let productDeletedSchemaId: number;

// โหลดและลงทะเบียน Schema เมื่อเริ่มต้น
export async function connectProducerAndRegisterSchemas() {
  await producer.connect();
  productCreatedSchemaId = await registerSchema(
    path.join(process.cwd(), "src/kafka/schemas/product-created.avsc")
  );
  productUpdatedSchemaId = await registerSchema(
    path.join(process.cwd(), "src/kafka/schemas/product-updated.avsc")
  );
  producerStockUpdatedSchemaId = await registerSchema(
    path.join(process.cwd(), "src/kafka/schemas/product-stock-updated.avsc")
  );
  productDeletedSchemaId = await registerSchema(
    path.join(process.cwd(), "src/kafka/schemas/product-deleted.avsc")
  );
}

// ฟังก์ชันสำหรับส่งข้อความไปยัง Kafka topic
export const produceProductCreated = async (product: any) => {
  const encoded = await registry.encode(productCreatedSchemaId, product);
  await producer.send({
    topic: "product.created",
    messages: [
      {
        key: product.sku,
        value: encoded,
      },
    ],
  });
  console.log("Produced message to product.created:", product);
};

export const produceProductUpdated = async (product: any) => {
  const encoded = await registry.encode(productUpdatedSchemaId, product);
  await producer.send({
    topic: "product.updated",
    messages: [
      {
        key: product.sku,
        value: encoded,
      },
    ],
  });
  console.log("Produced message to product.updated:", product);
};

export const produceProducerStockUpdated = async (product: any) => {
  const encoded = await registry.encode(producerStockUpdatedSchemaId, product);
  await producer.send({
    topic: "product.stock.updated",
    messages: [
      {
        key: product.sku,
        value: encoded,
      },
    ],
  });
  console.log("Produced message to product.stock.updated:", product);
};

export const produceProductDeleted = async (product: any) => {
  const encoded = await registry.encode(productDeletedSchemaId, product);
  await producer.send({
    topic: "product.deleted",
    messages: [
      {
        key: product.sku,
        value: encoded,
      },
    ],
  });
  console.log("Produced message to product.deleted:", product);
};
