import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { RequirePermissions } from "../../common/auth/decorators";
import { IdParamDto } from "../../common/params/params";
import { OffsetPage, PageQueryDto } from "../../common/pagination/pagination";
import { DiscountsService } from "./discounts.service";
import {
  CreateDiscountDto,
  ListDiscountsQueryDto,
  UpdateDiscountDto,
  type DiscountDto,
  type DiscountRedemptionDto,
} from "./discounts.dto";

@Controller("admin/discounts")
export class DiscountsController {
  constructor(private readonly discounts: DiscountsService) {}

  @Get()
  @RequirePermissions("discounts:read")
  list(@Query() query: ListDiscountsQueryDto): Promise<OffsetPage<DiscountDto>> {
    return this.discounts.list(query);
  }

  @Post()
  @RequirePermissions("discounts:write")
  create(@Body() body: CreateDiscountDto): Promise<DiscountDto> {
    return this.discounts.create(body);
  }

  @Get(":id")
  @RequirePermissions("discounts:read")
  get(@Param() { id }: IdParamDto): Promise<DiscountDto> {
    return this.discounts.get(id);
  }

  @Patch(":id")
  @RequirePermissions("discounts:write")
  update(@Param() { id }: IdParamDto, @Body() body: UpdateDiscountDto): Promise<DiscountDto> {
    return this.discounts.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("discounts:write")
  async remove(@Param() { id }: IdParamDto): Promise<void> {
    await this.discounts.remove(id);
  }

  @Get(":id/redemptions")
  @RequirePermissions("discounts:read")
  redemptions(@Param() { id }: IdParamDto, @Query() { page, pageSize }: PageQueryDto): Promise<OffsetPage<DiscountRedemptionDto>> {
    return this.discounts.redemptions(id, page, pageSize);
  }
}
