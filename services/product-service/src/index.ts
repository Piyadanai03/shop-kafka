// src/index.ts
import express from "express";
import cors from "cors";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import dotenv from "dotenv";
import { sequelize } from "./config/db";
import { connectProducerAndRegisterSchemas } from "./kafka/producer";
import { typeDefs } from "./graphql/schema";
import { resolvers } from "./graphql/resolvers";
import { getUserFromToken, UserPayload } from "./middlewares/auth";

dotenv.config();

export interface MyContext {
  user?: UserPayload | null;
}

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connected successfully.");
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    process.exit(1);
  }

  try {
    await connectProducerAndRegisterSchemas();
    console.log("✅ Kafka producer connected & schemas registered.");
  } catch (error) {
    console.error("❌ Kafka setup failed:", error);
    process.exit(1);
  }

  const server = new ApolloServer<MyContext>({
    typeDefs,
    resolvers,
  });

  await server.start();

  const app = express();

  app.use(
    cors({
      origin: "*",
      credentials: false,
    })
  );

  app.use(express.json());

  app.use(
    "/graphql",
    expressMiddleware(server, {
      context: async ({ req }) => {
        const token = req.headers.authorization || "";
        const user = getUserFromToken(token);
        return { user };
      },
    }) as unknown as express.RequestHandler
  );

  const port = process.env.PORT_PRODUCT_SERVICE
    ? parseInt(process.env.PORT_PRODUCT_SERVICE)
    : 5002;

  app.listen(port, () => {
    console.log(`🚀 Server ready at http://localhost:${port}/graphql`);
  });
}

startServer();
