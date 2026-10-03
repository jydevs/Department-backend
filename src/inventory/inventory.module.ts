import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Location, InventoryLevel, InventoryAdjustment } from "./entities";
import { Variant } from "../catalog/entities/variant.entity";
import { InventoryService } from "./inventory.service";
import { LocationsController } from "./controllers/locations.controller";
import { InventoryController } from "./controllers/inventory.controller";
import { AuditModule } from "../audit/audit.module";
import { DatabaseModule } from "../database/database.module";
import { CatalogCacheModule } from "../catalog/cache/catalog-cache.module";

@Module({
  imports: [TypeOrmModule.forFeature([Location, InventoryLevel, InventoryAdjustment, Variant]), AuditModule, DatabaseModule, CatalogCacheModule],
  providers: [InventoryService],
  controllers: [LocationsController, InventoryController],
  exports: [InventoryService],
})
export class InventoryModule {}
