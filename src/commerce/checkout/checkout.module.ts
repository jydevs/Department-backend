import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditModule } from "../../audit/audit.module";
import { DatabaseModule } from "../../database/database.module";
import { InventoryModule } from "../../inventory/inventory.module";
import {
  Cart,
  CartLine,
  Discount,
  DiscountRedemption,
  Fulfillment,
  IdempotencyKey,
  Order,
  OrderEvent,
  OrderLine,
  Payment,
} from "../entities";
import { PaymentsModule } from "../payments/payments.module";
import { PricingModule } from "../pricing/pricing.module";
import { CheckoutController } from "./checkout.controller";
import { CheckoutService } from "./checkout.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Cart,
      CartLine,
      Order,
      OrderLine,
      OrderEvent,
      Payment,
      Fulfillment,
      Discount,
      DiscountRedemption,
      IdempotencyKey,
    ]),
    DatabaseModule,
    InventoryModule,
    PricingModule,
    AuditModule,
    PaymentsModule,
  ],
  providers: [CheckoutService],
  controllers: [CheckoutController],
})
export class CheckoutModule {}
