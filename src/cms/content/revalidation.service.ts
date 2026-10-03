import { createHmac } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";

const TIMEOUT_MS = 3000;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;
/** Limits of the storefront receiver (src/app/api/revalidate/route.ts): at most 50 tags per call, each up to 100 characters. */
export const MAX_TAGS_PER_CALL = 50;
export const MAX_TAG_LENGTH = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tells the storefront to drop cached content. Best effort: it NEVER throws and is a no-op without a secret. */
@Injectable()
export class RevalidationService {
  private readonly logger = new Logger(RevalidationService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Deduplicates, drops tags the receiver would reject and sends them in as few calls as its limit allows. Same guarantees as `notify`. */
  async notifyMany(tags: Iterable<string>): Promise<void> {
    const unique = [...new Set(tags)].filter((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH);
    for (let i = 0; i < unique.length; i += MAX_TAGS_PER_CALL) {
      await this.notify(unique.slice(i, i + MAX_TAGS_PER_CALL));
    }
  }

  /** Call only AFTER the transaction committed. Safe to call without awaiting. */
  async notify(tags: string[]): Promise<void> {
    const secret = this.env.STOREFRONT_REVALIDATE_SECRET;
    if (!secret || tags.length === 0) return;
    try {
      // `ts` lives inside the signed body so the receiver can reject replays of old requests.
      const url = new URL("/api/revalidate", this.env.STOREFRONT_URL).toString();
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);
        const body = JSON.stringify({ tags, ts: Date.now() });
        const signature = createHmac("sha256", secret).update(body).digest("hex");
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
        redirect: "manual",
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
