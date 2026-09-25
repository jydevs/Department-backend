import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../../database/database.module";
import { ContentModule } from "../content/content.module";
import { Redirect } from "../entities";
import { RedirectsAdminController, RedirectsStorefrontController } from "./redirects.controller";
import { RedirectsService } from "./redirects.service";

@Module({
  imports: [TypeOrmModule.forFeature([Redirect]), DatabaseModule, ContentModule],
  providers: [RedirectsService],
  controllers: [RedirectsAdminController, RedirectsStorefrontController],
  exports: [RedirectsService],
})
export class RedirectsModule {}
