import { Module } from "@nestjs/common";
import { ContentModule } from "../../cms/content/content.module";
import { DatabaseModule } from "../../database/database.module";
import { CatalogCacheService } from "./catalog-cache.service";

@Module({
  imports: [ContentModule, DatabaseModule],
  providers: [CatalogCacheService],
  exports: [CatalogCacheService],
})
export class CatalogCacheModule {}
