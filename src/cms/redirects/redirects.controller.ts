import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { Public, RequirePermissions } from "../../common/auth/decorators";
import { IdParamDto } from "../../common/params/params";
import type { OffsetPage } from "../../common/pagination/pagination";
import { RedirectsService } from "./redirects.service";
import {
  RedirectCreateDto,
  RedirectListQueryDto,
  RedirectResponseDto,
  RedirectUpdateDto,
  StorefrontRedirectDto,
} from "./redirects.dto";

@Controller("admin/redirects")
export class RedirectsAdminController {
  constructor(private readonly redirects: RedirectsService) {}

  @Get()
  @RequirePermissions("content:read")
  list(@Query() { page, pageSize, q }: RedirectListQueryDto): Promise<OffsetPage<RedirectResponseDto>> {
    return this.redirects.list(page, pageSize, q);
  }

  @Get(":id")
  @RequirePermissions("content:read")
  get(@Param() { id }: IdParamDto): Promise<RedirectResponseDto> {
    return this.redirects.get(id);
  }

  @Post()
  @RequirePermissions("content:write")
  create(@Body() input: RedirectCreateDto): Promise<RedirectResponseDto> {
    return this.redirects.create(input);
  }

  @Patch(":id")
  @RequirePermissions("content:write")
  update(@Param() { id }: IdParamDto, @Body() input: RedirectUpdateDto): Promise<RedirectResponseDto> {
    return this.redirects.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("content:write")
  async remove(@Param() { id }: IdParamDto): Promise<void> {
    await this.redirects.remove(id);
  }
}

@Controller("storefront/redirects")
@Public()
export class RedirectsStorefrontController {
  constructor(private readonly redirects: RedirectsService) {}

  @Get()
  @Header("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300")
  list(): Promise<StorefrontRedirectDto[]> {
    return this.redirects.listActive();
  }
}
