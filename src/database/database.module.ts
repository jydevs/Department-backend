import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ENV } from "../config/config.module";
import { Env } from "../config/env";
import { buildDbOptions } from "./db-options";
import { TransactionService } from "./transaction.service";

/**
 * PostgreSQL through TypeORM (options come from buildDbOptions, shared with the CLI).
 * - `synchronize` is ALWAYS off: schema changes ship as migrations.
 * - feature modules register their entities with `TypeOrmModule.forFeature([...])`.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ ...buildDbOptions(env), autoLoadEntities: true }),
    }),
  ],
  providers: [TransactionService],
  exports: [TransactionService],
})
export class DatabaseModule {}
