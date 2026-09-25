import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { Clock } from "../common/clock/clock";

const INTERVAL_MS = 60 * 60 * 1000;
const BATCH = 500;
const TOKEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const UNVERIFIED_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Hourly in-process purge (batches of 500, SKIP LOCKED: safe with several instances). Phase 8 may move it.
 *  - one-time tokens used or expired more than 7 days ago;
 *  - accounts never verified after 48 h that have no orders and no addresses (their tokens and sessions cascade).
 */
@Injectable()
export class CustomersCleanupScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CustomersCleanupScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.clock.now().getTime();
      const tokens = await this.deleteInBatches(
        `SELECT id FROM customer_tokens
          WHERE (used_at IS NOT NULL AND used_at < $1) OR expires_at < $1
          ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        "customer_tokens",
        new Date(now - TOKEN_RETENTION_MS),
      );
      const customers = await this.deleteInBatches(
        `SELECT c.id FROM customers c
          WHERE c.email_verified_at IS NULL AND c.anonymized_at IS NULL AND c.created_at < $1
            AND NOT ('shopify-import' = ANY(c.tags)) -- imported guests are waiting for their reset e-mail
            AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)
            AND NOT EXISTS (SELECT 1 FROM customer_addresses a WHERE a.customer_id = c.id)
          ORDER BY c.id LIMIT $2 FOR UPDATE OF c SKIP LOCKED`,
        "customers",
        new Date(now - UNVERIFIED_TTL_MS),
      );
      if (tokens > 0 || customers > 0) this.logger.log(`Purged ${tokens} old token(s) and ${customers} unverified customer(s)`);
    } catch (err) {
      this.logger.error(`Customers cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /** `selectIds` and `table` are fixed constants from this file, never user input. */
  private async deleteInBatches(selectIds: string, table: "customer_tokens" | "customers", before: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await this.dataSource.query<{ n: number }[]>(
        `WITH d AS (DELETE FROM ${table} WHERE id IN (${selectIds}) RETURNING 1) SELECT count(*)::int AS n FROM d`,
        [before, BATCH],
      );
      const n = rows[0]?.n ?? 0;
      total += n;
      if (n < BATCH) return total;
    }
  }
}
