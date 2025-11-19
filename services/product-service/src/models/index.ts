import { sequelize } from "../config/db.js";
import Product from "./product.models.js";
import Inventory from "./inventory.model.js";

// Relations
Product.hasOne(Inventory, { foreignKey: 'sku', sourceKey: 'sku' });
Inventory.belongsTo(Product, { foreignKey: 'sku', targetKey: 'sku' });

export { sequelize, Product, Inventory };