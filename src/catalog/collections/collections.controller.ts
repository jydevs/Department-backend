import { Controller, Get, Post, Patch, Delete, Put, Param, Body, Query, HttpCode } from "@nestjs/common";
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
  AddCollectionMembersDto,
  ReorderCollectionMemberDto,
  CollectionMemberParamDto,
  CollectionMember,
  CollectionMembersAddResult,
  PreviewRulesResponseDto,
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

  @Put(":id/products")
  @RequirePermissions("collections:write")
  async updateProducts(@Param() { id }: IdParamDto, @Body() input: UpdateCollectionProductsDto): Promise<void> {
    await this.collectionsService.updateProducts(id, input);
  }

  @Get(":id/products")
  @RequirePermissions("collections:read")
  async listMembers(@Param() { id }: IdParamDto, @Query() query: PageQueryDto): Promise<OffsetPage<CollectionMember>> {
    return this.collectionsService.listMembers(id, query.page, query.pageSize);
  }

  @Post(":id/products")
  @RequirePermissions("collections:write")
  async addMembers(@Param() { id }: IdParamDto, @Body() input: AddCollectionMembersDto): Promise<CollectionMembersAddResult> {
    return this.collectionsService.addMembers(id, input);
  }

  @Patch(":id/products/reorder")
  @HttpCode(204)
  @RequirePermissions("collections:write")
  async reorderMember(@Param() { id }: IdParamDto, @Body() input: ReorderCollectionMemberDto): Promise<void> {
    await this.collectionsService.reorderMember(id, input);
  }

  @Delete(":id/products/:productId")
  @HttpCode(204)
  @RequirePermissions("collections:write")
  async removeMember(@Param() { id, productId }: CollectionMemberParamDto): Promise<void> {
    await this.collectionsService.removeMember(id, productId);
  }

  @Post("preview-rules")
  @RequirePermissions("collections:write")
  async previewRules(@Body() input: PreviewRulesDto): Promise<PreviewRulesResponseDto> {
    return this.collectionsService.previewRules(input);
  }
}
