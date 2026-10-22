import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditModule } from "../../audit/audit.module";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { DatabaseModule } from "../../database/database.module";
import { InventoryModule } from "../../inventory/inventory.module";
import { Order, OrderEvent, Payment, ProcessedEvent } from "../entities";
import { OrdersLifecycleModule } from "../orders/orders-lifecycle.module";
import { PricingModule } from "../pricing/pricing.module";
import { MockPaymentController } from "./mock-payment.controller";
import { MockProvider } from "./mock.provider";
import { PaymentEventsService } from "./payment-events.service";
import { PaymentReconcileScheduler } from "./payment-reconcile.scheduler";
import { PAYMENT_PROVIDER, PaymentProvider } from "./payment-provider";
import { WompiProvider } from "./wompi.provider";
import { WompiWebhookController } from "./wompi-webhook.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderEvent, Payment, ProcessedEvent]),
    DatabaseModule,
    InventoryModule,
    PricingModule,
    AuditModule,
    OrdersLifecycleModule,
  ],
  providers: [
    WompiProvider,
    MockProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ENV, WompiProvider, MockProvider],
      useFactory: (env: Env, wompi: WompiProvider, mock: MockProvider): PaymentProvider => (env.PAYMENT_PROVIDER === "wompi" ? wompi : mock),
    },
    PaymentEventsService,
    PaymentReconcileScheduler,
  ],
  controllers: [WompiWebhookController, MockPaymentController],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
