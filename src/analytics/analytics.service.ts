import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { AppException } from "../common/errors/app-exception";
import { Clock } from "../common/clock/clock";
import {
  AnalyticsCustomersDto,
  AnalyticsOverviewDto,
  AnalyticsPeriodDto,
  AnalyticsRangeQuery,
  AnalyticsSalesDto,
  AnalyticsSeriesQuery,
  AnalyticsTopProductsDto,
  OverviewChangeDto,
  OverviewMetricsDto,
  TopProductsQuery,
} from "./dto/analytics.dto";

const TIMEZONE = "America/Bogota";
const DAY_MS = 86_400_000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;

/** Orders that count as sales: paid and not cancelled/expired. */
const PAID_FILTER = `o.status IN ('open', 'completed') AND o.paid_at IS NOT NULL`;

interface Range {
  from: Date;
  to: Date;
}

interface OverviewRow {
  gross: string;
  refunded: string;
  paid_orders: string;
  new_customers: string;
  created_orders: string;
  created_paid: string;
  created_expired: string;
  created_cancelled: string;
}

interface SalesRow {
  bucket: string;
  orders: string;
  gross: string;
  refunded: string;
}

interface TopProductRow {
  product_id: string;
  title: string;
  units: string;
  revenue: string;
  orders: string;
}

interface CustomerSummaryRow {
  new_customers: string;
  total_customers: string;
  marketing_subscribers: string;
  buyers: string;
  repeat_buyers: string;
  guest_orders: string;
}

interface CustomerBucketRow {
  bucket: string;
  new_customers: string;
}

/** bigint / count come back from pg as strings: convert with a safe-integer check. */
function toInt(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new AppException(500, "INTERNAL_ERROR", "Analytics value out of safe integer range");
  }
  return n;
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 10_000;
}

/** Percentage change with 1 decimal; null when there is no baseline. */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function toPeriod(range: Range): AnalyticsPeriodDto {
  return { from: range.from.toISOString(), to: range.to.toISOString() };
}

/** Series bucket generation shared by sales and customers (local time zone, zero-filled). */
const BUCKETS_CTE = `
  buckets AS (
    SELECT generate_series(
      date_trunc($3::text, $1::timestamptz AT TIME ZONE '${TIMEZONE}'),
      date_trunc($3::text, $2::timestamptz AT TIME ZONE '${TIMEZONE}'),
      ('1 ' || $3::text)::interval
    ) AS bucket
  )`;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  async overview(query: AnalyticsRangeQuery): Promise<AnalyticsOverviewDto> {
    const range = this.resolveRange(query);
    const span = range.to.getTime() - range.from.getTime();
    // Same duration, immediately before `from` (half-open: the previous period excludes `from`).
    const previousRange: Range = { from: new Date(range.from.getTime() - span), to: new Date(range.from.getTime() - 1) };

    const [current, previous] = await Promise.all([this.metrics(range), this.metrics(previousRange)]);
    const change: OverviewChangeDto = {
      netSales: pctChange(current.netSales, previous.netSales),
      paidOrders: pctChange(current.paidOrders, previous.paidOrders),
      averageOrderValue: pctChange(current.averageOrderValue, previous.averageOrderValue),
      newCustomers: pctChange(current.newCustomers, previous.newCustomers),
      paidRate: pctChange(current.paidRate, previous.paidRate),
    };
    return { timezone: TIMEZONE, period: toPeriod(range), previousPeriod: toPeriod(previousRange), current, previous, change };
  }

  async sales(query: AnalyticsSeriesQuery): Promise<AnalyticsSalesDto> {
    const range = this.resolveRange(query);
    const rows = await this.dataSource.query<SalesRow[]>(
      `WITH ${BUCKETS_CTE},
       agg AS (
         SELECT date_trunc($3::text, o.paid_at AT TIME ZONE '${TIMEZONE}') AS bucket,
                COUNT(*) AS orders,
                COALESCE(SUM(o.total), 0) AS gross,
                COALESCE(SUM(o.total_refunded), 0) AS refunded
           FROM orders o
          WHERE ${PAID_FILTER} AND o.paid_at >= $1 AND o.paid_at <= $2
          GROUP BY 1
       )
       SELECT to_char(b.bucket, 'YYYY-MM-DD') AS bucket,
              COALESCE(a.orders, 0) AS orders,
              COALESCE(a.gross, 0) AS gross,
              COALESCE(a.refunded, 0) AS refunded
         FROM buckets b
         LEFT JOIN agg a ON a.bucket = b.bucket
        ORDER BY b.bucket`,
      [range.from, range.to, query.groupBy],
    );
    return {
      timezone: TIMEZONE,
      groupBy: query.groupBy,
      period: toPeriod(range),
      buckets: rows.map((r) => {
        const gross = toInt(r.gross);
        const refunded = toInt(r.refunded);
        return { bucket: r.bucket, orders: toInt(r.orders), grossSales: gross, totalRefunded: refunded, netSales: gross - refunded };
      }),
    };
  }

  async topProducts(query: TopProductsQuery): Promise<AnalyticsTopProductsDto> {
    const range = this.resolveRange(query);
    const order = query.sortBy === "units" ? "units DESC, revenue DESC" : "revenue DESC, units DESC";
    const rows = await this.dataSource.query<TopProductRow[]>(
      `SELECT l.product_id,
              (array_agg(l.title ORDER BY o.paid_at DESC, l.id DESC))[1] AS title,
              SUM(l.quantity) AS units,
              SUM(l.line_total) AS revenue,
              COUNT(DISTINCT o.id) AS orders
         FROM order_lines l
         JOIN orders o ON o.id = l.order_id
        WHERE ${PAID_FILTER} AND o.paid_at >= $1 AND o.paid_at <= $2
        GROUP BY l.product_id
        ORDER BY ${order}, l.product_id
        LIMIT $3`,
      [range.from, range.to, query.limit],
    );
    return {
      period: toPeriod(range),
      sortBy: query.sortBy,
      items: rows.map((r) => ({
        productId: r.product_id,
        title: r.title,
        units: toInt(r.units),
        revenue: toInt(r.revenue),
        orders: toInt(r.orders),
      })),
    };
  }

  async customers(query: AnalyticsSeriesQuery): Promise<AnalyticsCustomersDto> {
    const range = this.resolveRange(query);
    const [summaryRows, seriesRows] = await Promise.all([
      this.dataSource.query<CustomerSummaryRow[]>(
        `SELECT
           (SELECT COUNT(*) FROM customers c
             WHERE c.created_at >= $1 AND c.created_at <= $2 AND c.anonymized_at IS NULL AND c.deleted_at IS NULL) AS new_customers,
           (SELECT COUNT(*) FROM customers c WHERE c.anonymized_at IS NULL AND c.deleted_at IS NULL) AS total_customers,
           (SELECT COUNT(*) FROM customers c
             WHERE c.accepts_marketing AND c.anonymized_at IS NULL AND c.deleted_at IS NULL) AS marketing_subscribers,
           COUNT(*) FILTER (WHERE t.customer_id IS NOT NULL) AS buyers,
           COUNT(*) FILTER (WHERE t.customer_id IS NOT NULL AND t.n >= 2) AS repeat_buyers,
           COALESCE(SUM(t.n) FILTER (WHERE t.customer_id IS NULL), 0) AS guest_orders
         FROM (
           SELECT o.customer_id, COUNT(*) AS n
             FROM orders o
            WHERE ${PAID_FILTER} AND o.paid_at >= $1 AND o.paid_at <= $2
            GROUP BY o.customer_id
         ) t`,
        [range.from, range.to],
      ),
      this.dataSource.query<CustomerBucketRow[]>(
        `WITH ${BUCKETS_CTE},
         agg AS (
           SELECT date_trunc($3::text, c.created_at AT TIME ZONE '${TIMEZONE}') AS bucket, COUNT(*) AS n
             FROM customers c
            WHERE c.created_at >= $1 AND c.created_at <= $2 AND c.anonymized_at IS NULL AND c.deleted_at IS NULL
            GROUP BY 1
         )
         SELECT to_char(b.bucket, 'YYYY-MM-DD') AS bucket, COALESCE(a.n, 0) AS new_customers
           FROM buckets b
           LEFT JOIN agg a ON a.bucket = b.bucket
          ORDER BY b.bucket`,
        [range.from, range.to, query.groupBy],
      ),
    ]);
    const s = summaryRows[0];
    return {
      timezone: TIMEZONE,
      groupBy: query.groupBy,
      period: toPeriod(range),
      newCustomers: toInt(s?.new_customers),
      totalCustomers: toInt(s?.total_customers),
      marketingSubscribers: toInt(s?.marketing_subscribers),
      buyers: toInt(s?.buyers),
      repeatBuyers: toInt(s?.repeat_buyers),
      guestOrders: toInt(s?.guest_orders),
      series: seriesRows.map((r) => ({ bucket: r.bucket, newCustomers: toInt(r.new_customers) })),
    };
  }

  /* ── internals ─────────────────────────────────────────── */

  private async metrics(range: Range): Promise<OverviewMetricsDto> {
    const rows = await this.dataSource.query<OverviewRow[]>(
      `SELECT
         (SELECT COALESCE(SUM(o.total), 0) FROM orders o
           WHERE ${PAID_FILTER} AND o.paid_at >= $1 AND o.paid_at <= $2) AS gross,
         (SELECT COALESCE(SUM(o.total_refunded), 0) FROM orders o
           WHERE ${PAID_FILTER} AND o.paid_at >= $1 AND o.paid_at <= $2) AS refunded,
         (SELECT COUNT(*) FROM orders o
           WHERE ${PAID_FILTER} AND o.paid_at >= $1 AND o.paid_at <= $2) AS paid_orders,
         (SELECT COUNT(*) FROM customers c
           WHERE c.created_at >= $1 AND c.created_at <= $2 AND c.anonymized_at IS NULL AND c.deleted_at IS NULL) AS new_customers,
         COUNT(*) AS created_orders,
         COUNT(*) FILTER (WHERE x.status IN ('open', 'completed') AND x.paid_at IS NOT NULL) AS created_paid,
         COUNT(*) FILTER (WHERE x.status = 'expired') AS created_expired,
         COUNT(*) FILTER (WHERE x.status = 'cancelled') AS created_cancelled
       FROM orders x
       WHERE x.created_at >= $1 AND x.created_at <= $2`,
      [range.from, range.to],
    );
    const r = rows[0];
    const gross = toInt(r?.gross);
    const refunded = toInt(r?.refunded);
    const net = gross - refunded;
    const paidOrders = toInt(r?.paid_orders);
    const created = toInt(r?.created_orders);
    const createdPaid = toInt(r?.created_paid);
    const createdExpired = toInt(r?.created_expired);
    const createdCancelled = toInt(r?.created_cancelled);
    return {
      grossSales: gross,
      totalRefunded: refunded,
      netSales: net,
      paidOrders,
      averageOrderValue: paidOrders === 0 ? 0 : Math.round(net / paidOrders),
      newCustomers: toInt(r?.new_customers),
      createdOrders: created,
      createdOrdersPaid: createdPaid,
      createdOrdersExpired: createdExpired,
      createdOrdersCancelled: createdCancelled,
      paidRate: ratio(createdPaid, created),
      expiredRate: ratio(createdExpired, created),
      cancelledRate: ratio(createdCancelled, created),
    };
  }

  /** Defaults to the last 30 days; rejects inverted or > 366-day ranges with a 400. */
  private resolveRange(query: { from?: Date; to?: Date }): Range {
    const to = query.to ?? this.clock.now();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    if (to.getTime() < from.getTime()) {
      throw AppException.badRequest("VALIDATION_ERROR", "`to` must not be before `from`");
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw AppException.badRequest("VALIDATION_ERROR", `The range cannot exceed ${MAX_RANGE_DAYS} days`);
    }
    return { from, to };
  }
}
