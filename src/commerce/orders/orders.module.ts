import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../../database/database.module";
import { InventoryModule } from "../../inventory/inventory.module";
import { Order } from "../entities/order.entity";
import { OrderLine } from "../entities/order-line.entity";
import { OrderEvent } from "../entities/order-event.entity";
import { Payment } from "../entities/payment.entity";
import { Fulfillment } from "../entities/fulfillment.entity";
import { FulfillmentLine } from "../entities/fulfillment-line.entity";
import { Refund } from "../entities/refund.entity";
import { RefundLine } from "../entities/refund-line.entity";
import { OrdersLifecycleModule } from "./orders-lifecycle.module";
import { OrdersAdminController } from "./orders-admin.controller";
import { OrdersAdminService } from "./orders-admin.service";
import { FulfillmentsService } from "./fulfillments.service";
import { RefundsService } from "./refunds.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderLine, OrderEvent, Payment, Fulfillment, FulfillmentLine, Refund, RefundLine]),
    DatabaseModule,
    InventoryModule,
    OrdersLifecycleModule,
  ],
  controllers: [OrdersAdminController],
  providers: [OrdersAdminService, FulfillmentsService, RefundsService],
  exports: [OrdersAdminService],
})
export class OrdersModule {}
