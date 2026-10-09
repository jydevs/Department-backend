import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Clock } from "../../common/clock/clock";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { OrdersLifecycleService } from "./orders-lifecycle.service";

const INTERVAL_MS = 60_000;
const BATCH = 100;

/** Expires unpaid orders (releasing their reserved stock) every minute. Safe with several instances (SKIP LOCKED). */
@Injectable()
export class OrdersScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly lifecycle: OrdersLifecycleService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (this.env.NODE_ENV === "test" && process.env.ORDERS_SCHEDULER_ENABLED === "false") return;
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
      // drain in batches until nothing is left (bounded per tick)
      for (let i = 0; i < 10; i++) {
        const n = await this.lifecycle.expirePending(this.clock.now(), BATCH);
        if (n > 0) this.logger.log(`Expired ${n} unpaid order(s)`);
        if (n < BATCH) break;
      }
    } catch (err) {
      this.logger.error(`Orders scheduler tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
