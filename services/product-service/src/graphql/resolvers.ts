import { Product, Inventory, sequelize } from "../models/index.js";
import {
  produceProductCreated,
  produceProductUpdated,
  produceProductDeleted,
  produceProducerStockUpdated,
} from "../kafka/producer.js";
import { MyContext } from "../index.js";
import { GraphQLError } from "graphql";

// ID ของ Admin Role
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
          include: [{ model: Inventory, required: false }],
        });

        if (!product) return null;

        const p = product.toJSON() as any;
        
        // Logic ป้องกัน Null (Safe Access)
        let stockVal = 0;
        if (p.Inventory && p.Inventory.available !== undefined && p.Inventory.available !== null) {
            stockVal = p.Inventory.available;
        }

        return {
          ...p,
          stock: stockVal,
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
          include: [{ model: Inventory, required: false }], 
        });

        return products.map((product: any) => {
          const p = product.toJSON();
          
          // Logic ป้องกัน Null (Safe Access)
          let stockVal = 0;
          // ตรวจสอบว่ามี object Inventory และมีค่า available หรือไม่
          if (p.Inventory && p.Inventory.available !== undefined && p.Inventory.available !== null) {
             stockVal = p.Inventory.available;
          }

          return {
            ...p,
            stock: stockVal, // รับประกันว่าเป็น Int แน่นอน ไม่ใช่ Null
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
     */
    createProduct: async (
      _: any,
      { input }: { input: any },
      context: MyContext
    ) => {
      // Check Auth
      if (!context.user || context.user.role_id !== ADMIN_ROLE_ID) {
        throw new GraphQLError("You are not authorized to perform this action", {
          extensions: { code: "UNAUTHORIZED" },
        });
      }

      const t = await sequelize.transaction();
      try {
        // แยกข้อมูล: Product ไม่เอา stock, Inventory เอาแค่ stock
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

        // เตรียมข้อมูลสำหรับ Kafka
        const productData = product.toJSON() as any;
        const kafkaPayload = {
          id: productData.id,
          sku: productData.sku,
          name: productData.name,
          price: parseFloat(productData.price),
          stock: stock || 0,
          created_at: productData.created_at?.toISOString(),
        };

        await produceProductCreated(kafkaPayload);

        await t.commit();

        // คืนค่ากลับไป
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

        // อัปเดตแค่ Product
        await product.update(input, { transaction: t });

        const productData = product.toJSON() as any;
        // อ่าน Stock ปัจจุบันเพื่อส่งกลับ (ถ้าไม่มีให้เป็น 0)
        const currentStock = (productData.Inventory && productData.Inventory.available) || 0;

        // Kafka
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
     * ลบสินค้า
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
           await t.rollback(); // ไม่จำเป็นต้อง rollback ถ้าไม่ได้ทำอะไร แต่ใส่ไว้กันเหนียว
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
     * เติมสต็อก (Update Stock) - อัปเดตที่ Inventory โดยตรง
     */
    updateStock: async (
        _: any,
        { sku, quantity }: { sku: string; quantity: number },
        context: MyContext
    ) => {
        if (!context.user || context.user.role_id !== ADMIN_ROLE_ID) {
            throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
        }

        const t = await sequelize.transaction();
        try {
            const inventory = await Inventory.findOne({ 
                where: { sku }, 
                transaction: t 
            });

            if (!inventory) {
                throw new Error("Product inventory not found");
            }

            const oldStock = inventory.available;
            
            // บวกสต็อกเพิ่ม
            inventory.available += quantity;
            
            if (inventory.available < 0) {
                throw new Error("Stock cannot be negative");
            }

            await inventory.save({ transaction: t });

            // หา Product เพื่อส่งข้อมูลกลับ
            const product = await Product.findOne({ where: { sku }, transaction: t });

            // Kafka Event
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