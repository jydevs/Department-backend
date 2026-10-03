import { createHmac } from "node:crypto";
import type { EntityManager } from "typeorm";

const MAX_SUMMARY = 500;

/** `189000` -> `$189.000` (COP, no decimals). */
export function formatCop(amount: number): string {
  const formatted = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0, useGrouping: true }).format(Math.round(amount));
  return `$${formatted}`;
}

/** Full name from the shipping address snapshot (`shipping_address.fullName`). */
export function orderCustomerName(shippingAddress: { fullName?: string } | null | undefined): string {
  return shippingAddress?.fullName?.trim() ?? "";
}

/** `2 × Camiseta (M), 1 × Gorra`, capped at 500 characters. */
export function itemsSummary(lines: { quantity: number; title: string; variantTitle?: string | null }[]): string {
  const text = lines
    .map((l) => {
      const variant = l.variantTitle?.trim();
      return `${l.quantity} × ${l.title}${variant ? ` (${variant})` : ""}`;
    })
    .join(", ");
  return text.length <= MAX_SUMMARY ? text : `${text.slice(0, MAX_SUMMARY - 1)}…`;
}

/**
 * Public order link. Without `linkToken` it carries no credential (shipping/refund/cancel mails).
 * With it (order confirmation) the link opens the order directly: `/orders/<number>?token=<linkToken>`.
 */
export function orderUrl(storefrontUrl: string, orderNumber: number, linkToken?: string): string {
  const base = `${storefrontUrl.replace(/\/+$/, "")}/orders/${orderNumber}`;
  return linkToken ? `${base}?token=${encodeURIComponent(linkToken)}` : base;
}

/**
 * Credential for the e-mail link. The checkout `accessToken` is only known (in plaintext) to the buyer's browser, so the
 * confirmation mail (sent when the payment is approved) uses a second, stateless credential: HMAC-SHA256 of the order id
 * under the server secret (domain separated). It is accepted wherever the accessToken is (see `order-access.ts`).
 */
export function orderLinkToken(secret: string | undefined, orderId: string): string {
  // JWT_ACCESS_SECRET is mandatory in production (env validation); the fallback only exists for local development.
  return createHmac("sha256", secret ?? "dev-only-order-link-secret").update(`order-link:v1:${orderId}`).digest("base64url");
}

export function orderNumberLabel(orderNumber: number): string {
  return `#${orderNumber}`;
}

export interface OrderMailContext {
  email: string;
  customerName: string;
  orderNumber: number;
}

/** Reads what the mails need from an order inside the caller's transaction. */
export async function loadOrderMailContext(manager: EntityManager, orderId: string): Promise<OrderMailContext | null> {
  const rows = await manager.query<{ email: string; order_number: number; full_name: string | null }[]>(
    `SELECT email, order_number, shipping_address->>'fullName' AS full_name FROM orders WHERE id = $1`,
    [orderId],
  );
  const row = rows[0];
  if (!row) return null;
  return { email: row.email, orderNumber: row.order_number, customerName: orderCustomerName({ fullName: row.full_name ?? undefined }) };
}
