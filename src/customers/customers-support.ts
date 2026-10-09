import { createHash } from "node:crypto";
import { EntityManager } from "typeorm";
import type { Fulfillment } from "../commerce/entities/fulfillment.entity";
import type { OrderLine } from "../commerce/entities/order-line.entity";
import type { Order } from "../commerce/entities/order.entity";
import type { Customer, CustomerAddress } from "./entities";
import type {
  AdminCustomerDto,
  CustomerAddressDto,
  CustomerProfileDto,
  PublicOrderDto,
  PublicOrderSummaryDto,
} from "./dto/customers.dto";

export const MAX_ADDRESSES = 10;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MS = 15 * 60 * 1000;

interface QueryRunnerLike {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/** TypeORM returns `[rows, affectedCount]` for UPDATE/DELETE ... RETURNING and plain rows for SELECT: normalise to rows. */
export async function queryRows<T>(runner: QueryRunnerLike, sql: string, params: unknown[]): Promise<T[]> {
  const result = await runner.query(sql, params);
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === "number") return result[0] as T[];
  return result as T[];
}

/**
 * Count a failed password attempt in ONE atomic statement (parallel guesses cannot undercount) and lock after 5.
 * An expired lock restarts the count at 1. Shared by login, change-password and account deletion.
 */
export async function recordFailedPassword(runner: QueryRunnerLike, customerId: string, now: Date): Promise<void> {
  const next = "CASE WHEN locked_until IS NOT NULL AND locked_until <= $2 THEN 1 ELSE failed_login_count + 1 END";
  await runner.query(
    `UPDATE customers SET failed_login_count = ${next}, locked_until = CASE WHEN (${next}) >= ${MAX_FAILED_LOGINS} THEN $3::timestamptz ELSE NULL END WHERE id = $1`,
    [customerId, now, new Date(now.getTime() + LOCK_MS)],
  );
}

/**
 * Attach earlier guest orders to the account. ONLY call this when the email is verified:
 * linking by an unverified address would hand someone else's order history to whoever registered it.
 */
export async function linkGuestOrders(manager: EntityManager, customerId: string, email: string): Promise<void> {
  await manager.query("UPDATE orders SET customer_id = $1 WHERE email = $2 AND customer_id IS NULL", [customerId, email.toLowerCase()]);
}

/** sha256 (hex) of the trimmed, lower-cased e-mail: the only form in which an erased address is remembered. */
export const emailSuppressionHash = (email: string): string => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

/** True when the address belongs to a customer erased under Habeas Data (see `erasure_suppressions`). */
export async function isEmailSuppressed(runner: QueryRunnerLike, email: string): Promise<boolean> {
  const rows = (await runner.query("SELECT 1 FROM erasure_suppressions WHERE email_hash = $1 LIMIT 1", [emailSuppressionHash(email)])) as unknown[];
  return rows.length > 0;
}

export const anonymizedEmail =(customerId: string): string => `deleted+${customerId}@invalid`;

/* ── mappers ──────────────────────────────────────────────── */

export const toProfile = (c: Customer): CustomerProfileDto => ({
  id: c.id,
  email: c.email,
  firstName: c.firstName,
  lastName: c.lastName,
  phone: c.phone ?? null,
  acceptsMarketing: c.acceptsMarketing,
  emailVerified: !!c.emailVerifiedAt,
  createdAt: c.createdAt,
});

export const toAdminCustomer = (c: Customer): AdminCustomerDto => ({
  id: c.id,
  email: c.email,
  firstName: c.firstName,
  lastName: c.lastName,
  phone: c.phone ?? null,
  acceptsMarketing: c.acceptsMarketing,
  marketingConsentAt: c.marketingConsentAt ?? null,
  isActive: c.isActive,
  hasAccount: !!c.passwordHash,
  emailVerified: !!c.emailVerifiedAt,
  tags: c.tags,
  lastLoginAt: c.lastLoginAt ?? null,
  anonymizedAt: c.anonymizedAt ?? null,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

export const toAddressDto = (a: CustomerAddress): CustomerAddressDto => ({
  id: a.id,
  label: a.label ?? null,
  isDefault: a.isDefault,
  fullName: a.fullName,
  phone: a.phone,
  department: a.department,
  city: a.city,
  address1: a.address1,
  address2: a.address2 ?? null,
  postalCode: a.postalCode ?? null,
  documentType: a.documentType ?? null,
  documentNumber: a.documentNumber ?? null,
});

export const toOrderSummary = (o: Order, itemCount: number): PublicOrderSummaryDto => ({
  orderNumber: o.orderNumber,
  status: o.status,
  paymentStatus: o.paymentStatus,
  fulfillmentStatus: o.fulfillmentStatus,
  currency: o.currency,
  total: o.total,
  itemCount,
  createdAt: o.createdAt,
});

/** Public order view: no accessTokenHash, payment references, internal notes, tags, reservations or events. */
export const toPublicOrder = (o: Order, lines: OrderLine[], fulfillments: Fulfillment[]): PublicOrderDto => ({
  ...toOrderSummary(
    o,
    lines.reduce((n, l) => n + l.quantity, 0),
  ),
  email: o.email,
  phone: o.phone ?? null,
  subtotal: o.subtotal,
  discountTotal: o.discountTotal,
  shippingTotal: o.shippingTotal,
  taxTotal: o.taxTotal,
  totalRefunded: o.totalRefunded,
  discountCode: o.discountCode ?? null,
  shippingRateName: o.shippingRateName ?? null,
  shippingAddress: { ...o.shippingAddress },
  billingAddress: o.billingAddress ? { ...o.billingAddress } : null,
  customerNote: o.customerNote ?? null,
  paidAt: o.paidAt ?? null,
  cancelledAt: o.cancelledAt ?? null,
  lines: lines.map((l) => ({
    title: l.title,
    variantTitle: l.variantTitle,
    sku: l.sku ?? null,
    imageUrl: l.imageUrl ?? null,
    unitPrice: l.unitPrice,
    quantity: l.quantity,
    lineTotal: l.lineTotal,
    fulfilledQuantity: l.fulfilledQuantity,
    refundedQuantity: l.refundedQuantity,
  })),
  fulfillments: fulfillments.map((f) => ({
    status: f.status,
    carrier: f.carrier ?? null,
    trackingNumber: f.trackingNumber ?? null,
    trackingUrl: f.trackingUrl ?? null,
    shippedAt: f.shippedAt,
  })),
});
