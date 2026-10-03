import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditModule } from "../audit/audit.module";
import { CatalogCacheModule } from "../catalog/cache/catalog-cache.module";
import { DatabaseModule } from "../database/database.module";
import { CustomerImporter } from "./customer-importer";
import { ImportJob } from "./entities/import-job.entity";
import { ImportFileStorage } from "./import-file.storage";
import { ImportWorker } from "./import.worker";
import { ImportsController } from "./imports.controller";
import { ImportsService } from "./imports.service";
import { ProductImporter } from "./product-importer";

/** Shopify CSV importer (products and customers). The CSVs live in UPLOAD_DIR/imports and are never served. */
@Module({
  imports: [TypeOrmModule.forFeature([ImportJob]), DatabaseModule, AuditModule, CatalogCacheModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportWorker, ImportFileStorage, ProductImporter, CustomerImporter],
  exports: [ImportsService],
})
export class ImportsModule {}
