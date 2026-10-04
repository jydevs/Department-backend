import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AppException } from "../../common/errors/app-exception";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import type { Order } from "../entities";
import {
  checkoutResultUrl,
  ParsedTransaction,
  PaymentInstructions,
  PaymentProvider,
  ProviderEvent,
  VerifiedEvent,
  WebhookHeaders,
  parseWompiShapedTransaction,
  providerEventSchema,
} from "./payment-provider";
import { safeEqual } from "./safe-equal";

const signedEventSchema = providerEventSchema.extend({
  signature: z.object({
    properties: z.array(z.string().min(1).max(100)).min(1).max(20),
    checksum: z.string().min(1).max(128),
  }),
});

/** The checksum must cover what we act on; otherwise a signed but unrelated payload could be replayed. */
const REQUIRED_PROPERTIES = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];

const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Walks `a.b.c` over nested objects; only scalar leaves are accepted. */
function valueAtPath(data: Record<string, unknown>, path: string): string | null {
  let current: unknown = data;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return null;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") return String(current);
  return null;
}

@Injectable()
export class WompiProvider implements PaymentProvider {
  readonly name = "wompi" as const;

  constructor(@Inject(ENV) private readonly env: Env) {}

  createPayment(order: Order): PaymentInstructions {
    const integritySecret = this.env.WOMPI_INTEGRITY_SECRET;
    const publicKey = this.env.WOMPI_PUBLIC_KEY;
    if (!integritySecret || !publicKey) throw AppException.unavailable("Payments are not configured");

    const amountInCents = order.total * 100;
    return {
      provider: "wompi",
      reference: order.paymentReference,
      amountInCents,
      currency: order.currency,
      publicKey,
      signatureIntegrity: sha256Hex(`${order.paymentReference}${amountInCents}${order.currency}${integritySecret}`),
      // The order NUMBER (not the access token) travels through the gateway; the storefront reads its own saved token.
      redirectUrl: checkoutResultUrl(this.env.STOREFRONT_URL, order.orderNumber),
    };
  }

  verifyWebhook(_headers: WebhookHeaders, rawBody: Buffer): VerifiedEvent | null {
    const secret = this.env.WOMPI_EVENTS_SECRET;
    if (!secret) return null;

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return null;
    }
    const parsed = signedEventSchema.safeParse(json);
    if (!parsed.success) return null;
    const { signature, ...envelope } = parsed.data;

    if (!REQUIRED_PROPERTIES.every((p) => signature.properties.includes(p))) return null;
    if (!this.environmentMatches(envelope.environment)) return null;

    const parts: string[] = [];
    for (const property of signature.properties) {
      const value = valueAtPath(envelope.data, property);
      if (value === null) return null;
      parts.push(value);
    }
    if (envelope.timestamp === undefined) return null;
    const expected = sha256Hex(`${parts.join("")}${envelope.timestamp}${secret}`);
    if (!safeEqual(expected, signature.checksum.toLowerCase())) return null;

    const event: ProviderEvent = envelope;
    return { provider: "wompi", event };
  }

  parseTransaction(event: VerifiedEvent): ParsedTransaction | null {
    return parseWompiShapedTransaction(event);
  }

  /** `pub_test_…` keys only accept `test` events and `pub_prod_…` only `prod`, when Wompi tells us the environment. */
  private environmentMatches(environment: string | undefined): boolean {
    const key = this.env.WOMPI_PUBLIC_KEY;
    if (!environment || !key) return true;
    if (key.startsWith("pub_prod_")) return environment === "prod";
    if (key.startsWith("pub_test_")) return environment === "test";
    return true;
  }
}
