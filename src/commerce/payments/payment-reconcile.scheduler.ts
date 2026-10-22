import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Clock } from "../../common/clock/clock";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { TransactionService } from "../../database/transaction.service";
import { PaymentEventsService } from "./payment-events.service";
import { PAYMENT_PROVIDER, PaymentProvider } from "./payment-provider";

const INTERVAL_MS = 60_000;
const BATCH = 50;
/** Orders closer than this to their reservation deadline (or with a PENDING gateway transaction) are checked against the gateway. */
const LOOKAHEAD_MS = 3 * 60_000;
const MIN_AGE_MS = 2 * 60_000;

/**
 * Safety net for lost webhooks: asks the gateway (GET /transactions) about `pending` orders that are about to expire or hold a
 * PENDING transaction, and applies the answer through the same code as a webhook. Only with real Wompi keys; the mock never runs it.
 */
@Injectable()
export class PaymentReconcileScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentReconcileScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly events: PaymentEventsService,
    private readonly transactions: TransactionService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (!this.enabled()) return;
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private enabled(): boolean {
    if (this.env.NODE_ENV === "test" && process.env.ORDERS_SCHEDULER_ENABLED === "false") return false;
    return this.env.PAYMENT_PROVIDER === "wompi" && !!this.env.WOMPI_PUBLIC_KEY && !!this.provider.fetchTransactionsByReference;
  }

  async tick(): Promise<void> {
    if (this.running || !this.enabled()) return;
    this.running = true;
    try {
      const now = this.clock.now();
      const rows = await this.transactions.run((m) =>
        m.query<{ payment_reference: string; provider_transaction_id: string | null }[]>(
          `SELECT o.payment_reference, (
                    SELECT p.provider_transaction_id FROM payments p
                    WHERE p.order_id = o.id AND p.provider_transaction_id IS NOT NULL ORDER BY p.created_at DESC LIMIT 1
                  ) AS provider_transaction_id
             FROM orders o
            WHERE o.status = 'pending' AND o.payment_provider = 'wompi' AND o.created_at <= $1
              AND ((o.reserved_until IS NOT NULL AND o.reserved_until <= $2)
                   OR EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'pending' AND p.provider_transaction_id IS NOT NULL))
            ORDER BY o.reserved_until ASC NULLS LAST
            LIMIT $3`,
          [new Date(now.getTime() - MIN_AGE_MS), new Date(now.getTime() + LOOKAHEAD_MS), BATCH],
        ),
      );
      let applied = 0;
      for (const row of rows) {
        try {
          const found = row.provider_transaction_id
            ? [await this.provider.fetchTransaction?.(row.provider_transaction_id)].filter((t) => !!t)
            : (await this.provider.fetchTransactionsByReference?.(row.payment_reference)) ?? [];
          // the newest transaction of the reference decides; an APPROVED one wins over later attempts
          const tx = found.find((t) => t?.status === "approved") ?? found[0];
          if (!tx || tx.reference !== row.payment_reference) continue;
          const outcome = await this.events.processParsed("wompi", tx);
          if (outcome === "paid" || outcome === "cancelled" || outcome === "late_approval") applied++;
        } catch (err) {
          this.logger.warn(`Reconciliation of ${row.payment_reference} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (applied > 0) this.logger.log(`Reconciled ${applied} order(s) with the payment gateway`);
    } catch (err) {
      this.logger.error(`Payment reconciliation tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
