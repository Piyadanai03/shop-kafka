import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { producePaymentSucceeded } from "../kafka/producer.js";

const prisma = new PrismaClient();

export const createPayment = async (req: Request, res: Response) => {
  const { orderId, amount } = req.body;
  const userId = req.user?.id;

  if (!orderId || !amount) {
    return res.status(400).json({ error: "Order ID and Amount are required" });
  }

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // ตรวจสอบความเป็นเจ้าของ
    const order = await prisma.orders.findFirst({
      where: {
        id: orderId,
        user_id: userId, 
      },
    });

    if (!order) {
      // ถ้าหาไม่เจอ แปลว่า Order ไม่มีจริง
      return res.status(404).json({ error: "Order not found or access denied" });
    }

    // เริ่มกระบวนการจ่ายเงิน: สร้าง Record "PENDING"
    const payment = await prisma.payment.create({
      data: {
        orderId,
        amount,
        status: "PENDING",
        provider: "MOCK_GATEWAY",
      },
    });

    // (แกล้งหน่วงเวลา 1 วินาที ให้เหมือนคุยกับ API จริง)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // (สุ่มผลลัพธ์: 90% สำเร็จ)
    const isSuccess = Math.random() > 0.1;

    if (isSuccess) {
      // อัปเดตสถานะใน DB
      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCEEDED",
          transactionId: `TXN-${Date.now()}`, // เลขจำลองจากธนาคาร
        },
      });

      // ส่ง Kafka Event
      await producePaymentSucceeded({
        paymentId: updatedPayment.id,
        orderId: updatedPayment.orderId,
        amount: Math.round(parseFloat(updatedPayment.amount.toString()) * 100),
        timestamp: new Date().toISOString(),
      });

      return res.status(200).json({
        message: "Payment successful",
        payment: updatedPayment,
      });

    } else {
      // อัปเดตสถานะเป็น FAILED
      const failedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      });

      return res.status(400).json({
        error: "Payment declined by bank",
        payment: failedPayment,
      });
    }

  } catch (error) {
    console.error("Payment Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};