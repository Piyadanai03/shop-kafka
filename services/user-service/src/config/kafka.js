import { Kafka } from "kafkajs";

const kafka = new Kafka.Kafka({
  clientId: "user-service",
  brokers: ["kafka:9092"],
});

export default kafka;
