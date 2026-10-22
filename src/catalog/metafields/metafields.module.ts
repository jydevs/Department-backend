import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Metafield, Product, Collection } from "../entities";
import { MetafieldsService } from "./metafields.service";
import { ProductMetafieldsController, CollectionMetafieldsController } from "./metafields.controller";
import { AuditModule } from "../../audit/audit.module";
import { CatalogRevalidationModule } from "../revalidation/catalog-revalidation.module";
import { DatabaseModule } from "../../database/database.module";

@Module({
  imports: [TypeOrmModule.forFeature([Metafield, Product, Collection]), AuditModule, DatabaseModule, CatalogRevalidationModule],
  providers: [MetafieldsService],
  controllers: [ProductMetafieldsController, CollectionMetafieldsController],
  exports: [MetafieldsService],
})
export class MetafieldsModule {}
