import { Inject, Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { AppException } from "../../common/errors/app-exception";
import { Clock } from "../../common/clock/clock";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { MailService } from "../../mail/mail.service";
import { loadOrderMailContext, orderNumberLabel, orderUrl } from "./order-mail";
import { TransactionService } from "../../database/transaction.service";
import { AuditService } from "../../audit/audit.service";
import { Fulfillment } from "../entities/fulfillment.entity";
import { FulfillmentLine } from "../entities/fulfillment-line.entity";
import { FulfillmentCreateInput, FulfillmentResultDto } from "./dto/orders-admin.dto";
import { toFulfillmentDto } from "./order-mappers";
import {
  EventActor,
  LockedLine,
  LockedOrder,
  computeFulfillmentStatus,
  execUpdate,
  lockLines,
  lockOrder,
  recordOrderEvent,
  shippableQuantity,
} from "./order-support";

@Injectable()
export class FulfillmentsService {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly auditService: AuditService,
    private readonly clock: Clock,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(orderId: string, input: FulfillmentCreateInput, actor: EventActor): Promise<FulfillmentResultDto> {
    return this.transactionService.run(async (manager) => {
      const order = await lockOrder(manager, orderId);
      if (order.status !== "open") {
        throw AppException.conflict("ORDER_NOT_OPEN", "Only open (paid) orders can be shipped");
      }
      const lines = await lockLines(manager, orderId);

      const problems: { orderLineId: string; reason: string; pending?: number }[] = [];
      for (const item of input.lines) {
        const line = lines.get(item.orderLineId);
        if (!line) {
          problems.push({ orderLineId: item.orderLineId, reason: "LINE_NOT_IN_ORDER" });
        } else if (item.quantity > shippableQuantity(line)) {
          problems.push({ orderLineId: item.orderLineId, reason: "QUANTITY_EXCEEDS_PENDING", pending: shippableQuantity(line) });
        }
      }
      if (problems.length > 0) {
        throw AppException.conflict("FULFILLMENT_QUANTITY_INVALID", "Some quantities exceed the pending units of the order", { lines: problems });
      }

      const fulfillmentRepo = manager.getRepository(Fulfillment);
      const fulfillment = await fulfillmentRepo.save(
        fulfillmentRepo.create({
          orderId,
          status: "success",
          carrier: input.carrier ?? null,
          trackingNumber: input.trackingNumber ?? null,
          trackingUrl: input.trackingUrl ?? null,
          shippedAt: this.clock.now(),
        }),
      );
      const lineRepo = manager.getRepository(FulfillmentLine);
      const savedLines = await lineRepo.save(
        input.lines.map((l) => lineRepo.create({ fulfillmentId: fulfillment.id, orderLineId: l.orderLineId, quantity: l.quantity })),
      );

      for (const item of input.lines) {
        const affected = await execUpdate(
          manager,
          "UPDATE order_lines SET fulfilled_quantity = fulfilled_quantity + $1, updated_at = $2 WHERE id = $3 AND order_id = $4 AND fulfilled_quantity + $1 <= quantity",
          [item.quantity, this.clock.now(), item.orderLineId, orderId],
        );
        if (affected !== 1) throw AppException.conflict("FULFILLMENT_QUANTITY_INVALID", "Quantity exceeds the line quantity");
        const line = lines.get(item.orderLineId);
        if (line) line.fulfilledQuantity += item.quantity;
      }

      const result = await this.syncOrderStatus(manager, order, lines);

      await recordOrderEvent(
        manager,
        orderId,
        "fulfillment.created",
        {
          fulfillmentId: fulfillment.id,
          lines: input.lines,
          carrier: input.carrier ?? null,
          trackingNumber: input.trackingNumber ?? null,
          trackingUrl: input.trackingUrl ?? null,
          notifyCustomer: input.notifyCustomer,
          fulfillmentStatus: result.fulfillmentStatus,
          status: result.status,
        },
        actor,
      );
      await this.auditService.record(
        {
          action: "order:fulfill",
          entityType: "Order",
          entityId: orderId,
          diff: { fulfillmentId: fulfillment.id, lines: input.lines, fulfillmentStatus: result.fulfillmentStatus },
        },
        manager,
      );

      if (input.notifyCustomer) {
        const ctx = await loadOrderMailContext(manager, orderId);
        if (ctx) {
          await this.mail.enqueue(
            {
              to: ctx.email,
              template: "order_shipped",
              data: {
                customerName: ctx.customerName,
                orderNumber: orderNumberLabel(ctx.orderNumber),
                carrier: input.carrier ?? "",
                trackingNumber: input.trackingNumber ?? "",
                trackingUrl: input.trackingUrl ?? "",
                orderUrl: orderUrl(this.env.STOREFRONT_URL, ctx.orderNumber),
              },
            },
            manager,
          );
        }
      }

      return { fulfillment: toFulfillmentDto(fulfillment, savedLines), order: result };
    });
  }

  async cancel(orderId: string, fulfillmentId: string, actor: EventActor): Promise<FulfillmentResultDto> {
    return this.transactionService.run(async (manager) => {
      const order = await lockOrder(manager, orderId);
      if (order.status !== "open" && order.status !== "completed") {
        throw AppException.conflict("ORDER_NOT_FULFILLABLE", "Fulfillments can only be cancelled on open or completed orders");
      }
      const lines = await lockLines(manager, orderId);

      const fulfillmentRepo = manager.getRepository(Fulfillment);
      const fulfillment = await fulfillmentRepo.findOne({ where: { id: fulfillmentId, orderId } });
      if (!fulfillment) throw AppException.notFound("Fulfillment");
      if (fulfillment.status !== "success") {
        throw AppException.conflict("FULFILLMENT_ALREADY_CANCELLED", "The fulfillment is already cancelled");
      }
      const fLines = await manager.getRepository(FulfillmentLine).find({ where: { fulfillmentId } });

      for (const fl of fLines) {
        const affected = await execUpdate(
          manager,
          "UPDATE order_lines SET fulfilled_quantity = fulfilled_quantity - $1, updated_at = $2 WHERE id = $3 AND order_id = $4 AND fulfilled_quantity >= $1",
          [fl.quantity, this.clock.now(), fl.orderLineId, orderId],
        );
        if (affected !== 1) throw AppException.conflict("FULFILLMENT_INCONSISTENT", "Fulfilled quantities are inconsistent with this fulfillment");
        const line = lines.get(fl.orderLineId);
        if (line) line.fulfilledQuantity -= fl.quantity;
      }

      fulfillment.status = "cancelled";
      const saved = await fulfillmentRepo.save(fulfillment);

      const result = await this.syncOrderStatus(manager, order, lines);

      await recordOrderEvent(
        manager,
        orderId,
        "fulfillment.cancelled",
        { fulfillmentId, fulfillmentStatus: result.fulfillmentStatus, status: result.status },
        actor,
      );
      await this.auditService.record(
        { action: "order:fulfillment_cancel", entityType: "Order", entityId: orderId, diff: { fulfillmentId } },
        manager,
      );

      return { fulfillment: toFulfillmentDto(saved, fLines), order: result };
    });
  }

  /** Recomputes fulfillmentStatus and open<->completed from the (already updated) locked lines. */
  private async syncOrderStatus(
    manager: EntityManager,
    order: LockedOrder,
    lines: Map<string, LockedLine>,
  ): Promise<{ status: string; fulfillmentStatus: string }> {
    const fulfillmentStatus = computeFulfillmentStatus(lines.values());
    let status = order.status;
    if (fulfillmentStatus === "fulfilled" && status === "open") status = "completed";
    else if (fulfillmentStatus !== "fulfilled" && status === "completed") status = "open";

    const affected = await execUpdate(
      manager,
      "UPDATE orders SET fulfillment_status = $1, status = $2, version = version + 1, updated_at = $3 WHERE id = $4",
      [fulfillmentStatus, status, this.clock.now(), order.id],
    );
    if (affected !== 1) throw AppException.notFound("Order");
    return { status, fulfillmentStatus };
  }
}
