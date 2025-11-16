import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import dotenv from "dotenv";
import { sequelize } from "./config/db";
import { connectProducerAndRegisterSchemas } from "./kafka/producer";
import { typeDefs } from "./graphql/schema";
import { resolvers } from "./graphql/resolvers";
import { getUserFromToken, UserPayload } from "./middlewares/auth";

export interface MyContext {
  user?: UserPayload | null;
}


dotenv.config();

async function startServer() {
  // เชื่อมต่อฐานข้อมูล
  try {
    await sequelize.authenticate();
    console.log(
      "Connection to the database has been established successfully."
    );
  } catch (error) {
    console.error("Unable to connect to the database:", error);
    process.exit(1);
  }
  // เชื่อมต่อ Kafka Producer และลงทะเบียน Schemas
  await connectProducerAndRegisterSchemas();
  // สร้าง Apollo Server
  const server = new ApolloServer<MyContext>({
    typeDefs,
    resolvers,
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: process.env.PORT_PRODUCT_SERVICE ? parseInt(process.env.PORT_PRODUCT_SERVICE) : 5002 },
    context: async ({ req }) => {
      // ดึง token จาก header
      const token = req.headers.authorization || '';
      const user = getUserFromToken(token);
      return { user: user };
    },
  });

  console.log(`🚀  Server ready at ${url}`);
}

startServer();