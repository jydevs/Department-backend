import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { memoryStorage } from "multer";
import { RequirePermissions } from "../../common/auth/decorators";
import type { OffsetPage } from "../../common/pagination/pagination";
import { IdParamDto } from "../../common/params/params";
import { MediaListQueryDto, MediaDeleteQueryDto, UpdateMediaAltDto, type MediaResponseDto, type MediaUsageDto } from "./media.dto";
import { MAX_UPLOAD_BYTES, MediaService } from "./media.service";

@Controller("admin/media")
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @RequirePermissions("media:write")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Res({ passthrough: true }) res: Response): Promise<MediaResponseDto> {
    const result = await this.media.upload(file);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.media;
  }

  @Get()
  @RequirePermissions("content:read")
  list(@Query() { page, pageSize, q }: MediaListQueryDto): Promise<OffsetPage<MediaResponseDto>> {
    return this.media.list(page, pageSize, q);
  }

  @Get(":id/usages")
  @RequirePermissions("content:read")
  usages(@Param() { id }: IdParamDto): Promise<MediaUsageDto[]> {
    return this.media.usages(id);
  }

  @Patch(":id")
  @RequirePermissions("media:write")
  update(@Param() { id }: IdParamDto, @Body() { alt }: UpdateMediaAltDto): Promise<MediaResponseDto> {
    return this.media.updateAlt(id, alt);
  }

  @Delete(":id")
  @RequirePermissions("media:write")
  async remove(@Param() { id }: IdParamDto, @Query() { force }: MediaDeleteQueryDto): Promise<void> {
    await this.media.remove(id, force);
  }
}
