import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ShippingRate, ShippingZone } from "../entities";
import { DatabaseModule } from "../../database/database.module";
import { CartModule } from "../cart/cart.module";
import { AdminShippingController, StorefrontShippingController } from "./shipping.controller";
import { ShippingService } from "./shipping.service";

@Module({
  imports: [TypeOrmModule.forFeature([ShippingZone, ShippingRate]), DatabaseModule, CartModule],
  controllers: [AdminShippingController, StorefrontShippingController],
  providers: [ShippingService],
  exports: [ShippingService],
})
export class ShippingModule {}
