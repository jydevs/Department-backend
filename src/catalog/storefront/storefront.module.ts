import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Product,
  Variant,
  ProductOption,
  ProductOptionValue,
  ProductMedia,
  Media,
  Collection,
  Metafield,
} from "../../catalog/entities";
import { StorefrontService } from "./storefront.service";
import { StorefrontController } from "./storefront.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      Variant,
      ProductOption,
      ProductOptionValue,
      ProductMedia,
      Media,
      Collection,
      Metafield,
    ]),
  ],
  providers: [StorefrontService],
  controllers: [StorefrontController],
  exports: [StorefrontService],
})
export class StorefrontModule {}
