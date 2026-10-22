import { createHmac } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Clock } from "../../common/clock/clock";
import { AppException } from "../../common/errors/app-exception";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import type { Order } from "../entities";
import {
  ParsedTransaction,
  PaymentInstructions,
  PaymentProvider,
  PaymentStatus,
  VerifiedEvent,
  WebhookHeaders,
  parseWompiShapedTransaction,
  providerEventSchema,
} from "./payment-provider";
import { safeEqual } from "./safe-equal";

const DEV_SECRET = "dev-only-mock-events-secret";
export const MOCK_SIGNATURE_HEADER = "x-mock-signature";

/** Development / test provider: no gateway involved. Events are signed with HMAC-SHA256 over the raw body. */
@Injectable()
export class MockProvider implements PaymentProvider {
  readonly name = "mock" as const;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly clock: Clock,
  ) {}

  createPayment(order: Order): PaymentInstructions {
    this.assertNotProduction();
    return {
      provider: "mock",
      reference: order.paymentReference,
      amountInCents: order.total * 100,
      currency: order.currency,
      checkoutUrl: new URL(`/mock-checkout/${encodeURIComponent(order.paymentReference)}`, this.env.STOREFRONT_URL).toString(),
    };
  }

  verifyWebhook(headers: WebhookHeaders, rawBody: Buffer): VerifiedEvent | null {
    if (!this.isEnabled()) return null;
    const presented = headers[MOCK_SIGNATURE_HEADER];
    if (typeof presented !== "string") return null;
    if (!safeEqual(this.sign(rawBody), presented.toLowerCase())) return null;

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return null;
    }
    const parsed = providerEventSchema.safeParse(json);
    return parsed.success ? { provider: "mock", event: parsed.data } : null;
  }

  parseTransaction(event: VerifiedEvent): ParsedTransaction | null {
    return parseWompiShapedTransaction(event);
  }

  /** Builds a signed event exactly as the mock gateway would send it (used by the dev endpoint). */
  buildSignedEvent(order: Order, status: PaymentStatus): { rawBody: Buffer; headers: WebhookHeaders } {
    this.assertNotProduction();
    const now = this.clock.now().getTime();
    const body = {
      event: "transaction.updated",
      data: {
        transaction: {
          id: `mock-${order.paymentReference}`,
          reference: order.paymentReference,
          status: status.toUpperCase(),
          amount_in_cents: order.total * 100,
          currency: order.currency,
          payment_method_type: "MOCK",
        },
      },
      environment: "test",
      timestamp: Math.floor(now / 1000),
    };
    const rawBody = Buffer.from(JSON.stringify(body), "utf8");
    return { rawBody, headers: { [MOCK_SIGNATURE_HEADER]: this.sign(rawBody) } };
  }

  private sign(rawBody: Buffer): string {
    return createHmac("sha256", this.env.WOMPI_EVENTS_SECRET ?? DEV_SECRET).update(rawBody).digest("hex");
  }

  /** The mock only works outside production AND with the explicit MOCK_PAYMENTS_ENABLED opt-in. */
  isEnabled(): boolean {
    return this.env.NODE_ENV !== "production" && this.env.MOCK_PAYMENTS_ENABLED === true;
  }

  private assertNotProduction(): void {
    if (!this.isEnabled()) throw AppException.unavailable("The mock payment provider is disabled");
  }
}
