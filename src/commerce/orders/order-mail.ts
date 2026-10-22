import { createHash, randomBytes } from "node:crypto";
import type { EntityManager } from "typeorm";
import { v7 as uuidv7 } from "uuid";

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

/** How long an e-mail order link keeps working. */
const MAIL_LINK_DAYS = 90;

/** Plain public order URL (no token). */
export function orderUrl(storefrontUrl: string, orderNumber: number): string {
  return `${storefrontUrl.replace(/\/+$/, "")}/orders/${orderNumber}`;
}

/**
 * Order link for an e-mail: `/orders/:n?token=…`. Mints a token valid for THIS order only (stored hashed, expires in 90 days), so a guest
 * can open the order from the e-mail like with the checkout token. Runs in the caller's transaction (the e-mail is enqueued there).
 */
export async function orderMailLink(manager: EntityManager, storefrontUrl: string, orderId: string, orderNumber: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await manager.query(
    `INSERT INTO order_access_tokens (id, order_id, token_hash, kind, expires_at, created_at, updated_at) VALUES ($1, $2, $3, 'mail', $4, $5, $5)`,
    [uuidv7(), orderId, createHash("sha256").update(token).digest("hex"), new Date(now.getTime() + MAIL_LINK_DAYS * 86_400_000), now],
  );
  return `${orderUrl(storefrontUrl, orderNumber)}?token=${token}`;
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
