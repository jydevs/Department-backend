import { Controller, Get, Param, Query, Header } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";
import { Public } from "../../common/auth/decorators";
import { HandleParamDto } from "../../common/params/params";
import { CursorPage } from "../../common/pagination/pagination";
import { AppException } from "../../common/errors/app-exception";
import {
  StorefrontProductSummary,
  StorefrontProductDetails,
  StorefrontCollectionSummary,
  StorefrontCollectionDetails,
  StorefrontProductsQueryDto,
  StorefrontSearchQueryDto,
  StorefrontCollectionQueryDto,
} from "./dto";

// @Header is applied only on success, so a 400/404 is never cached.
const CACHE = "public, s-maxage=60, stale-while-revalidate=300";

@Controller("storefront")
@Public()
export class StorefrontController {
  constructor(private readonly storefrontService: StorefrontService) {}

  @Get("products")
  @Header("Cache-Control", CACHE)
  listProducts(@Query() query: StorefrontProductsQueryDto): Promise<CursorPage<StorefrontProductSummary> & { total: number }> {
    return this.storefrontService.listProducts(query);
  }

  @Get("products/:handle")
  @Header("Cache-Control", CACHE)
  async getProductByHandle(@Param() { handle }: HandleParamDto): Promise<StorefrontProductDetails> {
    const product = await this.storefrontService.getProductByHandle(handle);
    if (!product) {
      throw AppException.notFound("Product");
    }
    return product;
  }

  @Get("collections")
  @Header("Cache-Control", CACHE)
  listCollections(): Promise<StorefrontCollectionSummary[]> {
    return this.storefrontService.listCollections();
  }

  @Get("collections/:handle")
  @Header("Cache-Control", CACHE)
  async getCollectionByHandle(
    @Param() { handle }: HandleParamDto,
    @Query() query: StorefrontCollectionQueryDto,
  ): Promise<{ collection: StorefrontCollectionDetails; products: CursorPage<StorefrontProductSummary> & { total: number } }> {
    const result = await this.storefrontService.getCollectionPage(handle, query);
    if (!result) {
      throw AppException.notFound("Collection");
    }
    return result;
  }

  @Get("search")
  @Header("Cache-Control", CACHE)
  search(@Query() query: StorefrontSearchQueryDto) {
    return this.storefrontService.search(query);
  }
}
