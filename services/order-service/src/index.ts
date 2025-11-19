import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import orderRouter from "./routes/order.routes.js";
import { connectProducerAndRegisterSchemas } from "./kafka/producer.js";
import { connectAndStartConsumer } from "./kafka/consumer.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT_ORDER_SERVICE || 5003;

app.use(cors());
app.use(express.json());

app.use("/", orderRouter);

async function startServer() {
  try {
    // Producer (ผู้ส่ง)
    await connectProducerAndRegisterSchemas();
    console.log("Kafka Producer connected.");

    // Consumer (ผู้ฟัง) - เริ่มฟังเสียงจาก Payment Service
    await connectAndStartConsumer();

    app.listen(PORT, () => {
      console.log(`Order Service is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Unable to start server:", error);
    process.exit(1);
  }
}

startServer();