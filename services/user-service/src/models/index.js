import User from "./user.model.js";
import Role from "./role.model.js";

// Associations
User.belongsTo(Role, { foreignKey: "role_id" });
Role.hasMany(User, { foreignKey: "role_id" });

export { User, Role };