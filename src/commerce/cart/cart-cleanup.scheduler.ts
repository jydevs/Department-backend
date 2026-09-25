import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { CartService } from "./cart.service";

const INTERVAL_MS = 60 * 60 * 1000;
const BATCH = 500;
const PURGE_BATCH = 1000;
const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROCESSED_EVENTS_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Hourly in-process cleanup of expired carts (batches of 500, SKIP LOCKED: safe with several instances). */
@Injectable()
export class CartCleanupScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CartCleanupScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly carts: CartService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Deletes rows older than `before` in batches of 1000 (SKIP LOCKED); table/column are fixed constants, never user input. */
  private async purgeOld(table: "idempotency_keys" | "processed_events", column: "created_at" | "processed_at", before: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await this.dataSource.query<{ n: number }[]>(
        `WITH d AS (
           DELETE FROM ${table} WHERE id IN (
             SELECT id FROM ${table} WHERE ${column} < $1 ORDER BY ${column} ASC LIMIT $2 FOR UPDATE SKIP LOCKED
           ) RETURNING 1
         ) SELECT count(*)::int AS n FROM d`,
        [before, PURGE_BATCH],
      );
      const n = rows[0]?.n ?? 0;
      total += n;
      if (n < PURGE_BATCH) return total;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let total = 0;
      for (;;) {
        const n = await this.carts.purgeExpired(BATCH);
        total += n;
        if (n < BATCH) break;
      }
      if (total > 0) this.logger.log(`Deleted ${total} expired cart(s)`);

      const now = Date.now();
      const keys = await this.purgeOld("idempotency_keys", "created_at", new Date(now - IDEMPOTENCY_TTL_MS));
      const events = await this.purgeOld("processed_events", "processed_at", new Date(now - PROCESSED_EVENTS_TTL_MS));
      if (keys > 0 || events > 0) this.logger.log(`Purged ${keys} idempotency key(s) and ${events} processed event(s)`);
    } catch (err) {
      this.logger.error(`Cart cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
