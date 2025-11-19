import { Kafka } from "kafkajs";
import { SchemaRegistry, SchemaType } from "@kafkajs/confluent-schema-registry";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const kafka = new Kafka({
  clientId: "payment-service",
  brokers: [process.env.KAFKA_BROKERS || "localhost:9092"],
});

const producer = kafka.producer();
const registry = new SchemaRegistry({
  host: process.env.SCHEMA_REGISTRY_URL || "http://localhost:8081",
});

let paymentSucceededSchemaId: number;

export async function connectProducer() {
  await producer.connect();
  
  // Register Schema
  const schemaContent = fs.readFileSync(
    path.join(process.cwd(), "src/kafka/schemas/payment-succeeded.avsc"),
    "utf-8"
  );
  const { id } = await registry.register({
    type: SchemaType.AVRO,
    schema: schemaContent,
  });
  paymentSucceededSchemaId = id;
  console.log("Kafka Producer connected & Schema registered");
}

export async function producePaymentSucceeded(payload: any) {
  const encoded = await registry.encode(paymentSucceededSchemaId, payload);
  await producer.send({
    topic: "payment.succeeded",
    messages: [{ key: payload.orderId, value: encoded }],
  });
  console.log(`💰 Emitted payment.succeeded for Order: ${payload.orderId}`);
}