import { join } from "node:path";
import type { DataSourceOptions } from "typeorm";
type PostgresConnectionOptions = Extract<DataSourceOptions, { type: "postgres" }>;
import type { Env } from "../config/env";
import { SnakeNamingStrategy } from "./snake-naming.strategy";

/** `.ts` under ts-node / the CLI, `.js` from the compiled build. */
const ext = __filename.endsWith(".ts") ? "ts" : "js";

function ssl(env: Env): PostgresConnectionOptions["ssl"] {
  switch (env.DATABASE_SSL) {
    case "disable":
      return false;
    case "require":
      return { rejectUnauthorized: false }; // encrypted, certificate NOT verified
    case "verify-full":
      return { rejectUnauthorized: true, ...(env.DATABASE_CA_CERT ? { ca: env.DATABASE_CA_CERT } : {}) };
  }
}

/**
 * The ONE place that builds connection options: the running app (DatabaseModule)
 * and the TypeORM CLI (data-source.ts) share it so they can never drift apart.
 */
export function buildDbOptions(env: Env): PostgresConnectionOptions {
  return {
    type: "postgres",
    url: env.DATABASE_URL,
    ssl: ssl(env),
    applicationName: "department-api",
    connectTimeoutMS: 5_000, // fail fast instead of hanging when the DB is down
    poolSize: env.DATABASE_POOL_MAX,
    namingStrategy: new SnakeNamingStrategy(),
    entities: [join(__dirname, "..", "**", `*.entity.${ext}`)],
    migrations: [join(__dirname, "migrations", `*.${ext}`)],
    synchronize: false,
    migrationsRun: false,
    logging: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    extra: {
      // Session-level guards. Behind a transaction-mode pooler (Neon/Supabase) set them on the ROLE instead.
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 60_000,
      idleTimeoutMillis: 30_000,
    },
  };
}
