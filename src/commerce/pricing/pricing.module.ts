import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Discount, DiscountRedemption, ShippingRate, ShippingZone, TaxSetting } from "../entities";
import { Variant } from "../../catalog/entities/variant.entity";
import { DatabaseModule } from "../../database/database.module";
import { InventoryModule } from "../../inventory/inventory.module";
import { PricingService } from "./pricing.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([Variant, Discount, DiscountRedemption, ShippingRate, ShippingZone, TaxSetting]),
    DatabaseModule,
    InventoryModule,
  ],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
