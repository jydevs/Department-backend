import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditModule } from "../../audit/audit.module";
import { Media } from "../../catalog/entities";
import { ENV } from "../../config/config.module";
import { DatabaseModule } from "../../database/database.module";
import type { Env } from "../../config/env";
import { LocalDiskStorage } from "./local-disk.storage";
import { MediaFilesController } from "./media-files.controller";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";
import { STORAGE_DRIVER } from "./storage.driver";

@Module({
  imports: [TypeOrmModule.forFeature([Media]), AuditModule, DatabaseModule],
  controllers: [MediaController, MediaFilesController],
  providers: [
    MediaService,
    { provide: STORAGE_DRIVER, useFactory: (env: Env) => new LocalDiskStorage(env.UPLOAD_DIR, env.PUBLIC_URL), inject: [ENV] },
  ],
  exports: [MediaService, STORAGE_DRIVER],
})
export class MediaModule {}
