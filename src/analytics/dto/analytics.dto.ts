import { createZodDto } from "nestjs-zod";
import { z } from "zod";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * Range bound. A bare `YYYY-MM-DD` is a calendar day in America/Bogota (UTC-5, no DST): a `from` becomes that day at
 * 00:00 Bogota, a `to` becomes the NEXT day at 00:00 Bogota (the service treats `to` as exclusive). Anything with an
 * explicit time is taken as given. (`z.coerce.date()` cannot be represented in JSON Schema, hence string + transform.)
 */
const rangeBound = (edge: "from" | "to") =>
  z
    .string()
    .max(40)
    .refine((v) => !Number.isNaN(DATE_ONLY.test(v) ? Date.parse(`${v}T00:00:00-05:00`) : Date.parse(v)), "Invalid date")
    .transform((v) => {
      if (!DATE_ONLY.test(v)) return new Date(v);
      const start = Date.parse(`${v}T00:00:00-05:00`);
      return new Date(edge === "to" ? start + DAY_MS : start);
    });

/* ── requests ─────────────────────────────────────────────── */

const optionalQuery = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

export const GROUP_BY_VALUES = ["day", "week", "month"] as const;
export type GroupBy = (typeof GROUP_BY_VALUES)[number];

const rangeShape = {
  /** Inclusive lower bound (a bare date = 00:00 Bogota). Default: `to` minus 30 days. */
  from: optionalQuery(rangeBound("from")),
  /** Exclusive upper bound (a bare date includes that whole Bogota day). Default: now. */
  to: optionalQuery(rangeBound("to")),
};

export const analyticsRangeQuerySchema = z.object(rangeShape);
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeQuerySchema>;
export class AnalyticsRangeQueryDto extends createZodDto(analyticsRangeQuerySchema) {}

export const analyticsSeriesQuerySchema = z.object({
  ...rangeShape,
  groupBy: z.enum(GROUP_BY_VALUES).default("day"),
});
export type AnalyticsSeriesQuery = z.infer<typeof analyticsSeriesQuerySchema>;
export class AnalyticsSeriesQueryDto extends createZodDto(analyticsSeriesQuerySchema) {}

export const topProductsQuerySchema = z.object({
  ...rangeShape,
  limit: z.coerce.number().int().min(1).max(50).default(10),
  sortBy: z.enum(["revenue", "units"]).default("revenue"),
});
export type TopProductsQuery = z.infer<typeof topProductsQuerySchema>;
export class TopProductsQueryDto extends createZodDto(topProductsQuerySchema) {}

/* ── responses (all money in whole COP) ───────────────────── */

export interface AnalyticsPeriodDto {
  /** ISO instants. */
  from: string;
  to: string;
}

export interface OverviewMetricsDto {
  /** Sum of `total` of paid orders (status open|completed, paid_at in range). */
  grossSales: number;
  totalRefunded: number;
  /** grossSales - totalRefunded. */
  netSales: number;
  paidOrders: number;
  /** netSales / paidOrders, rounded; 0 without orders. */
  averageOrderValue: number;
  newCustomers: number;
  /** Orders created in the range, by outcome. */
  createdOrders: number;
  createdOrdersPaid: number;
  createdOrdersExpired: number;
  createdOrdersCancelled: number;
  /** createdOrdersPaid / createdOrders in [0,1] (4 decimals); 0 without orders. */
  paidRate: number;
  expiredRate: number;
  cancelledRate: number;
}

/** Percentage change vs. the previous period (1 decimal); null when the previous value is 0. */
export interface OverviewChangeDto {
  netSales: number | null;
  paidOrders: number | null;
  averageOrderValue: number | null;
  newCustomers: number | null;
  paidRate: number | null;
}

export interface AnalyticsOverviewDto {
  timezone: string;
  period: AnalyticsPeriodDto;
  previousPeriod: AnalyticsPeriodDto;
  current: OverviewMetricsDto;
  previous: OverviewMetricsDto;
  change: OverviewChangeDto;
}

export interface SalesBucketDto {
  /** Bucket start as local date (America/Bogota), `YYYY-MM-DD`. */
  bucket: string;
  orders: number;
  grossSales: number;
  totalRefunded: number;
  netSales: number;
}

export interface AnalyticsSalesDto {
  timezone: string;
  groupBy: GroupBy;
  period: AnalyticsPeriodDto;
  buckets: SalesBucketDto[];
}

export interface TopProductDto {
  productId: string;
  /** Title of the most recently sold line of the product. */
  title: string;
  units: number;
  /** Sum of line totals (before refunds). */
  revenue: number;
  orders: number;
}

export interface AnalyticsTopProductsDto {
  period: AnalyticsPeriodDto;
  sortBy: "revenue" | "units";
  items: TopProductDto[];
}

export interface CustomerBucketDto {
  bucket: string;
  newCustomers: number;
}

export interface AnalyticsCustomersDto {
  timezone: string;
  groupBy: GroupBy;
  period: AnalyticsPeriodDto;
  /** Non-anonymized, non-deleted customers created in the range. */
  newCustomers: number;
  totalCustomers: number;
  marketingSubscribers: number;
  /** Distinct customers (linked orders) with a paid order in the range. */
  buyers: number;
  /** Buyers with 2+ paid orders in the range. */
  repeatBuyers: number;
  /** Paid orders in the range not linked to a customer account. */
  guestOrders: number;
  series: CustomerBucketDto[];
}
