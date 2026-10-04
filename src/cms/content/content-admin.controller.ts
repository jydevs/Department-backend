import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import type { Actor } from "../../common/auth/actor";
import { OffsetPage, PageQueryDto } from "../../common/pagination/pagination";
import type { SectionTypeDescriptor } from "../sections/registry";
import { ContentService } from "./content.service";
import {
  CreatePageDto,
  DocumentDetailDto,
  DocumentListItemDto,
  DocumentParamsDto,
  ListDocumentsQueryDto,
  PageDeletedDto,
  PreviewTokenDto,
  PreviewTokenResponseDto,
  PublishDto,
  ScheduleDto,
  ScheduleParamsDto,
  UpsertDraftDto,
  VersionDetailDto,
  VersionParamsDto,
  VersionSummaryDto,
} from "./content.dto";
import { parseIfMatch } from "./content.util";

function staffId(actor: Actor): string | null {
  return actor.kind === "staff" ? actor.staffId : null;
}

@Controller("admin/content")
export class ContentAdminController {
  constructor(private readonly content: ContentService) {}

  @Get("section-types")
  @RequirePermissions("content:read")
  sectionTypes(): SectionTypeDescriptor[] {
    return this.content.sectionTypes();
  }

  @Post("preview-tokens")
  @HttpCode(201)
  @RequirePermissions("content:read")
  createPreviewToken(@Body() input: PreviewTokenDto): Promise<PreviewTokenResponseDto> {
    return this.content.createPreviewToken(input.kind, input.key);
  }

  @Post("pages")
  @RequirePermissions("content:write")
  createPage(@Body() input: CreatePageDto, @CurrentActor() actor: Actor): Promise<DocumentDetailDto> {
    return this.content.createPage(input, staffId(actor));
  }

  @Get("documents")
  @RequirePermissions("content:read")
  list(@Query() query: ListDocumentsQueryDto): Promise<DocumentListItemDto[]> {
    return this.content.list(query.kind);
  }

  @Get("documents/:kind/:key")
  @RequirePermissions("content:read")
  get(@Param() { kind, key }: DocumentParamsDto): Promise<DocumentDetailDto> {
    return this.content.get(kind, key);
  }

  @Put("documents/:kind/:key")
  @RequirePermissions("content:write")
  upsertDraft(
    @Param() { kind, key }: DocumentParamsDto,
    @Body() input: UpsertDraftDto,
    @Headers("if-match") ifMatch: string | undefined,
    @CurrentActor() actor: Actor,
  ): Promise<DocumentDetailDto> {
    return this.content.upsertDraft(kind, key, input, parseIfMatch(ifMatch), staffId(actor));
  }

  /** Pages only: soft delete. The response suggests a redirect to create. */
  @Delete("documents/:kind/:key")
  @RequirePermissions("content:write")
  deletePage(@Param() { kind, key }: DocumentParamsDto): Promise<PageDeletedDto> {
    return this.content.deletePage(kind, key);
  }

  @Post("documents/:kind/:key/publish")
  @HttpCode(200)
  @RequirePermissions("content:publish")
  publish(
    @Param() { kind, key }: DocumentParamsDto,
    @Body() input: PublishDto,
    @Headers("if-match") ifMatch: string | undefined,
    @CurrentActor() actor: Actor,
  ): Promise<DocumentDetailDto> {
    return this.content.publish(kind, key, input.note, staffId(actor), input.version ?? parseIfMatch(ifMatch));
  }

  @Post("documents/:kind/:key/schedule")
  @RequirePermissions("content:publish")
  schedule(
    @Param() { kind, key }: DocumentParamsDto,
    @Body() input: ScheduleDto,
    @Headers("if-match") ifMatch: string | undefined,
    @CurrentActor() actor: Actor,
  ): Promise<VersionSummaryDto> {
    return this.content.schedule(kind, key, input.publishAt, input.note, staffId(actor), input.version ?? parseIfMatch(ifMatch));
  }

  @Delete("documents/:kind/:key/schedule/:versionId")
  @HttpCode(204)
  @RequirePermissions("content:publish")
  async cancelSchedule(@Param() { kind, key, versionId }: ScheduleParamsDto): Promise<void> {
    await this.content.cancelSchedule(kind, key, versionId);
  }

  @Post("documents/:kind/:key/discard")
  @HttpCode(200)
  @RequirePermissions("content:write")
  discard(@Param() { kind, key }: DocumentParamsDto, @CurrentActor() actor: Actor): Promise<DocumentDetailDto> {
    return this.content.discard(kind, key, staffId(actor));
  }

  @Get("documents/:kind/:key/versions")
  @RequirePermissions("content:read")
  listVersions(@Param() { kind, key }: DocumentParamsDto, @Query() { page, pageSize }: PageQueryDto): Promise<OffsetPage<VersionSummaryDto>> {
    return this.content.listVersions(kind, key, page, pageSize);
  }

  @Get("documents/:kind/:key/versions/:versionId")
  @RequirePermissions("content:read")
  getVersion(@Param() { kind, key, versionId }: VersionParamsDto): Promise<VersionDetailDto> {
    return this.content.getVersion(kind, key, versionId);
  }

  @Post("documents/:kind/:key/versions/:versionId/restore")
  @HttpCode(200)
  @RequirePermissions("content:write")
  restore(@Param() { kind, key, versionId }: VersionParamsDto, @CurrentActor() actor: Actor): Promise<DocumentDetailDto> {
    return this.content.restore(kind, key, versionId, staffId(actor));
  }
}
