import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../../database/database.module";
import { ContentDocument, ContentVersion } from "../entities";
import { ContentAdminController } from "./content-admin.controller";
import { ContentStorefrontController } from "./content-storefront.controller";
import { ContentScheduler } from "./content.scheduler";
import { ContentService } from "./content.service";
import { PreviewService } from "./preview.service";
import { RevalidationService } from "./revalidation.service";
import { StorefrontContentService } from "./storefront-content.service";

@Module({
  imports: [TypeOrmModule.forFeature([ContentDocument, ContentVersion]), DatabaseModule],
  providers: [ContentService, ContentScheduler, PreviewService, RevalidationService, StorefrontContentService],
  controllers: [ContentAdminController, ContentStorefrontController],
  exports: [ContentService, RevalidationService, PreviewService],
})
export class ContentModule {}
