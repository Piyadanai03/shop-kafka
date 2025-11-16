import { gql } from 'graphql-tag';

export const typeDefs = gql`

  # (นิยามหน้าตาของข้อมูล Product)
  type Product {
    id: ID!
    sku: String!
    name: String!
    price: Float!
    stock: Int!
    created_at: String!
    updated_at: String!
  }

  # (นิยามข้อมูลสำหรับ "สร้าง" Product)
  input CreateProductInput {
    sku: String!
    name: String!
    price: Float!
    stock: Int
  }

  # (นิยามข้อมูลสำหรับ "อัปเดต" Product)
  input UpdateProductInput {
    name: String
    price: Float
  }

  # (นิยาม API สำหรับ "ดึง" ข้อมูล)
  type Query {
    # ดึง Product 1 ชิ้นโดยใช้ ID
    product(id: ID!): Product

    # ดึง Product ทั้งหมด
    products: [Product!]!
  }

  type Mutation {
    # สร้าง Product ใหม่
    createProduct(input: CreateProductInput!): Product!

    # อัปเดตข้อมูล Product (เช่น ชื่อ, ราคา)
    updateProduct(id: ID!, input: UpdateProductInput!): Product

    # อัปเดตสต็อกสินค้า (แยกมาเพื่อความชัดเจน)
    updateStock(sku: String!, quantity: Int!): Product

    # ลบ Product โดยใช้ ID
    deleteProduct(id: ID!): Boolean!
  }
`;