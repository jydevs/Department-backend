import { timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerRequest } from "@nestjs/throttler";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";

/** Tracker of the Next.js server's own reads (valid X-Storefront-Key, no X-Visitor-Ip): SSR/ISR fetches that are not tied to one visitor. */
const SERVER_READS = "server:reads";
/** Requests per window for that tracker. Mutations (login, checkout, forgot…) never get it: they keep the normal limits. */
export const SERVER_READS_LIMIT = 3000;

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

  protected async getTracker(req: { ip?: string; method?: string; headers?: Record<string, string | string[] | undefined> }): Promise<string> {
    const key = this.env.STOREFRONT_SERVER_KEY;
    const presented = req.headers?.["x-storefront-key"];
    const visitor = req.headers?.["x-visitor-ip"];
    if (key && typeof presented === "string" && safeEqual(presented, key) && typeof visitor === "string" && visitor.length <= 64) {
      return `visitor:${visitor}`;
    }
    // the Next server reading catalog/CMS on its own: its own, much larger bucket (GET only; a mutation keeps the per-IP limits)
    if (key && typeof presented === "string" && safeEqual(presented, key) && req.method === "GET") return SERVER_READS;
    return req.ip ?? "unknown";
  }

  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const req = this.getRequestResponse(props.context).req as { ip?: string; method?: string; headers?: Record<string, string | string[] | undefined> };
    if ((await this.getTracker(req)) === SERVER_READS) return super.handleRequest({ ...props, limit: Math.max(props.limit, SERVER_READS_LIMIT) });
    return super.handleRequest(props);
  }
}
