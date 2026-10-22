import { Controller, Get, Post, Patch, Delete, Put, Param, Body, Query } from "@nestjs/common";
import { CollectionsService } from "./collections.service";
import { RequirePermissions } from "../../common/auth/decorators";
import { PageQueryDto, toOffsetPage, OffsetPage } from "../../common/pagination/pagination";
import { IdParamDto } from "../../common/params/params";
import { AppException } from "../../common/errors/app-exception";
import {
  CreateCollectionDto,
  UpdateCollectionDto,
  CollectionDto,
  UpdateCollectionProductsDto,
  PreviewRulesDto,
  PreviewRulesResponseDto,
  CollectionProductsResponseDto,
} from "./dto";

@Controller("admin/collections")
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Get()
  @RequirePermissions("collections:read")
  async list(@Query() query: PageQueryDto): Promise<OffsetPage<CollectionDto>> {
    const { page, pageSize } = query;
    const { items, total } = await this.collectionsService.list(page, pageSize);
    return toOffsetPage(items, total, page, pageSize);
  }

  @Post()
  @RequirePermissions("collections:write")
  async create(@Body() input: CreateCollectionDto): Promise<CollectionDto> {
    return this.collectionsService.create(input);
  }

  @Get(":id")
  @RequirePermissions("collections:read")
  async getById(@Param() { id }: IdParamDto): Promise<CollectionDto> {
    const collection = await this.collectionsService.findById(id);
    if (!collection) {
      throw AppException.notFound("Collection");
    }
    return collection;
  }

  @Patch(":id")
  @RequirePermissions("collections:write")
  async update(@Param() { id }: IdParamDto, @Body() input: UpdateCollectionDto): Promise<CollectionDto> {
    return this.collectionsService.update(id, input);
  }

  @Delete(":id")
  @RequirePermissions("collections:write")
  async delete(@Param() { id }: IdParamDto): Promise<void> {
    await this.collectionsService.delete(id);
  }

  @Get(":id/products")
  @RequirePermissions("collections:read")
  async listProducts(@Param() { id }: IdParamDto): Promise<CollectionProductsResponseDto> {
    return this.collectionsService.listProducts(id);
  }

  @Put(":id/products")
  @RequirePermissions("collections:write")
  async updateProducts(@Param() { id }: IdParamDto, @Body() input: UpdateCollectionProductsDto): Promise<void> {
    await this.collectionsService.updateProducts(id, input);
  }

  @Post("preview-rules")
  @RequirePermissions("collections:write")
  async previewRules(@Body() input: PreviewRulesDto): Promise<PreviewRulesResponseDto> {
    return this.collectionsService.previewRules(input);
  }
}
