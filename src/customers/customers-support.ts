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
 * Attach earlier guest orders to the account. ONLY call this when the email is verified:
 * linking by an unverified address would hand someone else's order history to whoever registered it.
 */
export async function linkGuestOrders(manager: EntityManager, customerId: string, email: string): Promise<void> {
  await manager.query("UPDATE orders SET customer_id = $1 WHERE lower(email) = $2 AND customer_id IS NULL", [customerId, email.toLowerCase()]);
}

export const anonymizedEmail = (customerId: string): string => `deleted+${customerId}@invalid`;

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
