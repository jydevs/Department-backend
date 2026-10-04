import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Product, Variant, ProductOption, ProductOptionValue, ProductMedia, Media } from "../entities";
import { ProductsService } from "./products.service";
import { ProductsController } from "./products.controller";
import { AuditModule } from "../../audit/audit.module";
import { DatabaseModule } from "../../database/database.module";
import { CatalogCacheModule } from "../cache/catalog-cache.module";

@Module({
  imports: [TypeOrmModule.forFeature([Product, Variant, ProductOption, ProductOptionValue, ProductMedia, Media]), AuditModule, DatabaseModule, CatalogCacheModule],
  providers: [ProductsService],
  controllers: [ProductsController],
  exports: [ProductsService],
})
export class ProductsModule {}
