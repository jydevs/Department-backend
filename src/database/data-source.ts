import "reflect-metadata";
import { DataSource } from "typeorm";
import { loadDotEnv, loadEnv } from "../config/env";
import { buildDbOptions } from "./db-options";

loadDotEnv();

/**
 * DataSource used ONLY by the TypeORM CLI (`yarn migration:*`). It validates the
 * environment with the same schema as the app and builds options through the same
 * function, so a bad DATABASE_URL / SSL setting fails here with a readable message.
 */
export default new DataSource(buildDbOptions(loadEnv()));
