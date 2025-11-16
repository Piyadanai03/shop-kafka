import { Kafka } from "kafkajs";
import { SchemaRegistry, SchemaType } from "@kafkajs/confluent-schema-registry";
import fs from "fs";
import path from "path";

//ตั้งค่า Kafka และ Schema Registry
const kafka = new Kafka({
  clientId: "user-service",
  brokers: [process.env.KAFKA_BROKERS || "localhost:9092"],
});

const producer = kafka.producer();
const registry = new SchemaRegistry({
  host: process.env.SCHEMA_REGISTRY_URL || "http://localhost:8081",
});

// สร้างฟังก์ชันสำหรับโหลดและลงทะเบียน Schema
const registerSchema = async (schemaPath) => {
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

// "ที่เก็บ" Schema ID ---
let userCreatedSchemaId;
let userUpdatedSchemaId;

export async function connectProducerAndRegisterSchemas() {
  await producer.connect();
  userCreatedSchemaId = await registerSchema(
    path.join(process.cwd(), "src/kafka/schemas/user-created.avsc")
  );
  userUpdatedSchemaId = await registerSchema(
    path.join(process.cwd(), "src/kafka/schemas/user-updated.avsc")
  );
}

// user-service Kafka Producer Functions
export async function produceUserCreated(user) {
  const encoded = await registry.encode(userCreatedSchemaId, user);
  await producer.send({
    topic: "user.created",
    messages: [{ key: user.userId, value: encoded }],
  });
}

export async function produceUserUpdated(user) {
  const encoded = await registry.encode(userUpdatedSchemaId, user);
  await producer.send({
    topic: "user.updated",
    messages: [{ key: user.userId, value: encoded }],
  });
}