import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager, QueryRunner } from "typeorm";
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
  private readonly commitHooks = new WeakMap<QueryRunner, Array<() => void>>();

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Runs `hook` once the transaction that owns `manager` has COMMITTED (never on rollback or retry).
   * Outside a `run()` transaction it runs immediately. Hooks must not throw and must not await: fire and forget.
   */
  afterCommit(manager: EntityManager, hook: () => void): void {
    const hooks = manager.queryRunner ? this.commitHooks.get(manager.queryRunner) : undefined;
    if (hooks) hooks.push(hook);
    else hook();
  }

  async run<T>(
    fn: (manager: EntityManager) => Promise<T>,
    opts: { isolation?: IsolationLevel; retries?: number } = {},
  ): Promise<T> {
    const { isolation = "READ COMMITTED", retries = 3 } = opts;

    for (let attempt = 0; ; attempt++) {
      const hooks: Array<() => void> = [];
      try {
        const result = await this.dataSource.transaction(isolation, (manager) => {
          if (manager.queryRunner) this.commitHooks.set(manager.queryRunner, hooks);
          return fn(manager);
        });
        for (const hook of hooks) {
          try {
            hook();
          } catch {
            // a post-commit hook must never fail the request that already committed
          }
        }
        return result;
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
