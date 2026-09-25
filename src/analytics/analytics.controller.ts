import { Controller, Get, Query } from "@nestjs/common";
import { RequirePermissions } from "../common/auth/decorators";
import { AnalyticsService } from "./analytics.service";
import {
  AnalyticsCustomersDto,
  AnalyticsOverviewDto,
  AnalyticsRangeQueryDto,
  AnalyticsSalesDto,
  AnalyticsSeriesQueryDto,
  AnalyticsTopProductsDto,
  TopProductsQueryDto,
} from "./dto/analytics.dto";

@Controller("admin/analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("overview")
  @RequirePermissions("analytics:read")
  overview(@Query() query: AnalyticsRangeQueryDto): Promise<AnalyticsOverviewDto> {
    return this.analytics.overview(query);
  }

  @Get("sales")
  @RequirePermissions("analytics:read")
  sales(@Query() query: AnalyticsSeriesQueryDto): Promise<AnalyticsSalesDto> {
    return this.analytics.sales(query);
  }

  @Get("top-products")
  @RequirePermissions("analytics:read")
  topProducts(@Query() query: TopProductsQueryDto): Promise<AnalyticsTopProductsDto> {
    return this.analytics.topProducts(query);
  }

  @Get("customers")
  @RequirePermissions("analytics:read")
  customers(@Query() query: AnalyticsSeriesQueryDto): Promise<AnalyticsCustomersDto> {
    return this.analytics.customers(query);
  }
}
