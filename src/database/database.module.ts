import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ENV } from "../config/config.module";
import { Env } from "../config/env";
import { SnakeNamingStrategy } from "./snake-naming.strategy";

/**
 * PostgreSQL through TypeORM.
 * - `synchronize` is ALWAYS off: schema changes ship as migrations (`yarn migration:generate`).
 * - entities are registered by each feature module via `TypeOrmModule.forFeature([...])`.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        type: "postgres" as const,
        url: env.DATABASE_URL,
        ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
        namingStrategy: new SnakeNamingStrategy(),
        poolSize: env.DATABASE_POOL_MAX,
        logging: env.NODE_ENV === "development" ? (["error", "warn"] as const).slice() : (["error"] as const).slice(),
        // long-running queries must not hold a connection forever
        extra: { statement_timeout: 30_000, idle_in_transaction_session_timeout: 60_000 },
      }),
    }),
  ],
})
export class DatabaseModule {}
