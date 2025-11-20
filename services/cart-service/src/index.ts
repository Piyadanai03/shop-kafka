import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cartRouter from './routes/cart.routes.js';
import { connectAndStartConsumer } from './kafka/consumer.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT_CART_SERVICE || 5004;

app.use(cors());
app.use(express.json());

app.use('/', cartRouter);

// Start Server
async function startServer() {
  try {
    await connectAndStartConsumer();
    console.log('Kafka Consumer connected and subscribed.');

    app.listen(PORT, () => {
      console.log(`Cart Service is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Unable to start server:', error);
    process.exit(1);
  }
}

startServer();