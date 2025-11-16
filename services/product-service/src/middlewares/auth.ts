import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'secret_key';

export interface UserPayload {
  id: string;
  role_id: string;
}

export const getUserFromToken = (token: string): UserPayload | null => {
  if (!token) {
    return null;
  }

  // แยกคำว่า "Bearer " ออกไป
  const tokenValue = token.split(' ')[1];
  if (!tokenValue) {
    return null;
  }

  try {
    // ตรวจสอบและถอดรหัส token
    const decoded = jwt.verify(tokenValue, JWT_SECRET) as UserPayload;
    return {
      id: decoded.id,
      role_id: decoded.role_id,
    };
  } catch (err) {
    // ถ้า token หมดอายุ หรือไม่ถูกต้อง
    console.error('Invalid token:', err);
    return null;
  }
};