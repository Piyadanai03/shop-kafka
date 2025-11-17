import express from 'express';
import { createOrder , getOrderHistory } from '../controllers/order.controller.js';
import { authMiddleware } from '../middlewares/auth.js';

const orderRouter = express.Router();

// สร้าง Order จากตะกร้าสินค้า (ต้องล็อกอิน)
orderRouter.post('/orders', authMiddleware, createOrder);
// ดูประวัติการสั่งซื้อ (ของตัวเอง)
orderRouter.get('/orders/history', authMiddleware, getOrderHistory);

export default orderRouter;