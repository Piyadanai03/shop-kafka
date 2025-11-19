import { Product, Inventory, sequelize } from "../models/index.js";
import {
  produceProductCreated,
  produceProductUpdated,
  produceProductDeleted,
  produceProducerStockUpdated,
} from "../kafka/producer.js";
import { MyContext } from "../index.js";
import { GraphQLError } from "graphql";


const ADMIN_ROLE_ID = "550e8400-e29b-41d4-a716-446655440000";

export const resolvers = {
  // --------------------
  // RESOLVERS FOR QUERIES
  // --------------------
  Query: {
    // ดึงสินค้าชิ้นเดียว
    product: async (_: any, { id }: { id: string }) => {
      try {
        const product = await Product.findByPk(id, {
          include: [{ model: Inventory }], // Join กับ Inventory
        });

        if (!product) return null;

        const p = product.toJSON() as any;
        return {
          ...p,
          // อ่านสต็อกใหม่จาก Inventory.available
          stock: product.dataValues.Inventory ? product.dataValues.Inventory.available : 0,
        };
      } catch (err) {
        console.error("Error fetching product:", err);
        throw new Error("Failed to fetch product");
      }
    },

    // ดึงสินค้าทั้งหมด
    products: async () => {
      try {
        const products = await Product.findAll({
          include: [{ model: Inventory }], // Join กับ Inventory
        });

        return products.map((product: any) => {
          const p = product.toJSON();
          return {
            ...p,
            // อ่านสต็อกใหม่จาก Inventory.available
            stock: product.Inventory ? product.Inventory.available : 0,
          };
        });
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
     * สร้าง Product ใหม่ (Admin Only)
     * ต้อง Insert ลงทั้งตาราง Products และ Inventory
     */
    createProduct: async (
      _: any,
      { input }: { input: any },
      context: MyContext
    ) => {
      // 1. Check Auth
      if (!context.user || context.user.role_id !== ADMIN_ROLE_ID) {
        throw new GraphQLError("You are not authorized to perform this action", {
          extensions: { code: "UNAUTHORIZED" },
        });
      }

      const t = await sequelize.transaction();
      try {
        const { stock, ...productInput } = input;
        
        // สร้าง Product
        const product = await Product.create(productInput, { transaction: t });

        // สร้าง Inventory
        await Inventory.create(
          {
            sku: product.sku,
            available: stock || 0,
            reserved: 0,
          },
          { transaction: t }
        );

        //เตรียมข้อมูลสำหรับ Kafka (แปลงเป็น Format ที่ถูกต้อง)
        const productData = product.toJSON() as any;
        const kafkaPayload = {
          id: productData.id,
          sku: productData.sku,
          name: productData.name,
          price: parseFloat(productData.price), // แปลงเป็น number
          stock: stock || 0,
          created_at: productData.created_at?.toISOString(),
        };

        await produceProductCreated(kafkaPayload);

        await t.commit();

        //คืนค่ากลับไป (รวมร่าง Product + Stock)
        return {
          ...productData,
          stock: stock || 0,
        };
      } catch (err) {
        await t.rollback();
        console.error("Error creating product:", err);
        throw new Error("Failed to create product");
      }
    },

    /**
     * อัปเดตข้อมูล Product (ชื่อ, ราคา)
     * 
     */
    updateProduct: async (
      _: any,
      { id, input }: { id: string; input: any },
      context: MyContext
    ) => {
      if (!context.user || context.user.role_id !== ADMIN_ROLE_ID) {
        throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
      }

      const t = await sequelize.transaction();
      try {
        const product = await Product.findByPk(id, { 
            transaction: t,
            include: [{ model: Inventory }] 
        });
        
        if (!product) {
          throw new Error("Product not found");
        }

        // อัปเดตแค่ Product (ชื่อ, ราคา)
        await product.update(input, { transaction: t });

        // เตรียมข้อมูลส่ง Kafka
        const productData = product.toJSON() as any;
        const currentStock = product.dataValues.Inventory?.available || 0;

        const kafkaPayload = {
          id: productData.id,
          sku: productData.sku,
          name: productData.name,
          price: parseFloat(productData.price),
          updated_at: new Date().toISOString(),
        };
        
        await produceProductUpdated(kafkaPayload);

        await t.commit();

        return {
            ...productData,
            stock: currentStock
        };
      } catch (err) {
        await t.rollback();
        console.error("Error updating product:", err);
        throw new Error("Failed to update product");
      }
    },

    /**
     * ลบสินค้า (Admin Only)
     * 
     */
    deleteProduct: async (
      _: any,
      { id }: { id: string },
      context: MyContext
    ) => {
      if (!context.user || context.user.role_id !== ADMIN_ROLE_ID) {
        throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
      }

      const t = await sequelize.transaction();
      try {
        const product = await Product.findByPk(id, { transaction: t });
        if (!product) {
           await t.rollback();
           throw new Error("Product not found");
        }

        const productData = product.toJSON() as any;
        await product.destroy({ transaction: t });

        await produceProductDeleted({
          id: productData.id,
          sku: productData.sku,
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

    /**
     * 
     * อัปเดตที่ตาราง Inventory
     */
    updateStock: async (
        _: any,
        { sku, qty }: { sku: string; qty: number },
        context: MyContext
    ) => {
        if (!context.user || context.user.role_id !== ADMIN_ROLE_ID) {
            throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
        }

        const t = await sequelize.transaction();
        try {
            // 1. หา Inventory
            const inventory = await Inventory.findOne({ 
                where: { sku }, 
                transaction: t 
            });

            if (!inventory) {
                throw new Error("Product inventory not found");
            }

            const oldStock = inventory.available;
            
            // 2. บวกสต็อกเพิ่ม (หรือลด ถ้า qty เป็นลบ)
            inventory.available += qty;
            
            // ป้องกันสต็อกติดลบ (Optional)
            if (inventory.available < 0) {
                throw new Error("Stock cannot be negative");
            }

            await inventory.save({ transaction: t });

            // 3. หา Product เพื่อส่งข้อมูลกลับ
            const product = await Product.findOne({ where: { sku }, transaction: t });

            // 4. ส่ง Event แจ้งว่าสต็อกเปลี่ยน (ถ้ามี Consumer รอฟัง)
            await produceProducerStockUpdated({
                sku: sku,
                old_stock: oldStock,
                new_stock: inventory.available,
                updated_at: new Date().toISOString()
            });

            await t.commit();

            return {
                ...product?.toJSON(),
                stock: inventory.available
            };

        } catch (err: any) {
            await t.rollback();
            console.error("Error updating stock:", err);
            throw new Error(err.message || "Failed to update stock");
        }
    }
  },
};