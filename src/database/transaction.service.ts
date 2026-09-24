import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { AppException } from "../common/errors/app-exception";

export type IsolationLevel = "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";

/** SQLSTATEs that mean "run the whole transaction again": serialization failure, deadlock. */
const RETRYABLE = new Set(["40001", "40P01"]);

const sqlState = (e: unknown): string | undefined => (e as { driverError?: { code?: string } })?.driverError?.code;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The only way money / stock code should open a transaction.
 *
 *   await tx.run(async (m) => { …use `m` for EVERY query… }, { isolation: "SERIALIZABLE" });
 *
 * Retries the whole callback on deadlocks / serialization failures (with jitter), so the callback
 * must be safe to re-execute (no external side effects inside: enqueue jobs AFTER commit).
 */
@Injectable()
export class TransactionService {
  constructor(private readonly dataSource: DataSource) {}

  async run<T>(
    fn: (manager: EntityManager) => Promise<T>,
    opts: { isolation?: IsolationLevel; retries?: number } = {},
  ): Promise<T> {
    const { isolation = "READ COMMITTED", retries = 3 } = opts;

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.dataSource.transaction(isolation, fn);
      } catch (err) {
        const code = sqlState(err);
        if (code && RETRYABLE.has(code)) {
          if (attempt >= retries) throw AppException.conflict("CONCURRENT_UPDATE", "The resource was modified concurrently, please retry");
          await sleep(20 * 2 ** attempt + Math.random() * 30);
          continue;
        }
        throw err;
      }
    }
  }
}
