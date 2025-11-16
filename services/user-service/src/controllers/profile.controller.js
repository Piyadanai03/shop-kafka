import { sequelize, User } from "../models/index.js";
import { produceUserUpdated } from "../kafka/producer.js";

export const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId, {
      attributes: [
        "id",
        "username",
        "email",
        "full_name",
        "role_id",
        "created_at",
      ],
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({ user });
  } catch (err) {
    console.error("Get profile error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const updateProfile = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const userId = req.user.id;
    const { username, full_name } = req.body;

    const user = await User.findByPk(userId, { transaction: t });

    if (!user) {
      await t.rollback();
      return res.status(404).json({ error: "User not found" });
    }

    if (username) user.username = username;
    if (full_name) user.full_name = full_name;

    await user.save({ transaction: t });

    await produceUserUpdated({
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      timestamp: new Date().toISOString(),
    });

    await t.commit();

    return res.json({
      message: "Profile updated successfully",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
      },
    });
  } catch (err) {
    // ❌ ถ้า Kafka fail หรือ DB fail → rollback
    await t.rollback();

    console.error("Update profile error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
