import { Sequelize } from "sequelize";

import dotenv from "dotenv";

dotenv.config();

export const sequelize = new Sequelize(
  process.env.DB_NAME as string || 'eventshop',
  process.env.DB_USER as string || 'postgres',
  process.env.DB_PASSWORD as string || 'password',
    {
        host: process.env.DB_HOST as string || 'localhost',
        port: Number(process.env.DB_PORT) || 5432,
        dialect: "postgres",
    }
);