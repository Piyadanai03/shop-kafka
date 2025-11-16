import Product from "../models/product.models";
import { sequelize } from "../config/db";
import {
  produceProductCreated,
  produceProductUpdated,
  produceProducerStockUpdated,
  produceProductDeleted,
} from "../kafka/producer";
import { MyContext } from "../index";
import { GraphQLError } from "graphql";

const ADMIN_ROLE_ID = "550e8400-e29b-41d4-a716-446655440000";

export const resolvers = {
  // --------------------
  // RESOLVERS FOR QUERIES
  // --------------------
  Query: {
    // (Query ไม่ต้องเช็คก็ได้ ให้ดูข้อมูลได้)
    product: async (_: any, { id }: { id: any }) => {
      try {
        const product = await Product.findByPk(id);
        return product ? product.toJSON() : null;
      } catch (err) {
        console.error("Error fetching product:", err);
        throw new Error("Failed to fetch product");
      }
    },
    products: async () => {
      try {
        const products = await Product.findAll();
        return products.map((p) => p.toJSON());
      } catch (err) {
        console.error("Error fetching products:", err);
        throw new Error("Failed to fetch products");
      }
    },
  },

  // --------------------
  // RESOLVERS FOR MUTATIONS
  // --------------------
  Mutation: {
    /**
     * สร้าง Product ใหม่
     */
    createProduct: async (
      _: any,
      { input }: { input: any },
      context: MyContext
    ) => {
      if (
        !context.user || // ไม่มี token
        context.user.role_id !== ADMIN_ROLE_ID // ไม่ใช่ admin
      ) {
        // โยน Error แบบ GraphQL
        throw new GraphQLError(
          "You are not authorized to perform this action",
          {
            extensions: { code: "UNAUTHORIZED" },
          }
        );
      }

      // (ถ้าผ่าน) ทำงาน logic เดิม
      const t = await sequelize.transaction();
      try {
        const createInput = {
          ...input,
          price: String(input.price),
        };
        const product = await Product.create(createInput, { transaction: t });

        const productData = product.toJSON();
        const kafkaPayload = {
          id: productData.id,
          sku: productData.sku,
          name: productData.name,
          price: parseFloat(productData.price),
          stock: productData.stock,
          created_at: productData.created_at?.toISOString(),
        };

        await produceProductCreated(kafkaPayload);
        await t.commit();
        return product.toJSON();
      } catch (err) {
        await t.rollback();
        console.error("Error creating product:", err);
        throw new Error("Failed to create product");
      }
    },

    /**
     * อัปเดตข้อมูล Product (ชื่อ, ราคา)
     */
    updateProduct: async (
      _: any,
      { id, input }: { id: any; input: any },
      context: MyContext
    ) => {
      if (!context.user || context.user.role_id !== ADMIN_ROLE_ID) {
        throw new GraphQLError(
          "You are not authorized to perform this action",
          {
            extensions: { code: "UNAUTHORIZED" },
          }
        );
      }

      // (ถ้าผ่าน) ทำงาน logic เดิม
      const t = await sequelize.transaction();
      try {
        const product = await Product.findByPk(id, { transaction: t });
        if (!product) {
          throw new Error("Product not found");
        }

        const updateData: any = { ...input };
        if (input.price !== null && input.price !== undefined) {
          updateData.price = String(input.price);
        }
        product.set(updateData);
        await product.save({ transaction: t });

        const productData = product.toJSON();
        const kafkaPayload = {
          id: productData.id,
          sku: productData.sku,
          name: productData.name,
          price: productData.price ? parseFloat(productData.price) : null,
          updated_at: productData.updated_at?.toISOString(),
        };
        await produceProductUpdated(kafkaPayload);

        await t.commit();
        return product.toJSON();
      } catch (err) {
        await t.rollback();
        console.error("Error updating product:", err);
        throw new Error("Failed to update product");
      }
    },

    /**
     * อัปเดตสต็อกสินค้า
     */
    updateStock: async (
      _: any,
      { sku, quantity }: { sku: any; quantity: number },
      context: MyContext
    ) => {
      if (!context.user || context.user.role_id !== ADMIN_ROLE_ID) {
        throw new GraphQLError(
          "You are not authorized to perform this action",
          {
            extensions: { code: "UNAUTHORIZED" },
          }
        );
      }

      // (ถ้าผ่าน) ทำงาน logic เดิม
      const t = await sequelize.transaction();
      try {
        const product = await Product.findOne({
          where: { sku },
          transaction: t,
        });
        if (!product) {
          throw new Error("Product not found");
        }

        const productDataBeforeUpdate = product.toJSON();
        const oldStock = productDataBeforeUpdate.stock;

        const newStock = oldStock + quantity;
        if (newStock < 0) {
          throw new Error("Insufficient stock");
        }

        product.set("stock", newStock);
        await product.save({ transaction: t });

        const productDataAfterUpdate = product.toJSON();

        await produceProducerStockUpdated({
          sku: productDataAfterUpdate.sku,
          old_stock: oldStock,
          new_stock: productDataAfterUpdate.stock,
          updated_at: productDataAfterUpdate.updated_at?.toISOString(),
        });

        await t.commit();
        return productDataAfterUpdate;
      } catch (err) {
        await t.rollback();
        console.error("Error updating stock:", err);
        throw new Error("Failed to update stock");
      }
    },

    deleteProduct: async (_: any, { id }: { id: any }, context: MyContext) => {
      if (!context.user || context.user.role_id !== ADMIN_ROLE_ID) {
        throw new GraphQLError(
          "You are not authorized to perform this action",
          {
            extensions: { code: "UNAUTHORIZED" },
          }
        );
      }
      const t = await sequelize.transaction();
      try {
        const product = await Product.findByPk(id, { transaction: t });
        if (!product) {
          throw new Error("Product not found");
        }
        const productData = product.toJSON();
        await product.destroy({ transaction: t });
        await produceProductDeleted({
          id: productData.id,
          sku: productData.sku,
          name: productData.name,
          deleted_at: new Date().toISOString(),
        });
        await t.commit();
        return true;
      } catch (err) {
        await t.rollback();
        console.error("Error deleting product:", err);
        throw new Error("Failed to delete product");
      }
    },
  },
};
