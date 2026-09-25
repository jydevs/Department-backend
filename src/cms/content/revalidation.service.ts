import { createHmac } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";

const TIMEOUT_MS = 3000;

/** Tells the storefront to drop cached content. Best effort: it NEVER throws and is a no-op without a secret. */
@Injectable()
export class RevalidationService {
  private readonly logger = new Logger(RevalidationService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Call only AFTER the transaction committed. Safe to call without awaiting. */
  async notify(tags: string[]): Promise<void> {
    const secret = this.env.STOREFRONT_REVALIDATE_SECRET;
    if (!secret || tags.length === 0) return;
    try {
      const body = JSON.stringify({ tags });
      const signature = createHmac("sha256", secret).update(body).digest("hex");
      const url = new URL("/api/revalidate", this.env.STOREFRONT_URL).toString();
      for (let attempt = 0; attempt < 2; attempt++) {
        if (await this.post(url, body, signature)) return;
      }
      this.logger.warn(`Storefront revalidation failed for tags ${tags.join(",")}`);
    } catch (err) {
      this.logger.warn(`Storefront revalidation error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async post(url: string, body: string, signature: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": signature },
        body,
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
