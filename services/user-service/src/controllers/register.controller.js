import { User } from "../models/index.js";
import { produceUserRegistered } from "../kafka/producer.js";
import bcrypt from "bcryptjs";

export async function registerUser(req, res) {
  try {
    const { username, email, password, full_name } = req.body;
    if (!username || !email || !password || !full_name) {
      return res.status(400).json({ error: "All fields are required" });
    }
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "User already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      email,
      password : hashedPassword,
      full_name,
      role_id: '550e8400-e29b-41d4-a716-446655440001',
    });

    await produceUserRegistered({
      id: user.id,
      username: user.username,
      email: user.email,
      role_id: user.role_id,
      full_name: user.full_name,
      created_at: user.created_at.toISOString(),
    });

    return res.status(201).json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to register user" });
  }
}
