import express from 'express';
import { createOrderFromCart , getOrderHistory } from '../controllers/order.controller';
import { authMiddleware } from '../middlewares/auth';

const orderRouter = express.Router();

// สร้าง Order จากตะกร้าสินค้า (ต้องล็อกอิน)
orderRouter.post('/orders', authMiddleware, createOrderFromCart);
// ดูประวัติการสั่งซื้อ (ของตัวเอง)
orderRouter.get('/orders/history', authMiddleware, getOrderHistory);

export default orderRouter;