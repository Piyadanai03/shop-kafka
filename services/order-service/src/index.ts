import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import orderRouter from "./routes/order.routes"; // (ดู "Gotcha 1")
import { connectProducerAndRegisterSchemas } from "./kafka/producer";

dotenv.config();

const app = express();
// ⭐️ (ดู "Gotcha 2")
const PORT = process.env.PORT_ORDER_SERVICE || 5003;

app.use(cors());
app.use(express.json());

app.use("/", orderRouter);

// -------------------
// ⭐️ สร้างฟังก์ชัน Start
// -------------------
async function startServer() {
  try {
    // 1. เชื่อมต่อ Kafka Producer ก่อน
    await connectProducerAndRegisterSchemas();
    console.log("Kafka Producer connected and schemas registered.");

    // 2. ค่อยเริ่ม Server
    app.listen(PORT, () => {
      console.log(`Order Service is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Unable to start server:", error);
    process.exit(1);
  }
}

// ⭐️ สั่ง Start
startServer();