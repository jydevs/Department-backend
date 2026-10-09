import { Inject, Injectable } from "@nestjs/common";
import { AppException } from "../../common/errors/app-exception";
import { Clock } from "../../common/clock/clock";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { MailService } from "../../mail/mail.service";
import { formatCop, loadOrderMailContext, orderNumberLabel, orderUrl } from "./order-mail";
import { TransactionService } from "../../database/transaction.service";
import { AuditService } from "../../audit/audit.service";
import { InventoryService } from "../../inventory/inventory.service";
import { Refund } from "../entities/refund.entity";
import { RefundLine } from "../entities/refund-line.entity";
import { RefundCreateInput, RefundResultDto } from "./dto/orders-admin.dto";
import { REFUND_PENDING_TAG } from "./orders-lifecycle.service";
import { toRefundDto } from "./order-mappers";
import { EventActor, execUpdate, lockLines, lockOrder, recordOrderEvent } from "./order-support";

@Injectable()
export class RefundsService {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly auditService: AuditService,
    private readonly inventory: InventoryService,
    private readonly clock: Clock,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(orderId: string, input: RefundCreateInput, actor: EventActor): Promise<RefundResultDto> {
    const refundLines = input.lines ?? [];
    if (input.restock && refundLines.length === 0) {
      throw AppException.badRequest("RESTOCK_REQUIRES_LINES", "restock requires the lines being returned");
    }

    return this.transactionService.run(async (manager) => {
      const order = await lockOrder(manager, orderId);
      // cancelled/expired orders can hold money (late approval, paid order cancelled): they must be refundable too
      const refundableStatus = ["open", "completed", "cancelled", "expired"];
      if (!refundableStatus.includes(order.status)) {
        throw AppException.conflict("ORDER_NOT_REFUNDABLE", "Only open, completed, cancelled or expired orders can be refunded");
      }
      if (order.paymentStatus !== "paid" && order.paymentStatus !== "partially_refunded") {
        throw AppException.conflict("ORDER_NOT_PAID", "Only paid orders can be refunded");
      }

      // Validated against the locked values, never against what the client believes.
      const refundable = order.total - order.totalRefunded;
      if (input.amount > refundable) {
        throw AppException.conflict("REFUND_EXCEEDS_PAID", "Refund amount exceeds the amount still refundable", {
          refundable,
          requested: input.amount,
        });
      }

      const lines = await lockLines(manager, orderId);
      const problems: { orderLineId: string; reason: string; refundable?: number }[] = [];
      for (const item of refundLines) {
        const line = lines.get(item.orderLineId);
        if (!line) problems.push({ orderLineId: item.orderLineId, reason: "LINE_NOT_IN_ORDER" });
        else if (item.quantity > line.quantity - line.refundedQuantity) {
          problems.push({ orderLineId: item.orderLineId, reason: "QUANTITY_EXCEEDS_REFUNDABLE", refundable: line.quantity - line.refundedQuantity });
        }
      }
      if (problems.length > 0) {
        throw AppException.conflict("REFUND_QUANTITY_INVALID", "Some quantities exceed the units still refundable", { lines: problems });
      }

      const now = this.clock.now();
      for (const item of refundLines) {
        const affected = await execUpdate(
          manager,
          "UPDATE order_lines SET refunded_quantity = refunded_quantity + $1, updated_at = $2 WHERE id = $3 AND order_id = $4 AND refunded_quantity + $1 <= quantity",
          [item.quantity, now, item.orderLineId, orderId],
        );
        if (affected !== 1) throw AppException.conflict("REFUND_QUANTITY_INVALID", "Quantity exceeds the line quantity");
      }

      if (input.restock) {
        const items = refundLines.map((l) => {
          const line = lines.get(l.orderLineId);
          if (!line) throw AppException.notFound("Order line");
          return { variantId: line.variantId, quantity: l.quantity };
        });
        await this.inventory.restock(items, manager, "returned");
      }

      const newTotalRefunded = order.totalRefunded + input.amount;
      const paymentStatus = newTotalRefunded >= order.total ? "refunded" : "partially_refunded";
      const affected = await execUpdate(
        manager,
        "UPDATE orders SET total_refunded = total_refunded + $1, payment_status = $2, version = version + 1, updated_at = $3 WHERE id = $4 AND total_refunded + $1 <= total",
        [input.amount, paymentStatus, now, orderId],
      );
      if (affected !== 1) throw AppException.conflict("REFUND_EXCEEDS_PAID", "Refund amount exceeds the amount still refundable");

      const untagged =
        newTotalRefunded >= order.total
          ? await execUpdate(manager, "UPDATE orders SET tags = array_remove(tags, $2) WHERE id = $1 AND $2 = ANY(tags)", [orderId, REFUND_PENDING_TAG])
          : 0;
      if (untagged > 0) {
        await recordOrderEvent(manager, orderId, "order.refund_pending_cleared", { totalRefunded: newTotalRefunded }, actor);
      }

      const refundRepo = manager.getRepository(Refund);
      const refund = await refundRepo.save(
        refundRepo.create({
          orderId,
          amount: input.amount,
          reason: input.reason ?? null,
          restocked: input.restock,
          providerStatus: "manual", // the real money movement is done by hand in the Wompi dashboard
          actorId: actor.id,
        }),
      );
      const lineRepo = manager.getRepository(RefundLine);
      const savedLines = refundLines.length
        ? await lineRepo.save(refundLines.map((l) => lineRepo.create({ refundId: refund.id, orderLineId: l.orderLineId, quantity: l.quantity })))
        : [];

      await recordOrderEvent(
        manager,
        orderId,
        "refund.created",
        {
          refundId: refund.id,
          amount: input.amount,
          reason: input.reason ?? null,
          lines: refundLines,
          restocked: input.restock,
          providerStatus: "manual",
          totalRefunded: newTotalRefunded,
          paymentStatus,
        },
        actor,
      );
      await this.auditService.record(
        {
          action: "order:refund",
          entityType: "Order",
          entityId: orderId,
          diff: { refundId: refund.id, amount: input.amount, restocked: input.restock, lines: refundLines, paymentStatus },
        },
        manager,
      );

      const ctx = await loadOrderMailContext(manager, orderId);
      if (ctx) {
        await this.mail.enqueue(
          {
            to: ctx.email,
            template: "refund_issued",
            data: {
              customerName: ctx.customerName,
              orderNumber: orderNumberLabel(ctx.orderNumber),
              amount: formatCop(input.amount),
              orderUrl: orderUrl(this.env.STOREFRONT_URL, ctx.orderNumber),
            },
          },
          manager,
        );
      }

      return { refund: toRefundDto(refund, savedLines), order: { paymentStatus, totalRefunded: newTotalRefunded } };
    });
  }
}
