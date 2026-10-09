import { Controller, Get, Put, Param, Body } from "@nestjs/common";
import { MetafieldsService } from "./metafields.service";
import { RequirePermissions } from "../../common/auth/decorators";
import { MetafieldOwnerParamDto, MetafieldsListResponseDto, UpsertMetafieldsDto } from "./dto/metafield.dto";

/** Product metafields (permissions: products:*). Only the `custom` namespace is exposed publicly by the storefront. */
@Controller("admin/products/:id/metafields")
export class ProductMetafieldsController {
  constructor(private readonly metafieldsService: MetafieldsService) {}

  @Get()
  @RequirePermissions("products:read")
  async get(@Param() { id }: MetafieldOwnerParamDto): Promise<MetafieldsListResponseDto> {
    return { metafields: await this.metafieldsService.getMetafields("product", id) };
  }

  @Put()
  @RequirePermissions("products:write")
  async upsert(@Param() { id }: MetafieldOwnerParamDto, @Body() input: UpsertMetafieldsDto): Promise<MetafieldsListResponseDto> {
    return { metafields: await this.metafieldsService.upsertMetafields("product", id, input.metafields) };
  }
}

/** Collection metafields (permissions: collections:*). */
@Controller("admin/collections/:id/metafields")
export class CollectionMetafieldsController {
  constructor(private readonly metafieldsService: MetafieldsService) {}

  @Get()
  @RequirePermissions("collections:read")
  async get(@Param() { id }: MetafieldOwnerParamDto): Promise<MetafieldsListResponseDto> {
    return { metafields: await this.metafieldsService.getMetafields("collection", id) };
  }

  @Put()
  @RequirePermissions("collections:write")
  async upsert(@Param() { id }: MetafieldOwnerParamDto, @Body() input: UpsertMetafieldsDto): Promise<MetafieldsListResponseDto> {
    return { metafields: await this.metafieldsService.upsertMetafields("collection", id, input.metafields) };
  }
}
