import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Collection, CollectionProduct, Product, Variant } from "../../catalog/entities";
import { CollectionsService } from "./collections.service";
import { CollectionsController } from "./collections.controller";
import { AuditModule } from "../../audit/audit.module";
import { DatabaseModule } from "../../database/database.module";
import { CatalogCacheModule } from "../cache/catalog-cache.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Collection, CollectionProduct, Product, Variant]),
    AuditModule,
    DatabaseModule,
    CatalogCacheModule,
  ],
  providers: [CollectionsService],
  controllers: [CollectionsController],
  exports: [CollectionsService],
})
export class CollectionsModule {}
