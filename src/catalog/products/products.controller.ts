import { Controller, Get, Post, Patch, Delete, Put, Param, Body, Query } from "@nestjs/common";
import { ProductsService, BulkActionResult } from "./products.service";
import { RequirePermissions } from "../../common/auth/decorators";
import { IdParamDto } from "../../common/params/params";
import {
  ProductListQueryDto,
  CreateProductDto,
  UpdateProductDto,
  ProductDetailResponseDto,
  ProductListItemResponseDto,
  CreateVariantDto,
  UpdateVariantDto,
  VariantResponseDto,
  UpdateOptionsDto,
  UpdateMediaDto,
  BulkActionDto,
  VariantParamsDto,
} from "./dto";
import { OffsetPage } from "../../common/pagination/pagination";
import { AppException } from "../../common/errors/app-exception";

@Controller("admin/products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions("products:read")
  async listProducts(@Query() query: ProductListQueryDto): Promise<OffsetPage<ProductListItemResponseDto>> {
    const { page, pageSize, status, q, tag, vendor } = query;
    return this.productsService.list(page, pageSize, { status, q, tag, vendor });
  }

  @Post()
  @RequirePermissions("products:write")
  async createProduct(@Body() input: CreateProductDto): Promise<ProductDetailResponseDto> {
    return this.productsService.create(input);
  }

  @Post("bulk")
  @RequirePermissions("products:write")
  async bulkAction(@Body() input: BulkActionDto): Promise<BulkActionResult> {
    return this.productsService.bulkAction(input);
  }

  @Get(":id")
  @RequirePermissions("products:read")
  async getProduct(@Param() { id }: IdParamDto): Promise<ProductDetailResponseDto> {
    const product = await this.productsService.findById(id);
    if (!product) {
      throw AppException.notFound("Product");
    }
    return product;
  }

  @Patch(":id")
  @RequirePermissions("products:write")
  async updateProduct(@Param() { id }: IdParamDto, @Body() input: UpdateProductDto): Promise<ProductDetailResponseDto> {
    return this.productsService.update(id, input);
  }

  @Delete(":id")
  @RequirePermissions("products:write")
  async deleteProduct(@Param() { id }: IdParamDto): Promise<void> {
    await this.productsService.delete(id);
  }

  @Post(":id/duplicate")
  @RequirePermissions("products:write")
  async duplicateProduct(@Param() { id }: IdParamDto): Promise<ProductDetailResponseDto> {
    return this.productsService.duplicate(id);
  }

  @Post(":id/publish")
  @RequirePermissions("products:write")
  async publishProduct(@Param() { id }: IdParamDto): Promise<ProductDetailResponseDto> {
    return this.productsService.publish(id);
  }

  @Post(":id/archive")
  @RequirePermissions("products:write")
  async archiveProduct(@Param() { id }: IdParamDto): Promise<ProductDetailResponseDto> {
    return this.productsService.archive(id);
  }

  @Put(":id/options")
  @RequirePermissions("products:write")
  async updateOptions(@Param() { id }: IdParamDto, @Body() input: UpdateOptionsDto): Promise<ProductDetailResponseDto> {
    return this.productsService.updateOptions(id, input);
  }

  @Put(":id/media")
  @RequirePermissions("products:write")
  async updateMedia(@Param() { id }: IdParamDto, @Body() input: UpdateMediaDto): Promise<ProductDetailResponseDto> {
    return this.productsService.updateMedia(id, input);
  }

  @Post(":id/variants")
  @RequirePermissions("products:write")
  async createVariant(@Param() { id }: IdParamDto, @Body() input: CreateVariantDto): Promise<VariantResponseDto> {
    return this.productsService.createVariant(id, input);
  }

  @Patch(":id/variants/:variantId")
  @RequirePermissions("products:write")
  async updateVariant(@Param() { id, variantId }: VariantParamsDto, @Body() input: UpdateVariantDto): Promise<VariantResponseDto> {
    return this.productsService.updateVariant(id, variantId, input);
  }

  @Delete(":id/variants/:variantId")
  @RequirePermissions("products:write")
  async deleteVariant(@Param() { id, variantId }: VariantParamsDto): Promise<void> {
    await this.productsService.deleteVariant(id, variantId);
  }
}
