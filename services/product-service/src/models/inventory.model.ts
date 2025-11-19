import { DataTypes, Model } from "sequelize";
import { sequelize } from "../config/db.js";

class Inventory extends Model {
  available: any;
}

Inventory.init(
  {
    sku: { type: DataTypes.TEXT, primaryKey: true },
    available: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 0 },
    },
    reserved: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: { min: 0 },
    },
  },
  {
    sequelize,
    tableName: "inventory",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
);
export default Inventory;
