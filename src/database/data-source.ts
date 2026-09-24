import "reflect-metadata";
import { join } from "node:path";
import { DataSource } from "typeorm";
import { loadDotEnv } from "../config/env";
import { SnakeNamingStrategy } from "./snake-naming.strategy";

loadDotEnv();

/**
 * DataSource used ONLY by the TypeORM CLI (`yarn migration:*`).
 * The running app builds its own connection in DatabaseModule.
 */
export default new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  entities: [join(__dirname, "..", "**", "*.entity.{ts,js}")],
  migrations: [join(__dirname, "migrations", "*.{ts,js}")],
  namingStrategy: new SnakeNamingStrategy(),
});
