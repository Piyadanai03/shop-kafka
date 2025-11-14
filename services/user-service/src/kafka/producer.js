import { Kafka } from 'kafkajs';
import { SchemaRegistry, SchemaType } from '@kafkajs/confluent-schema-registry';
import fs from 'fs';
import path from 'path';

const kafka = new Kafka({
  clientId: 'user-service',
  brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
});

const producer = kafka.producer();
await producer.connect();

const registry = new SchemaRegistry({ 
  host: process.env.SCHEMA_REGISTRY_URL || 'http://localhost:8081'
});

// load avro schema
const schemaPath = path.join(process.cwd(), 'src/kafka/schemas/user-registered.avsc');
const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

// register schema (or use existing)
const { id: schemaId } = await registry.register({
  type: SchemaType.AVRO,
  schema: schemaContent
});

// send event
async function produceUserRegistered(user) {
  const encoded = await registry.encode(schemaId, user);

  await producer.send({
    topic: 'users.registered',
    messages: [{ key: user.id, value: encoded }],
  });
}

export { producer, produceUserRegistered };
