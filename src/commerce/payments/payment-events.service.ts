import { Inject, Injectable, Logger } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { Clock } from "../../common/clock/clock";
import { AppException } from "../../common/errors/app-exception";
import { rowsOf } from "../../common/sql/query-result";
import { TransactionService } from "../../database/transaction.service";
import { Order, Payment } from "../entities";
import { OrdersLifecycleService } from "../orders/orders-lifecycle.service";
import { PAYMENT_PROVIDER, ParsedTransaction, PaymentProvider, VerifiedEvent, WebhookHeaders } from "./payment-provider";

export type PaymentEventOutcome =
  | "ignored"
  | "pending"
  | "stale"
  | "duplicate"
  | "unknown_reference"
  | "mismatch"
  | "paid"
  | "already_paid"
  | "late_approval"
  | "cancelled"
  | "no_change";

/** Provider-agnostic processing of a verified payment event; shared by the webhook and the dev mock endpoint. */
@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly transactions: TransactionService,
    private readonly lifecycle: OrdersLifecycleService,
    private readonly clock: Clock,
  ) {}

  /**
   * Verifies the signature BEFORE touching anything else. Invalid / missing signature or body => a generic 401.
   * Any error after verification propagates (500 => the gateway retries); a handled event returns normally (200).
   */
  async handleWebhook(headers: WebhookHeaders, rawBody: Buffer | undefined): Promise<PaymentEventOutcome> {
    const verified = rawBody && rawBody.length > 0 ? this.provider.verifyWebhook(headers, rawBody) : null;
    if (!verified) throw AppException.unauthorized("Invalid request");
    if (this.isStale(verified.event.timestamp)) {
      // Signed but outside the freshness window (replay protection): acknowledge with 200 and no effects.
      this.logger.warn(`Ignoring stale payment webhook (timestamp ${String(verified.event.timestamp)})`);
      return "stale";
    }
    return this.process(verified);
  }

  /** Only when the event carries a timestamp (Wompi: unix seconds): older/newer than +-24h is stale. */
  private isStale(timestamp: number | string | undefined): boolean {
    if (timestamp === undefined) return false;
    let ms: number;
    if (typeof timestamp === "number" || /^\d+$/.test(timestamp)) {
      const n = Number(timestamp);
      ms = n > 1e12 ? n : n * 1000;
    } else {
      ms = Date.parse(timestamp);
    }
    if (!Number.isFinite(ms)) return true;
    return Math.abs(this.clock.now().getTime() - ms) > 24 * 60 * 60 * 1000;
  }

  async process(verified: VerifiedEvent): Promise<PaymentEventOutcome> {
    const parsed = this.provider.parseTransaction(verified);
    if (!parsed) return "ignored";
    if (parsed.status !== "pending" && !(await this.confirmWithGateway(parsed))) return "ignored";
    return this.processParsed(verified.provider, parsed);
  }

  /**
   * The webhook is only a hint: before acting on a final status, ask the gateway (GET /transactions/{id}) and compare
   * reference, amount, currency and status. A failure to reach the gateway throws (500 => Wompi retries the webhook).
   * Providers without an API (mock) skip the check.
   */
  private async confirmWithGateway(parsed: ParsedTransaction): Promise<boolean> {
    if (!this.provider.fetchTransaction) return true;
    const remote = await this.provider.fetchTransaction(parsed.providerTransactionId);
    const same =
      remote !== null &&
      remote.reference === parsed.reference &&
      remote.amountInCents === parsed.amountInCents &&
      remote.currency === parsed.currency &&
      remote.status === parsed.status;
    if (!same) {
      this.logger.warn(`Payment event for transaction ${parsed.providerTransactionId} does not match the gateway's record: ignored`);
    }
    return same;
  }

  /** Applies a transaction state that is already trusted (verified webhook confirmed with the gateway, or fetched from the gateway). */
  async processParsed(providerName: VerifiedEvent["provider"], parsed: ParsedTransaction): Promise<PaymentEventOutcome> {
    const verified = { provider: providerName };
    const now = this.clock.now();

    return this.transactions.run(async (manager): Promise<PaymentEventOutcome> => {
      const inserted = await manager.query<{ id: string }[]>(
        `INSERT INTO processed_events (id, provider, event_id, processed_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4, $4)
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING id`,
        [uuidv7(), verified.provider, parsed.eventId, now],
      );
      if (rowsOf(inserted).length === 0) return "duplicate";

      const order = await manager
        .getRepository(Order)
        .findOne({ where: { paymentReference: parsed.reference }, lock: { mode: "pessimistic_write" } });
      if (!order) {
        this.logger.warn(`Payment event ${parsed.eventId} references an unknown order reference`);
        return "unknown_reference";
      }

      if (parsed.status === "pending") {
        // Keep the transaction id: a PENDING one (PSE, Nequi…) must not be expired under the buyer's feet, and the reconciliation job follows it up.
        const pendingPayment = await manager.getRepository(Payment).findOne({ where: { orderId: order.id, reference: order.paymentReference }, order: { createdAt: "DESC" } });
        if (order.status === "pending" && pendingPayment && pendingPayment.status === "pending") {
          pendingPayment.rawStatus = "PENDING";
          pendingPayment.providerTransactionId = parsed.providerTransactionId;
          if (parsed.method) pendingPayment.method = parsed.method;
          await manager.getRepository(Payment).save(pendingPayment);
          await this.lifecycle.recordEvent(manager, order.id, "payment.pending", { providerTransactionId: parsed.providerTransactionId, method: parsed.method ?? null });
        }
        return "pending";
      }

      if (parsed.amountInCents !== order.total * 100 || parsed.currency !== order.currency.toUpperCase()) {
        await this.lifecycle.recordEvent(manager, order.id, "payment.mismatch", {
          providerTransactionId: parsed.providerTransactionId,
          status: parsed.status,
          receivedAmountInCents: parsed.amountInCents,
          receivedCurrency: parsed.currency,
          expectedAmountInCents: order.total * 100,
          expectedCurrency: order.currency,
        });
        if (parsed.status === "approved") {
          // Money arrived but not for the expected amount/currency: never mark paid, an admin must refund it.
          await this.lifecycle.flagRefundPending(
            order.id,
            "order.refund_pending",
            { reason: "payment_mismatch", providerTransactionId: parsed.providerTransactionId, amountInCents: parsed.amountInCents },
            manager,
          );
        }
        return "mismatch";
      }

      const paymentRepo = manager.getRepository(Payment);
      const payment = await paymentRepo.findOne({ where: { orderId: order.id, reference: order.paymentReference }, order: { createdAt: "DESC" } });

      if (parsed.status === "approved") {
        if (order.status === "pending") {
          await this.lifecycle.markPaid(order.id, { providerTransactionId: parsed.providerTransactionId, method: parsed.method }, manager);
          return "paid";
        }
        if (order.status === "expired" || order.status === "cancelled") {
          // Money arrived for an order we already released: never reopen it, an admin must refund.
          if (payment) {
            payment.status = "approved";
            payment.rawStatus = "APPROVED";
            payment.providerTransactionId = parsed.providerTransactionId;
            if (parsed.method) payment.method = parsed.method;
            await paymentRepo.save(payment);
          }
          await manager.query(`UPDATE orders SET payment_status = 'paid', version = version + 1, updated_at = $2 WHERE id = $1`, [order.id, now]);
          await this.lifecycle.flagRefundPending(
            order.id,
            "payment.late_approval",
            { providerTransactionId: parsed.providerTransactionId, orderStatus: order.status, amountInCents: parsed.amountInCents },
            manager,
          );
          return "late_approval";
        }
        // Already paid: a second APPROVED with a different transaction id means the buyer paid twice.
        if (payment?.providerTransactionId !== parsed.providerTransactionId) {
          await this.lifecycle.flagRefundPending(
            order.id,
            "order.refund_pending",
            {
              reason: "duplicate_payment",
              providerTransactionId: parsed.providerTransactionId,
              paidProviderTransactionId: payment?.providerTransactionId ?? null,
              amountInCents: parsed.amountInCents,
            },
            manager,
          );
        }
        return "already_paid";
      }

      // declined | voided | error
      if (order.status === "pending") {
        if (payment) {
          payment.status = parsed.status;
          payment.rawStatus = parsed.status.toUpperCase();
          payment.providerTransactionId = parsed.providerTransactionId;
          if (parsed.method) payment.method = parsed.method;
          await paymentRepo.save(payment);
        }
        if (parsed.status === "declined" || parsed.status === "error") {
          // Decision: a DECLINED/ERROR transaction does NOT cancel the order. The buyer may retry the payment with the
          // same reference in Wompi (new transaction, same reference), so the order stays pending and holds its
          // reservation until it expires. Only VOIDED (the transaction was annulled) cancels.
          await this.lifecycle.recordEvent(manager, order.id, "payment.declined", {
            status: parsed.status,
            providerTransactionId: parsed.providerTransactionId,
            method: parsed.method ?? null,
          });
          return "no_change";
        }
        await this.lifecycle.cancel(order.id, { reason: `payment_${parsed.status}`, restock: false }, manager);
        await manager.query(`UPDATE orders SET payment_status = 'failed', version = version + 1, updated_at = $2 WHERE id = $1`, [order.id, now]);
        return "cancelled";
      }
      await this.lifecycle.recordEvent(manager, order.id, "payment.status_ignored", {
        status: parsed.status,
        providerTransactionId: parsed.providerTransactionId,
        orderStatus: order.status,
      });
      return "no_change";
    });
  }
}
