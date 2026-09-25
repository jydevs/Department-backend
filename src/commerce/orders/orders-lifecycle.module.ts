import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditModule } from "../../audit/audit.module";
import { DatabaseModule } from "../../database/database.module";
import { InventoryModule } from "../../inventory/inventory.module";
import { Discount, DiscountRedemption, Order, OrderEvent, OrderLine, Payment } from "../entities";
import { OrdersLifecycleService } from "./orders-lifecycle.service";
import { OrdersScheduler } from "./orders.scheduler";

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderLine, OrderEvent, Payment, Discount, DiscountRedemption]),
    DatabaseModule,
    InventoryModule,
    AuditModule,
  ],
  providers: [OrdersLifecycleService, OrdersScheduler],
  exports: [OrdersLifecycleService],
})
export class OrdersLifecycleModule {}
