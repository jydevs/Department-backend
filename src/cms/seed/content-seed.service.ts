import { Inject, Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { seedDefaultContent } from "./default-content";
import { ensureLegalLinks } from "./ensure-legal-links";

/**
 * Seeds the default site content on boot when SEED_DEFAULT_CONTENT=true (the default).
 * Additive and idempotent (never overwrites admin edits); a failure only logs a warning
 * (e.g. migrations not run yet) and never stops the API from starting.
 */
@Injectable()
export class ContentSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContentSeedService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.SEED_DEFAULT_CONTENT) return;
    try {
      await seedDefaultContent(this.dataSource, { logger: this.logger });
      await ensureLegalLinks(this.dataSource, { logger: this.logger });
    } catch (err) {
      this.logger.warn(`Default content was not seeded: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
