import { Inject, Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { AuditService } from "../../audit/audit.service";
import type { Actor } from "../../common/auth/actor";
import { Clock } from "../../common/clock/clock";
import { AppException } from "../../common/errors/app-exception";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { MailService } from "../../mail/mail.service";
import { formatCop, itemsSummary, orderCustomerName, orderNumberLabel, orderUrl } from "./order-mail";
import { TransactionService } from "../../database/transaction.service";
import { InventoryService } from "../../inventory/inventory.service";
import { Discount, DiscountRedemption, Order, OrderEvent, OrderLine, Payment } from "../entities";

export const REFUND_PENDING_TAG = "refund-pending";
/** A recent PENDING gateway transaction (PSE, Nequi…) keeps its order from expiring for this long; the reconciliation job resolves it meanwhile. */
export const PENDING_TX_GRACE_MINUTES = 30;

export interface MarkPaidPayment {
  providerTransactionId?: string;
  method?: string;
  manual?: boolean;
}

export interface CancelOptions {
  reason: string;
  restock: boolean;
  actor?: Actor;
}

/** What `flagRefundPending` records in the timeline. */
export type RefundPendingEventType = "payment.late_approval" | "order.refund_pending";

/**
 * The only place that moves an order between states. Every transition runs inside the caller's
 * transaction (`manager`), locks the order row first and appends an OrderEvent (+ audit log when a staff
 * actor is known).
 *
 *   pending -> open (markPaid) | cancelled | expired (release reservation)
 *   open    -> cancelled (optional restock; paid orders are flagged `refund-pending`)
 */
@Injectable()
export class OrdersLifecycleService {
  private readonly logger = new Logger(OrdersLifecycleService.name);

  constructor(
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly transactions: TransactionService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** pending -> open, paymentStatus paid, reservation committed to on_hand. */
  async markPaid(orderId: string, payment: MarkPaidPayment, manager: EntityManager, actor?: Actor): Promise<void> {
    const order = await this.lockOrder(manager, orderId);
    if (order.status !== "pending") {
      throw AppException.conflict("INVALID_ORDER_STATE", `Only pending orders can be marked as paid (status: ${order.status})`);
    }
    const now = this.clock.now();

    const lines = await manager.getRepository(OrderLine).find({ where: { orderId } });
    // Commit what was actually reserved at checkout, regardless of the variants' CURRENT trackInventory/allowBackorder.
    await this.inventory.commitReserved(this.reservedItems(lines), manager);

    const paymentRepo = manager.getRepository(Payment);
    const existing = await paymentRepo.findOne({
      where: { orderId, reference: order.paymentReference },
      order: { createdAt: "DESC" },
    });
    const row = existing ?? paymentRepo.create({ orderId, provider: payment.manual ? "manual" : order.paymentProvider, reference: order.paymentReference, amount: order.total, currency: order.currency });
    row.status = "approved";
    row.rawStatus = payment.manual ? "MANUAL" : "APPROVED";
    if (payment.providerTransactionId) row.providerTransactionId = payment.providerTransactionId;
    if (payment.method) row.method = payment.method;
    else if (payment.manual && !row.method) row.method = "manual";
    try {
      await paymentRepo.save(row);
    } catch (err) {
      // Unique index (provider, provider_transaction_id): the manual reference was already used by another payment.
      // The failed statement aborts this transaction; the exception makes the caller roll it back.
      if (payment.manual && payment.providerTransactionId && (err as { driverError?: { code?: string } })?.driverError?.code === "23505") {
        throw AppException.conflict("PAYMENT_REFERENCE_DUPLICATE", "That payment reference is already registered on another payment; use a different reference");
      }
      throw err;
    }

    order.status = "open";
    order.paymentStatus = "paid";
    order.paidAt = now;
    order.reservedUntil = null;
    await manager.getRepository(Order).save(order);

    await this.recordEvent(
      manager,
      orderId,
      "order.paid",
      { manual: payment.manual === true, providerTransactionId: payment.providerTransactionId ?? null, method: payment.method ?? null },
      actor,
    );
    await this.auditIfStaff(manager, actor, "order:mark-paid", orderId, { manual: payment.manual === true });
    await this.mail.enqueue(
      {
        to: order.email,
        template: "order_confirmation",
        data: {
          customerName: orderCustomerName(order.shippingAddress),
          orderNumber: orderNumberLabel(order.orderNumber),
          total: formatCop(order.total),
          itemsSummary: itemsSummary(lines),
          orderUrl: orderUrl(this.env.STOREFRONT_URL, order.orderNumber),
        },
      },
      manager,
    );
  }

  /**
   * pending: releases the reservation. open (no shipments): optional restock; a paid order that is not fully
   * refunded is flagged `refund-pending`. Orders with shipments -> 409 ORDER_HAS_FULFILLMENTS.
   */
  async cancel(orderId: string, opts: CancelOptions, manager: EntityManager): Promise<void> {
    const order = await this.lockOrder(manager, orderId);
    const lines = await manager.getRepository(OrderLine).find({ where: { orderId } });
    const now = this.clock.now();

    if (order.status === "pending") {
      await this.inventory.releaseReserved(this.reservedItems(lines), manager);
      await this.releaseDiscount(manager, orderId);
    } else if (order.status === "open") {
      if (lines.some((l) => l.fulfilledQuantity > 0)) {
        throw AppException.conflict("ORDER_HAS_FULFILLMENTS", "The order already has shipments and cannot be cancelled");
      }
      if (opts.restock) {
        // Units already put back by refunds with restock must not be restocked again (restocked_quantity is per line).
        const items = lines
          .map((l) => ({ variantId: l.variantId, quantity: l.quantity - l.restockedQuantity }))
          .filter((i) => i.quantity > 0);
        if (items.length > 0) await this.inventory.restock(items, manager, "correction");
        await manager.query(`UPDATE order_lines SET restocked_quantity = quantity, updated_at = $2 WHERE order_id = $1 AND restocked_quantity < quantity`, [orderId, now]);
      }
    } else {
      throw AppException.conflict("INVALID_ORDER_STATE", `An order with status ${order.status} cannot be cancelled`);
    }

    const wasPending = order.status === "pending";
    const wasPaid = order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded";
    order.status = "cancelled";
    order.cancelledAt = now;
    order.cancelReason = opts.reason.slice(0, 255);
    order.reservedUntil = null;
    await manager.getRepository(Order).save(order);

    await this.recordEvent(manager, orderId, "order.cancelled", { reason: opts.reason, restock: opts.restock, wasPaid }, opts.actor);
    if (wasPaid && order.totalRefunded < order.total) {
      await this.flagRefundPending(orderId, "order.refund_pending", { reason: "cancelled_after_payment", outstanding: order.total - order.totalRefunded }, manager, opts.actor);
    }
    await this.auditIfStaff(manager, opts.actor, "order:cancel", orderId, { reason: opts.reason, restock: opts.restock });
    // Paid orders, or pending ones (checkout always creates a payment intent). Automatic expiry is another path and sends nothing.
    if (wasPaid || wasPending) {
      await this.mail.enqueue(
        {
          to: order.email,
          template: "order_cancelled",
          data: {
            customerName: orderCustomerName(order.shippingAddress),
            orderNumber: orderNumberLabel(order.orderNumber),
            reason: opts.reason,
            orderUrl: orderUrl(this.env.STOREFRONT_URL, order.orderNumber),
          },
        },
        manager,
      );
    }
  }

  /**
   * Marks that money must be returned by an admin. Stored as an OrderEvent (`payment.late_approval` or
   * `order.refund_pending`) plus the `refund-pending` tag on the order (no schema change). Idempotent for the tag.
   */
  async flagRefundPending(
    orderId: string,
    type: RefundPendingEventType,
    data: Record<string, unknown>,
    manager: EntityManager,
    actor?: Actor,
  ): Promise<void> {
    await manager.query(
      `UPDATE orders
       SET tags = array_append(tags, $2), version = version + 1, updated_at = $3
       WHERE id = $1 AND NOT ($2 = ANY(tags))`,
      [orderId, REFUND_PENDING_TAG, this.clock.now()],
    );
    await this.recordEvent(manager, orderId, type, { ...data, refundPending: true }, actor);
  }

  /** Expires unpaid orders whose reservation ran out. Each order gets its own transaction; SKIP LOCKED makes replicas safe. */
  async expirePending(now: Date, batch: number): Promise<number> {
    const candidates = await this.transactions.run((m) =>
      m.query<{ id: string }[]>(
        `SELECT o.id FROM orders o WHERE o.status = 'pending' AND o.reserved_until IS NOT NULL AND o.reserved_until <= $1
           AND NOT EXISTS (
             SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'pending' AND p.provider_transaction_id IS NOT NULL
               AND p.updated_at > $1::timestamptz - interval '${PENDING_TX_GRACE_MINUTES} minutes'
           )
         ORDER BY o.reserved_until ASC LIMIT $2`,
        [now, batch],
      ),
    );

    let expired = 0;
    for (const { id } of candidates) {
      try {
        const done = await this.transactions.run(async (manager) => {
          const locked = await manager.query<{ id: string }[]>(
            `SELECT id FROM orders WHERE id = $1 AND status = 'pending' AND reserved_until <= $2 FOR UPDATE SKIP LOCKED`,
            [id, now],
          );
          if (locked.length === 0) return false; // paid, cancelled or taken by another instance meanwhile
          const order = await this.lockOrder(manager, id);
          const lines = await manager.getRepository(OrderLine).find({ where: { orderId: id } });
          await this.inventory.releaseReserved(this.reservedItems(lines), manager);
          await this.releaseDiscount(manager, id);
          order.status = "expired";
          order.reservedUntil = null;
          await manager.getRepository(Order).save(order);
          await this.recordEvent(manager, id, "order.expired", { reason: "payment_timeout" });
          return true;
        });
        if (done) expired++;
      } catch (err) {
        this.logger.error(`Could not expire order ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return expired;
  }

  /** Appends a timeline entry; `actor` staff => actorId, otherwise the kind (or `system`). */
  async recordEvent(manager: EntityManager, orderId: string, type: string, data: Record<string, unknown>, actor?: Actor): Promise<void> {
    const repo = manager.getRepository(OrderEvent);
    await repo.save(
      repo.create({
        orderId,
        type,
        data,
        actorType: actor?.kind ?? "system",
        actorId: actor?.kind === "staff" ? actor.staffId : null,
      }),
    );
  }

  /* ── helpers ── */

  private async lockOrder(manager: EntityManager, orderId: string): Promise<Order> {
    const order = await manager.getRepository(Order).findOne({ where: { id: orderId }, lock: { mode: "pessimistic_write" } });
    if (!order) throw AppException.notFound("Order");
    return order;
  }

  private stockItems(lines: OrderLine[]): { variantId: string; quantity: number }[] {
    return lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity }));
  }

  /** Quantities that checkout really reserved (untracked / backorderable lines have 0 and are skipped). */
  private reservedItems(lines: OrderLine[]): { variantId: string; quantity: number }[] {
    return lines.filter((l) => l.reservedQuantity > 0).map((l) => ({ variantId: l.variantId, quantity: l.reservedQuantity }));
  }

  /** An order that never got paid gives its discount usage back (so usageLimit / oncePerEmail are not burned by abandoned carts). */
  private async releaseDiscount(manager: EntityManager, orderId: string): Promise<void> {
    const redemptions = await manager.getRepository(DiscountRedemption).find({ where: { orderId } });
    for (const redemption of redemptions) {
      await manager.getRepository(DiscountRedemption).delete({ id: redemption.id });
      await manager
        .getRepository(Discount)
        .createQueryBuilder()
        .update()
        .set({ usedCount: () => "used_count - 1" })
        .where("id = :id AND used_count > 0", { id: redemption.discountId })
        .execute();
    }
  }

  private async auditIfStaff(manager: EntityManager, actor: Actor | undefined, action: string, orderId: string, diff: Record<string, unknown>): Promise<void> {
    if (actor?.kind !== "staff") return;
    await this.audit.record({ action, entityType: "Order", entityId: orderId, diff }, manager);
  }
}
