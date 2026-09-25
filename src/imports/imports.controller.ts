import { Body, Controller, Get, HttpCode, Param, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { memoryStorage } from "multer";
import { Actor } from "../common/auth/actor";
import { CurrentActor, RequirePermissions } from "../common/auth/decorators";
import type { OffsetPage } from "../common/pagination/pagination";
import { IdParamDto } from "../common/params/params";
import { CreateImportDto, ListImportsQueryDto, type ImportJobDetailDto, type ImportJobSummaryDto } from "./imports.dto";
import { ImportsService } from "./imports.service";
import { MAX_FILE_BYTES } from "./imports.types";

@ApiTags("admin-import")
@ApiBearerAuth()
@Controller("admin/import/jobs")
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post()
  @HttpCode(202)
  @RequirePermissions("import:write")
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload a Shopify CSV (field `file`) with `type` (products|customers) and `dryRun`; queues the job" })
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5, parts: 6, fieldSize: 1024 } }))
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: CreateImportDto,
    @CurrentActor() actor: Actor,
  ): Promise<ImportJobSummaryDto> {
    return this.imports.create(file, body.type, body.dryRun, actor.kind === "staff" ? actor.staffId : null);
  }

  @Get()
  @RequirePermissions("import:read")
  @ApiOperation({ summary: "List import jobs (newest first)" })
  list(@Query() query: ListImportsQueryDto): Promise<OffsetPage<ImportJobSummaryDto>> {
    return this.imports.list(query);
  }

  @Get(":id")
  @RequirePermissions("import:read")
  @ApiOperation({ summary: "Job progress, counters and row errors" })
  get(@Param() { id }: IdParamDto): Promise<ImportJobDetailDto> {
    return this.imports.get(id);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermissions("import:write")
  @ApiOperation({ summary: "Cancel a queued or running job" })
  cancel(@Param() { id }: IdParamDto): Promise<ImportJobSummaryDto> {
    return this.imports.cancel(id);
  }
}
