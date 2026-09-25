import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { CartService } from "./cart.service";

const INTERVAL_MS = 60 * 60 * 1000;
const BATCH = 500;

/** Hourly in-process cleanup of expired carts (batches of 500, SKIP LOCKED: safe with several instances). */
@Injectable()
export class CartCleanupScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CartCleanupScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly carts: CartService) {}

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
      let total = 0;
      for (;;) {
        const n = await this.carts.purgeExpired(BATCH);
        total += n;
        if (n < BATCH) break;
      }
      if (total > 0) this.logger.log(`Deleted ${total} expired cart(s)`);
    } catch (err) {
      this.logger.error(`Cart cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
