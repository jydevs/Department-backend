import { readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { Clock } from "../common/clock/clock";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { CustomerErasureService } from "../customers/customer-erasure.service";
import { queryRows } from "../customers/customers-support";

const INTERVAL_MS = 60 * 60 * 1000;
const BATCH = 1000;
const ORDER_BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Arbitrary constant identifying "the maintenance job" for pg advisory locks (shared by every instance). */
const ADVISORY_LOCK_KEY = 8_042_001;
const MAX_LOOPS = 1000;

export interface MaintenanceTaskResult {
  task: string;
  affected: number;
  error?: string;
}

export interface MaintenanceSummary {
  /** false when another instance already holds the lock (nothing was executed here). */
  executed: boolean;
  tasks: MaintenanceTaskResult[];
}

interface CountRow {
  n: number;
}

/**
 * Hourly housekeeping. Only ONE instance runs a pass at a time: a dedicated connection takes
 * the session lock `pg_try_advisory_lock` (released in `finally`, or by Postgres if the connection dies: no lock can leak).
 * Every task is isolated (a failure is logged and the rest still run) and deletes in batches of 1000 with LIMIT.
 *
 * Already handled elsewhere (NOT duplicated here): `customer_tokens` and unverified customers (CustomersCleanupScheduler),
 * `idempotency_keys` and `processed_events` (CartCleanupScheduler), expired carts (same), stock reservations (OrdersScheduler).
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly erasure: CustomerErasureService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.run().catch(() => undefined), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One full pass. Safe to call concurrently: a second call in this process or in another instance is a no-op. */
  async run(): Promise<MaintenanceSummary> {
    if (this.running) return { executed: false, tasks: [] };
    this.running = true;
    const runner = this.dataSource.createQueryRunner();
    let locked = false;
    try {
      await runner.connect();
      // Session-level lock on a dedicated connection, NOT inside a transaction: an open transaction would sit
      // "idle in transaction" while the tasks run on other connections and Postgres would kill it after 60 s.
      const lock = await queryRows<{ locked: boolean }>(runner, "SELECT pg_try_advisory_lock($1) AS locked", [ADVISORY_LOCK_KEY]);
      if (!lock[0]?.locked) return { executed: false, tasks: [] };
      locked = true;
      const tasks = await this.runTasks();
      return { executed: true, tasks };
    } catch (err) {
      this.logger.error(`Maintenance pass failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      // if this connection dies Postgres drops the session lock, so it cannot leak
      if (locked) await runner.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => undefined);
      await runner.release().catch(() => undefined);
      this.running = false;
    }
  }

  private async runTasks(): Promise<MaintenanceTaskResult[]> {
    const now = this.clock.now().getTime();
    const ago = (days: number) => new Date(now - days * DAY_MS);
    const jobs: Array<[string, () => Promise<number>]> = [
      ["refresh_tokens", () => this.purgeRefreshTokens("refresh_tokens", ago(30))],
      ["customer_refresh_tokens", () => this.purgeRefreshTokens("customer_refresh_tokens", ago(30))],
      ["email_outbox.purge", () => this.purgeOutbox(ago(30))],
      ["email_outbox.blank_bodies", () => this.blankOutboxBodies(ago(7))],
      ["content_versions", () => this.purgeContentVersions()],
      ["import_jobs", () => this.purgeImportJobs(ago(180))],
      ["orders.anonymize_closed", () => this.anonymizeOrders()],
    ];

    const results: MaintenanceTaskResult[] = [];
    for (const [task, fn] of jobs) {
      try {
        const affected = await fn();
        if (affected > 0) this.logger.log(`${task}: ${affected} row(s)`);
        results.push({ task, affected });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`${task} failed: ${message}`);
        results.push({ task, affected: 0, error: message });
      }
    }
    return results;
  }

  /** Runs a batch statement (must return one `n` row = rows affected) until a batch comes back short. */
  private async loop(sql: string, params: unknown[]): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_LOOPS; i++) {
      const rows = await this.dataSource.query<CountRow[]>(sql, params);
      const n = rows[0]?.n ?? 0;
      total += n;
      if (n < BATCH) break;
    }
    return total;
  }

  /** Expired or revoked more than 30 days ago. `table` is one of two fixed constants, never input. */
  private purgeRefreshTokens(table: "refresh_tokens" | "customer_refresh_tokens", before: Date): Promise<number> {
    return this.loop(
      `WITH d AS (
         DELETE FROM ${table} WHERE id IN (
           SELECT id FROM ${table} WHERE expires_at < $1 OR revoked_at < $1 ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED
         ) RETURNING 1
       ) SELECT count(*)::int AS n FROM d`,
      [before, BATCH],
    );
  }

  private purgeOutbox(before: Date): Promise<number> {
    return this.loop(
      `WITH d AS (
         DELETE FROM email_outbox WHERE id IN (
           SELECT id FROM email_outbox WHERE status IN ('sent', 'failed') AND created_at < $1 ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED
         ) RETURNING 1
       ) SELECT count(*)::int AS n FROM d`,
      [before, BATCH],
    );
  }

  /** Finished messages don't need their rendered body (it can hold reset links / personal data). Pending rows keep it. */
  private blankOutboxBodies(before: Date): Promise<number> {
    return this.loop(
      `WITH u AS (
         UPDATE email_outbox SET body_html = '', body_text = '' WHERE id IN (
           SELECT id FROM email_outbox
            WHERE status IN ('sent', 'failed') AND created_at < $1 AND (body_html <> '' OR body_text <> '')
            ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED
         ) RETURNING 1
       ) SELECT count(*)::int AS n FROM u`,
      [before, BATCH],
    );
  }

  /** Keeps the 100 most recent cancelled|superseded versions of each document; published and scheduled ones are never touched. */
  private purgeContentVersions(): Promise<number> {
    return this.loop(
      `WITH d AS (
         DELETE FROM content_versions WHERE id IN (
           SELECT id FROM (
             SELECT id, row_number() OVER (PARTITION BY document_id ORDER BY number DESC) AS rn
               FROM content_versions WHERE status IN ('cancelled', 'superseded')
           ) ranked WHERE rn > 100 LIMIT $1
         ) RETURNING 1
       ) SELECT count(*)::int AS n FROM d`,
      [BATCH],
    );
  }

  /** `import_jobs` is created by the importer (Phase 8): tolerate its absence. Finished jobs only; the stored CSV goes too. */
  private async purgeImportJobs(before: Date): Promise<number> {
    const exists = await this.dataSource.query<{ t: string | null }[]>("SELECT to_regclass('import_jobs') AS t");
    if (!exists[0]?.t) return 0;

    const dir = resolve(this.env.UPLOAD_DIR, "imports");
    let total = 0;
    for (let i = 0; i < MAX_LOOPS; i++) {
      const rows = await queryRows<{ id: string }>(
        this.dataSource,
        `DELETE FROM import_jobs WHERE id IN (
           SELECT id FROM import_jobs WHERE status IN ('done', 'failed', 'cancelled') AND created_at < $1 ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED
         ) RETURNING id`,
        [before, BATCH],
      );
      await this.removeImportFiles(dir, rows.map((r) => r.id));
      total += rows.length;
      if (rows.length < BATCH) break;
    }
    return total;
  }

  /** The CSV is stored under the job id (any extension); ids are uuids from our own table, never user input. */
  private async removeImportFiles(dir: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return; // no imports directory: nothing to delete
    }
    const wanted = new Set(ids);
    for (const name of names) {
      const stem = name.split(".")[0] ?? "";
      if (!wanted.has(stem)) continue;
      try {
        await rm(join(dir, name), { force: true });
      } catch (err) {
        this.logger.warn(`Could not delete import file ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async anonymizeOrders(): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_LOOPS; i++) {
      const n = await this.erasure.anonymizeClosedTaggedOrders(ORDER_BATCH);
      total += n;
      if (n < ORDER_BATCH) break;
    }
    return total;
  }
}
