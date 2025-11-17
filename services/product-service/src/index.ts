import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import dotenv from "dotenv";
import { sequelize } from "./config/db";
import { connectProducerAndRegisterSchemas } from "./kafka/producer";
import { typeDefs } from "./graphql/schema";
import { resolvers } from "./graphql/resolvers";
import { getUserFromToken, UserPayload } from "./middlewares/auth"; 
import { connectAndStartConsumer } from "./kafka/consumer";

dotenv.config();

export interface MyContext {
  user?: UserPayload | null;
}

async function startServer() {
  try {
    // เชื่อมต่อ DB
    await sequelize.authenticate();
    console.log("Connection to the database has been established successfully.");
    
    //เชื่อมต่อ Kafka Producer
    await connectProducerAndRegisterSchemas();
    console.log("Kafka Producer connected and schemas registered.");

    //เชื่อมต่อ Kafka Consumer
    await connectAndStartConsumer();

    //สร้าง Apollo Server
    const server = new ApolloServer<MyContext>({
      typeDefs,
      resolvers,
    });

    //เริ่ม Apollo Server
    const { url } = await startStandaloneServer(server, {
      listen: { port: process.env.PORT_PRODUCT_SERVICE ? parseInt(process.env.PORT_PRODUCT_SERVICE) : 5002 },
      context: async ({ req }) => {
        const token = req.headers.authorization || '';
        const user = getUserFromToken(token);
        return { user: user };
      },
    });
    console.log(`🚀  Server ready at ${url}`);

  } catch (error) {
    console.error("Unable to start server:", error);
    process.exit(1);
  }
}

startServer();