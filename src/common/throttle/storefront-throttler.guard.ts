import { timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Rate-limit per real visitor. Server-side rendering makes ALL storefront traffic arrive from the
 * Next.js host, so limiting by socket IP would throttle the whole site as one client. When the Next server
 * presents STOREFRONT_SERVER_KEY it may forward the visitor IP in `X-Visitor-Ip`; nobody else can.
 */
@Injectable()
export class StorefrontThrottlerGuard extends ThrottlerGuard {
  @Inject(ENV) private readonly env!: Env;

  protected async getTracker(req: { ip?: string; headers?: Record<string, string | string[] | undefined> }): Promise<string> {
    const key = this.env.STOREFRONT_SERVER_KEY;
    const presented = req.headers?.["x-storefront-key"];
    const visitor = req.headers?.["x-visitor-ip"];
    if (key && typeof presented === "string" && safeEqual(presented, key) && typeof visitor === "string" && visitor.length <= 64) {
      return `visitor:${visitor}`;
    }
    return req.ip ?? "unknown";
  }
}
