import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import { AppException } from "../../common/errors/app-exception";
import { Clock } from "../../common/clock/clock";
import { OffsetPage, toOffsetPage } from "../../common/pagination/pagination";
import { SqlParams } from "../../common/sql/sql-params";
import { escapeLike } from "../../common/sql/escape-like";
import { TransactionService } from "../../database/transaction.service";
import { AuditService } from "../../audit/audit.service";
import { Order } from "../entities/order.entity";
import { OrderLine } from "../entities/order-line.entity";
import { OrderEvent } from "../entities/order-event.entity";
import { Payment } from "../entities/payment.entity";
import { Fulfillment } from "../entities/fulfillment.entity";
import { FulfillmentLine } from "../entities/fulfillment-line.entity";
import { Refund } from "../entities/refund.entity";
import { RefundLine } from "../entities/refund-line.entity";
import { OrdersLifecycleService } from "./orders-lifecycle.service";
import {
  OrderCancelInput,
  OrderDetailDto,
  OrderEventDto,
  OrderListQuery,
  OrderMarkPaidInput,
  OrderSummaryDto,
  OrderUpdateInput,
} from "./dto/orders-admin.dto";
import { toEventDto, toFulfillmentDto, toOrderLineDto, toPaymentDto, toRefundDto } from "./order-mappers";
import { Actor } from "../../common/auth/actor";
import { EventActor, execUpdate, lockOrder, recordOrderEvent, toEventActor } from "./order-support";

const MAX_ORDER_NUMBER = 2_147_483_647;
const DETAIL_EVENT_LIMIT = 50;

interface SummaryRow {
  id: string;
  order_number: number;
  created_at: Date;
  email: string;
  customer_name: string | null;
  total: string;
  currency: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  item_count: string;
  tags: string[];
}

@Injectable()
export class OrdersAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionService: TransactionService,
    private readonly auditService: AuditService,
    private readonly lifecycle: OrdersLifecycleService,
    private readonly clock: Clock,
  ) {}

  /* ── reads ─────────────────────────────────────────────── */

  async list(query: OrderListQuery): Promise<OffsetPage<OrderSummaryDto>> {
    const params = new SqlParams();
    const where: string[] = [];

    if (query.status) where.push(`o.status = ${params.push(query.status)}`);
    if (query.paymentStatus) where.push(`o.payment_status = ${params.push(query.paymentStatus)}`);
    if (query.fulfillmentStatus) where.push(`o.fulfillment_status = ${params.push(query.fulfillmentStatus)}`);
    if (query.from) where.push(`o.created_at >= ${params.push(query.from)}`);
    if (query.to) where.push(`o.created_at <= ${params.push(query.to)}`);
    if (query.tag) where.push(`${params.push(query.tag)} = ANY(o.tags)`);

    if (query.q) {
      const raw = query.q.replace(/^#/, "").trim();
      const asNumber = /^\d{1,10}$/.test(raw) ? Number(raw) : null;
      if (asNumber !== null && asNumber <= MAX_ORDER_NUMBER) {
        where.push(`o.order_number = ${params.push(asNumber)}`);
      } else {
        const like = params.push(`%${escapeLike(query.q)}%`);
        where.push(`(o.email ILIKE ${like} ESCAPE '\\' OR o.shipping_address->>'fullName' ILIKE ${like} ESCAPE '\\')`);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const filterValues = [...params.values];

    const countRows: { count: string }[] = await this.dataSource.query(`SELECT COUNT(*) AS count FROM orders o ${whereSql}`, filterValues);
    const total = Number(countRows[0]?.count ?? 0);

    const limit = params.push(query.pageSize);
    const offset = params.push((query.page - 1) * query.pageSize);
    const rows: SummaryRow[] = await this.dataSource.query(
      `SELECT o.id, o.order_number, o.created_at, o.email, o.shipping_address->>'fullName' AS customer_name,
              o.total, o.currency, o.status, o.payment_status, o.fulfillment_status, o.tags,
              COALESCE((SELECT SUM(l.quantity) FROM order_lines l WHERE l.order_id = o.id), 0) AS item_count
         FROM orders o
         ${whereSql}
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params.values,
    );

    const items: OrderSummaryDto[] = rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      createdAt: r.created_at,
      email: r.email,
      customerName: r.customer_name,
      total: Number(r.total),
      currency: r.currency,
      status: r.status,
      paymentStatus: r.payment_status,
      fulfillmentStatus: r.fulfillment_status,
      itemCount: Number(r.item_count),
      tags: r.tags,
    }));
    return toOffsetPage(items, total, query.page, query.pageSize);
  }

  async getDetail(id: string, manager: EntityManager = this.dataSource.manager): Promise<OrderDetailDto> {
    const order = await manager.getRepository(Order).findOne({ where: { id } });
    if (!order) throw AppException.notFound("Order");

    const [lines, payments, fulfillments, refunds, events] = await Promise.all([
      manager.getRepository(OrderLine).find({ where: { orderId: id }, order: { createdAt: "ASC", id: "ASC" } }),
      manager.getRepository(Payment).find({ where: { orderId: id }, order: { createdAt: "ASC", id: "ASC" } }),
      manager.getRepository(Fulfillment).find({ where: { orderId: id }, order: { createdAt: "ASC", id: "ASC" } }),
      manager.getRepository(Refund).find({ where: { orderId: id }, order: { createdAt: "ASC", id: "ASC" } }),
      manager.getRepository(OrderEvent).find({ where: { orderId: id }, order: { createdAt: "DESC", id: "DESC" }, take: DETAIL_EVENT_LIMIT }),
    ]);

    const fulfillmentIds = fulfillments.map((f) => f.id);
    const refundIds = refunds.map((r) => r.id);
    const [fLines, rLines] = await Promise.all([
      fulfillmentIds.length ? manager.getRepository(FulfillmentLine).find({ where: { fulfillmentId: In(fulfillmentIds) } }) : Promise.resolve([]),
      refundIds.length ? manager.getRepository(RefundLine).find({ where: { refundId: In(refundIds) } }) : Promise.resolve([]),
    ]);

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      version: order.version,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      email: order.email,
      phone: order.phone ?? null,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      currency: order.currency,
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      shippingTotal: order.shippingTotal,
      taxTotal: order.taxTotal,
      total: order.total,
      totalRefunded: order.totalRefunded,
      discountCode: order.discountCode ?? null,
      shippingRateName: order.shippingRateName ?? null,
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress ?? null,
      customerNote: order.customerNote ?? null,
      internalNote: order.internalNote ?? null,
      tags: order.tags,
      reservedUntil: order.reservedUntil ?? null,
      paidAt: order.paidAt ?? null,
      cancelledAt: order.cancelledAt ?? null,
      cancelReason: order.cancelReason ?? null,
      paymentProvider: order.paymentProvider,
      paymentReference: order.paymentReference,
      lines: lines.map(toOrderLineDto),
      payments: payments.map(toPaymentDto),
      fulfillments: fulfillments.map((f) => toFulfillmentDto(f, fLines.filter((l) => l.fulfillmentId === f.id))),
      refunds: refunds.map((r) => toRefundDto(r, rLines.filter((l) => l.refundId === r.id))),
      events: events.map(toEventDto),
    };
  }

  async timeline(id: string, page: number, pageSize: number): Promise<OffsetPage<OrderEventDto>> {
    const exists: unknown[] = await this.dataSource.query("SELECT 1 FROM orders WHERE id = $1", [id]);
    if (exists.length === 0) throw AppException.notFound("Order");
    const repo = this.dataSource.getRepository(OrderEvent);
    const [events, total] = await repo.findAndCount({
      where: { orderId: id },
      order: { createdAt: "DESC", id: "DESC" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return toOffsetPage(events.map(toEventDto), total, page, pageSize);
  }

  /* ── writes ────────────────────────────────────────────── */

  async update(id: string, input: OrderUpdateInput, actor: EventActor): Promise<OrderDetailDto> {
    return this.transactionService.run(async (manager) => {
      const locked = await lockOrder(manager, id);
      if (locked.version !== input.version) {
        throw AppException.conflict("CONCURRENT_UPDATE", "The order was modified by someone else, reload and retry", {
          currentVersion: locked.version,
        });
      }

      const touchesShipping = input.email !== undefined || input.phone !== undefined || input.shippingAddress !== undefined;
      if (touchesShipping && locked.fulfillmentStatus !== "unfulfilled") {
        throw AppException.conflict("ORDER_NOT_EDITABLE", "Contact and shipping address can only be edited while the order is unfulfilled");
      }
      if (touchesShipping && (locked.status === "cancelled" || locked.status === "expired")) {
        throw AppException.conflict("ORDER_NOT_EDITABLE", "Cancelled or expired orders cannot be edited");
      }

      const params = new SqlParams();
      const sets: string[] = [];
      const changed: string[] = [];
      if (input.internalNote !== undefined) {
        sets.push(`internal_note = ${params.push(input.internalNote)}`);
        changed.push("internalNote");
      }
      if (input.tags !== undefined) {
        sets.push(`tags = ${params.push(Array.from(new Set(input.tags)))}::text[]`);
        changed.push("tags");
      }
      if (input.email !== undefined) {
        sets.push(`email = ${params.push(input.email)}`);
        changed.push("email");
      }
      if (input.phone !== undefined) {
        sets.push(`phone = ${params.push(input.phone)}`);
        changed.push("phone");
      }
      if (input.shippingAddress !== undefined) {
        sets.push(`shipping_address = ${params.push(JSON.stringify(input.shippingAddress))}::jsonb`);
        changed.push("shippingAddress");
      }

      if (changed.length > 0) {
        sets.push("version = version + 1", `updated_at = ${params.push(this.clock.now())}`);
        const idP = params.push(id);
        const verP = params.push(input.version);
        const affected = await execUpdate(manager, `UPDATE orders SET ${sets.join(", ")} WHERE id = ${idP} AND version = ${verP}`, params.values);
        if (affected !== 1) throw AppException.conflict("CONCURRENT_UPDATE", "The order was modified by someone else, reload and retry");

        await recordOrderEvent(manager, id, "order.updated", { fields: changed }, actor);
        await this.auditService.record({ action: "order:update", entityType: "Order", entityId: id, diff: { fields: changed } }, manager);
      }
      return this.getDetail(id, manager);
    });
  }

  async addNote(id: string, note: string, actor: EventActor): Promise<OrderEventDto> {
    return this.transactionService.run(async (manager) => {
      await lockOrder(manager, id);
      const event = await recordOrderEvent(manager, id, "note", { note }, actor);
      await this.auditService.record({ action: "order:note", entityType: "Order", entityId: id, diff: { length: note.length } }, manager);
      return toEventDto(event);
    });
  }

  /** The lifecycle service records the OrderEvent and (for staff) the audit entry for cancel / mark-paid. */
  async cancel(id: string, input: OrderCancelInput, actor: Actor): Promise<OrderDetailDto> {
    return this.transactionService.run(async (manager) => {
      await lockOrder(manager, id);
      await this.lifecycle.cancel(id, { reason: input.reason, restock: input.restock, actor }, manager);
      return this.getDetail(id, manager);
    });
  }

  async markPaid(id: string, input: OrderMarkPaidInput, actor: Actor): Promise<OrderDetailDto> {
    return this.transactionService.run(async (manager) => {
      const locked = await lockOrder(manager, id);
      if (locked.status !== "pending") {
        throw AppException.conflict("ORDER_NOT_PENDING", "Only pending orders can be marked as paid");
      }
      await this.lifecycle.markPaid(id, { providerTransactionId: input.reference, method: "manual", manual: true }, manager, actor);
      if (input.note) await recordOrderEvent(manager, id, "note", { note: input.note, context: "mark_paid" }, toEventActor(actor));
      return this.getDetail(id, manager);
    });
  }
}
