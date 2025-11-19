import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { producePaymentSucceeded } from "../kafka/producer.js";

const prisma = new PrismaClient();

export const createPayment = async (req: Request, res: Response) => {
  // รับข้อมูลจาก Frontend (ปกติเขาจะส่ง orderId กับ token บัตรเครดิตมา)
  const { orderId, amount } = req.body;

  if (!orderId || !amount) {
    return res.status(400).json({ error: "Order ID and Amount are required" });
  }

  try {
    // 1. บันทึกสถานะ "กำลังจ่ายเงิน" (PENDING)
    const payment = await prisma.payment.create({
      data: {
        orderId,
        amount,
        status: "PENDING",
        provider: "MOCK_GATEWAY",
      },
    });

    // -----------------------------------------------
    // 2. จำลองการคุยกับธนาคาร (Mock Payment Gateway)
    // ในความเป็นจริง ตรงนี้จะเรียก Stripe/Omise API
    // -----------------------------------------------

    // (แกล้งหน่วงเวลา 1 วินาที)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // (จำลอง) สุ่มผลลัพธ์: 90% สำเร็จ, 10% ล้มเหลว
    const isSuccess = Math.random() > 0.1;

    if (isSuccess) {
      // 3a. กรณีสำเร็จ (Success)
      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCEEDED",
          transactionId: `TXN-${Date.now()}`, // เลขจำลองจากธนาคาร
        },
      });

      // ⭐️ 4. ส่ง Event บอกโลก!
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
      // 3b. กรณีล้มเหลว (Failed)
      const failedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      });

      // (ควรส่ง Event payment.failed ด้วย แต่ในที่นี้ละไว้ก่อน)
      return res.status(400).json({
        error: "Payment declined by bank",
        payment: failedPayment,
      });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
