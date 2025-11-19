import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectProducer } from './kafka/producer.js';
import cartPayment from '../src/routes/payment.routes.js'


dotenv.config();

const app = express();
const PORT = process.env.PORT_PAYMENT_SERVICE || 5005;

app.use(cors());
app.use(express.json());

app.use('/', cartPayment);

async function startServer() {
  try {
    await connectProducer();
    app.listen(PORT, () => {
      console.log(`Payment Service running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server', err);
  }
}

startServer();