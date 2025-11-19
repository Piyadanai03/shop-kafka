import { Router } from "express";
import { createPayment } from "../controllers/payment.controller.js";
import { authMiddleware } from "../middlewares/auth.js";

const cartPayment = Router();

// Route
cartPayment.post("/payments", authMiddleware, createPayment);

export default cartPayment;
