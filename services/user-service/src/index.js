import { sequelize } from "./config/db.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import routerUser from "./routes/user.routes.js";
import { connectProducerAndRegisterSchemas } from "./kafka/producer.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT_SUSER_SERVICE || 5001;

app.get("/", (req, res) => {
  res.send("User Service is running");
});

app.use("/auth", routerUser);

async function startServer() {
  try {
    await connectProducerAndRegisterSchemas();
    console.log("Kafka Producer connected and schemas registered.");

    await sequelize.authenticate();
    console.log("Connection has been established successfully.");
    app.listen(PORT, () => {
      console.log(`User Service is running on port http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Unable to start server:", error);
  }
}

startServer();
