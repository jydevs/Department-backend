import { createHash } from "node:crypto";
import { Logger } from "@nestjs/common";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AppException } from "../../common/errors/app-exception";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import type { Order } from "../entities";
import {
  ParsedTransaction,
  PaymentInstructions,
  PaymentProvider,
  ProviderEvent,
  VerifiedEvent,
  WebhookHeaders,
  parseWompiShapedTransaction,
  parseWompiTransactionObject,
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
  private readonly logger = new Logger(WompiProvider.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  createPayment(order: Order): PaymentInstructions {
    const integritySecret = this.env.WOMPI_INTEGRITY_SECRET;
    const publicKey = this.env.WOMPI_PUBLIC_KEY;
    if (!integritySecret || !publicKey) throw AppException.unavailable("Payments are not configured");

    const amountInCents = order.total * 100;
    // Wompi integrity signature: reference + amount + currency + [expiration-time] + integrity secret. The expiration time
    // (the order's reservation deadline) keeps a PENDING transaction (PSE, Nequi…) from outliving the stock reservation.
    const expirationTime = this.env.WOMPI_EXPIRATION_ENABLED && order.reservedUntil && order.reservedUntil.getTime() > Date.now() ? order.reservedUntil.toISOString() : undefined;
    return {
      provider: "wompi",
      reference: order.paymentReference,
      amountInCents,
      currency: order.currency,
      publicKey,
      ...(expirationTime ? { expirationTime } : {}),
      signatureIntegrity: sha256Hex(`${order.paymentReference}${amountInCents}${order.currency}${expirationTime ?? ""}${integritySecret}`),
      redirectUrl: new URL("/checkout/result", this.env.STOREFRONT_URL).toString(),
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

  /** Source of truth for a transaction: the webhook is only a hint. Throws on network/HTTP errors so the caller can retry. */
  async fetchTransaction(transactionId: string): Promise<ParsedTransaction | null> {
    const body = await this.apiGet(`/transactions/${encodeURIComponent(transactionId)}`);
    return parseWompiTransactionObject(body?.data);
  }

  async fetchTransactionsByReference(reference: string): Promise<ParsedTransaction[]> {
    const body = await this.apiGet(`/transactions?reference=${encodeURIComponent(reference)}`);
    const rows = Array.isArray(body?.data) ? (body.data as unknown[]) : [];
    return rows.map((r) => parseWompiTransactionObject(r)).filter((t): t is ParsedTransaction => t !== null);
  }

  private async apiGet(path: string): Promise<{ data?: unknown } | null> {
    const key = this.env.WOMPI_PUBLIC_KEY;
    if (!key) throw new Error("Wompi is not configured");
    const res = await fetch(`${this.env.WOMPI_API_URL.replace(/\/$/, "")}${path}`, {
      headers: { accept: "application/json", authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      this.logger.warn(`Wompi GET ${path.split("?")[0]} -> ${res.status}`);
      throw new Error(`Wompi API responded ${res.status}`);
    }
    return (await res.json()) as { data?: unknown };
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
