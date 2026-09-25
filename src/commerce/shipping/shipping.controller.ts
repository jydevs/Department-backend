import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public, RequirePermissions } from "../../common/auth/decorators";
import { IdParamDto } from "../../common/params/params";
import { CartToken } from "../cart/cart-token.decorator";
import { ShippingService } from "./shipping.service";
import {
  CreateRateDto,
  CreateZoneDto,
  ListRatesQueryDto,
  StorefrontRatesQueryDto,
  UpdateRateDto,
  UpdateZoneDto,
  type ShippingRateDto,
  type ShippingZoneDto,
  type StorefrontShippingRateDto,
} from "./shipping.dto";

@Controller("admin/shipping")
export class AdminShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Get("zones")
  @RequirePermissions("shipping:read")
  listZones(): Promise<ShippingZoneDto[]> {
    return this.shipping.listZones();
  }

  @Post("zones")
  @RequirePermissions("shipping:write")
  createZone(@Body() body: CreateZoneDto): Promise<ShippingZoneDto> {
    return this.shipping.createZone(body);
  }

  @Get("zones/:id")
  @RequirePermissions("shipping:read")
  getZone(@Param() { id }: IdParamDto): Promise<ShippingZoneDto> {
    return this.shipping.getZone(id);
  }

  @Patch("zones/:id")
  @RequirePermissions("shipping:write")
  updateZone(@Param() { id }: IdParamDto, @Body() body: UpdateZoneDto): Promise<ShippingZoneDto> {
    return this.shipping.updateZone(id, body);
  }

  @Delete("zones/:id")
  @HttpCode(204)
  @RequirePermissions("shipping:write")
  async deleteZone(@Param() { id }: IdParamDto): Promise<void> {
    await this.shipping.deleteZone(id);
  }

  @Get("rates")
  @RequirePermissions("shipping:read")
  listRates(@Query() query: ListRatesQueryDto): Promise<ShippingRateDto[]> {
    return this.shipping.listRates(query.zoneId);
  }

  @Post("rates")
  @RequirePermissions("shipping:write")
  createRate(@Body() body: CreateRateDto): Promise<ShippingRateDto> {
    return this.shipping.createRate(body);
  }

  @Get("rates/:id")
  @RequirePermissions("shipping:read")
  getRate(@Param() { id }: IdParamDto): Promise<ShippingRateDto> {
    return this.shipping.getRate(id);
  }

  @Patch("rates/:id")
  @RequirePermissions("shipping:write")
  updateRate(@Param() { id }: IdParamDto, @Body() body: UpdateRateDto): Promise<ShippingRateDto> {
    return this.shipping.updateRate(id, body);
  }

  @Delete("rates/:id")
  @HttpCode(204)
  @RequirePermissions("shipping:write")
  async deleteRate(@Param() { id }: IdParamDto): Promise<void> {
    await this.shipping.deleteRate(id);
  }
}

@Controller("storefront/shipping-rates")
@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class StorefrontShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Get()
  list(@Query() query: StorefrontRatesQueryDto, @CartToken() token: string): Promise<StorefrontShippingRateDto[]> {
    return this.shipping.ratesForCart(query.cartId, token, query.department);
  }
}
