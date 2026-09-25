import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Cart, CartLine } from "../entities";
import { DatabaseModule } from "../../database/database.module";
import { InventoryModule } from "../../inventory/inventory.module";
import { PricingModule } from "../pricing";
import { CartController } from "./cart.controller";
import { CartService } from "./cart.service";
import { CartCleanupScheduler } from "./cart-cleanup.scheduler";

@Module({
  imports: [TypeOrmModule.forFeature([Cart, CartLine]), DatabaseModule, InventoryModule, PricingModule],
  controllers: [CartController],
  providers: [CartService, CartCleanupScheduler],
  exports: [CartService],
})
export class CartModule {}
