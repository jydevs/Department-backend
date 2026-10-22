import { Module } from "@nestjs/common";
import { RevalidationService } from "../../cms/content/revalidation.service";
import { CatalogRevalidationService } from "./catalog-revalidation.service";

/** RevalidationService is stateless (reads the global ENV), so it is provided here instead of importing the whole CMS content module. */
@Module({
  providers: [RevalidationService, CatalogRevalidationService],
  exports: [CatalogRevalidationService],
})
export class CatalogRevalidationModule {}
