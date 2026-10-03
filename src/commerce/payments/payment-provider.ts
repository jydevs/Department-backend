import { z } from "zod";
import type { Order } from "../entities";

/** Injection token: `@Inject(PAYMENT_PROVIDER) provider: PaymentProvider`. */
export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

/** Where the gateway sends the buyer back: `{STOREFRONT_URL}/checkout/result?order=<number>` (never the access token). */
export function checkoutResultUrl(storefrontUrl: string, orderNumber: number): string {
  const url = new URL("/checkout/result", storefrontUrl);
  url.searchParams.set("order", String(orderNumber));
  return url.toString();
}

export type PaymentProviderName = "wompi" | "mock";

export interface PaymentInstructions {
  provider: PaymentProviderName;
  reference: string;
  amountInCents: number;
  currency: string;
  publicKey?: string;
  signatureIntegrity?: string;
  redirectUrl?: string;
  checkoutUrl?: string;
}

export type PaymentStatus = "approved" | "declined" | "voided" | "error" | "pending";

/** Minimal event envelope shared by Wompi and the mock (the mock signs Wompi-shaped events). */
export interface ProviderEvent {
  event: string;
  data: Record<string, unknown>;
  environment?: string;
  timestamp?: number | string;
}

/** An event whose authenticity was verified; only providers create these. */
export interface VerifiedEvent {
  readonly provider: PaymentProviderName;
  readonly event: ProviderEvent;
}

export interface ParsedTransaction {
  eventId: string;
  reference: string;
  providerTransactionId: string;
  status: PaymentStatus;
  amountInCents: number;
  currency: string;
  method?: string;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createPayment(order: Order): PaymentInstructions;
  /** Returns null when the signature (or the environment) is invalid. NEVER does any work before verifying. */
  verifyWebhook(headers: WebhookHeaders, rawBody: Buffer): VerifiedEvent | null;
  /** Returns null for events that are not transaction updates (they are acknowledged and ignored). */
  parseTransaction(event: VerifiedEvent): ParsedTransaction | null;
}

/* ── shared parsing of Wompi-shaped payloads ── */

export const providerEventSchema = z.object({
  event: z.string().min(1).max(60),
  data: z.record(z.string(), z.unknown()),
  environment: z.string().max(20).optional(),
  timestamp: z.union([z.number(), z.string().max(30)]).optional(),
});

const transactionSchema = z.object({
  id: z.string().min(1).max(80),
  reference: z.string().min(1).max(80),
  status: z.string().min(1).max(20),
  amount_in_cents: z.number().int().nonnegative().safe(),
  currency: z.string().length(3),
  payment_method_type: z.string().max(30).nullish(),
});

const STATUS_MAP: Record<string, PaymentStatus> = {
  APPROVED: "approved",
  DECLINED: "declined",
  VOIDED: "voided",
  ERROR: "error",
  PENDING: "pending",
};

export function parseWompiShapedTransaction(verified: VerifiedEvent): ParsedTransaction | null {
  if (verified.event.event !== "transaction.updated") return null;
  const parsed = transactionSchema.safeParse(verified.event.data["transaction"]);
  if (!parsed.success) return null;
  const tx = parsed.data;
  const rawStatus = tx.status.toUpperCase();
  return {
    // Wompi events carry no id of their own: a transaction reaching the same status is the same fact.
    eventId: `${tx.id}:${rawStatus}`.slice(0, 120),
    reference: tx.reference,
    providerTransactionId: tx.id,
    status: STATUS_MAP[rawStatus] ?? "pending",
    amountInCents: tx.amount_in_cents,
    currency: tx.currency.toUpperCase(),
    method: tx.payment_method_type ?? undefined,
  };
}
