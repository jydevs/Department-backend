import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Metafield, Product, Collection } from "../entities";
import { MetafieldsService } from "./metafields.service";
import { ProductMetafieldsController, CollectionMetafieldsController } from "./metafields.controller";
import { AuditModule } from "../../audit/audit.module";
import { DatabaseModule } from "../../database/database.module";
import { CatalogCacheModule } from "../cache/catalog-cache.module";

@Module({
  imports: [TypeOrmModule.forFeature([Metafield, Product, Collection]), AuditModule, DatabaseModule, CatalogCacheModule],
  providers: [MetafieldsService],
  controllers: [ProductMetafieldsController, CollectionMetafieldsController],
  exports: [MetafieldsService],
})
export class MetafieldsModule {}
