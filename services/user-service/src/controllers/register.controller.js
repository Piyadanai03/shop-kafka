import { sequelize, User } from "../models/index.js";
import { produceUserCreated } from "../kafka/producer.js";
import bcrypt from "bcryptjs";

export async function registerUser(req, res) {
  const t = await sequelize.transaction();
  try {
    const { username, email, password, full_name } = req.body;

    if (!username || !email || !password || !full_name) {
      await t.rollback();
      return res.status(400).json({ error: "All fields are required" });
    }

    const existingUser = await User.findOne({
      where: { email },
      transaction: t,
    });
    if (existingUser) {
      await t.rollback();
      return res.status(409).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create(
      {
        username,
        email,
        password: hashedPassword,
        full_name,
        role_id: "550e8400-e29b-41d4-a716-446655440001",
      },
      { transaction: t }
    );

    await produceUserCreated({
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      username: user.username,
      timestamp: new Date().toISOString(),
    });

    await t.commit();

    return res.status(201).json({
      message: "User registered successfully",
      userId: user.id,
      username: user.username,
      email: user.email,
    });
  } catch (err) {
    await t.rollback();
    console.error(err);
    return res.status(500).json({ error: "Failed to register user" });
  }
}
