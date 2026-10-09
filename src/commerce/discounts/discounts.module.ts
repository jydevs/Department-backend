import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Discount, DiscountRedemption } from "../entities";
import { DatabaseModule } from "../../database/database.module";
import { DiscountsController } from "./discounts.controller";
import { DiscountsService } from "./discounts.service";

@Module({
  imports: [TypeOrmModule.forFeature([Discount, DiscountRedemption]), DatabaseModule],
  controllers: [DiscountsController],
  providers: [DiscountsService],
  exports: [DiscountsService],
})
export class DiscountsModule {}
