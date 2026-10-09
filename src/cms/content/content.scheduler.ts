import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { ContentService } from "./content.service";

const INTERVAL_MS = 30_000;

/** In-process poller that publishes due scheduled versions. Safe with several instances (SKIP LOCKED) and idempotent. */
@Injectable()
export class ContentScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContentScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly content: ContentService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    // Only tests may switch it off (CONTENT_SCHEDULER_ENABLED=false); everywhere else it always runs.
    if (this.env.NODE_ENV === "test" && process.env.CONTENT_SCHEDULER_ENABLED === "false") return;
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return; // never overlap with a slow previous run
    this.running = true;
    try {
      const n = await this.content.promoteDue();
      if (n > 0) this.logger.log(`Published ${n} scheduled content version(s)`);
    } catch (err) {
      this.logger.error(`Content scheduler tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
