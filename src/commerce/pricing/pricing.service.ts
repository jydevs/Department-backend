import { Injectable, Logger } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";
import { AppException } from "../../common/errors/app-exception";
import { Clock } from "../../common/clock/clock";
import { InventoryService } from "../../inventory/inventory.service";
import { applicableZoneDepartments, zoneCoversDepartment } from "./department";
import { divRoundHalfUp } from "./rounding";
import type { DiscountInvalidReason, Quote, QuoteDiscount, QuoteInput, QuoteLine, QuoteWarning } from "./pricing.types";

interface VariantRow {
  id: string;
  product_id: string;
  product_handle: string | null;
  product_title: string;
  variant_title: string;
  sku: string | null;
  price: string;
  compare_at_price: string | null;
  sellable: boolean;
  image_url: string | null;
}

interface DiscountRow {
  id: string;
  code: string;
  type: string;
  value: number;
  min_subtotal: string | null;
  starts_at: Date;
  ends_at: Date | null;
  usage_limit: number | null;
  used_count: number;
  once_per_email: boolean;
  is_active: boolean;
}

interface RateRow {
  id: string;
  name: string;
  price: string;
  free_over_subtotal: string | null;
  departments: string[];
}

interface TaxRow {
  prices_include_tax: boolean;
  rate_percent: string;
  label: string | null;
}

const MAX_LINES = 100;
const DEFAULT_TAX: { pricesIncludeTax: boolean; ratePercent: string; label: string } = { pricesIncludeTax: true, ratePercent: "19.00", label: "IVA" };

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly inventory: InventoryService,
    private readonly clock: Clock,
  ) {}

  /**
   * Pure over the database (no writes). One round trip per table: variants(+products+media), inventory,
   * discounts, redemptions, shipping rates(+zones), tax settings.
   * Throws AppException 422 `DISCOUNT_INVALID` (details.reason) and 422 `SHIPPING_RATE_INVALID`.
   */
  async quote(input: QuoteInput, manager?: EntityManager): Promise<Quote> {
    const em = manager ?? this.dataSource.manager;
    const warnings: QuoteWarning[] = [];

    // Merge duplicate variants so a single row per variant is priced.
    const requested = new Map<string, number>();
    for (const line of input.lines) {
      if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
        throw AppException.badRequest("INVALID_QUANTITY", "Quantity must be a positive integer", { variantId: line.variantId });
      }
      requested.set(line.variantId, (requested.get(line.variantId) ?? 0) + line.quantity);
    }
    if (requested.size > MAX_LINES) throw AppException.badRequest("TOO_MANY_LINES", "Too many lines to quote");
    const variantIds = [...requested.keys()];

    /* ── lines ── */
    const variantRows =
      variantIds.length === 0
        ? []
        : await em.query<VariantRow[]>(
            `SELECT v.id, v.product_id, p.handle AS product_handle, p.title AS product_title, v.title AS variant_title, v.sku, v.price, v.compare_at_price,
                    (v.is_active = true AND p.status = 'active' AND p.deleted_at IS NULL) AS sellable,
                    (SELECT m.url FROM product_media pm JOIN media m ON m.id = pm.media_id
                      WHERE pm.product_id = v.product_id AND (pm.variant_id IS NULL OR pm.variant_id = v.id)
                      ORDER BY (pm.variant_id = v.id) DESC NULLS LAST, pm.position ASC LIMIT 1) AS image_url
             FROM variants v JOIN products p ON p.id = v.product_id
             WHERE v.id = ANY($1::uuid[])`,
            [variantIds],
          );
    const byId = new Map(variantRows.map((r) => [r.id, r]));
    const availability = await this.inventory.availabilityFor(variantIds);

    const lines: QuoteLine[] = [];
    let subtotal = 0;
    for (const [variantId, quantity] of requested) {
      const row = byId.get(variantId);
      if (!row) {
        warnings.push({ code: "VARIANT_UNAVAILABLE", message: "This item is no longer available", variantId });
        continue;
      }
      const unitPrice = Number(row.price);
      const stock = availability.get(variantId) ?? { available: 0, unlimited: false };
      const inStock = stock.unlimited || stock.available >= quantity;
      const available = row.sellable && inStock;
      const lineTotal = unitPrice * quantity;
      if (!row.sellable) {
        warnings.push({ code: "VARIANT_UNAVAILABLE", message: "This item is no longer available", variantId });
      } else {
        subtotal += lineTotal;
        if (!inStock) {
          warnings.push({ code: "INSUFFICIENT_STOCK", message: `Only ${stock.available} left in stock`, variantId });
        }
      }
      lines.push({
        variantId,
        productId: row.product_id,
        productHandle: row.product_handle ?? null,
        productTitle: row.product_title,
        variantTitle: row.variant_title,
        sku: row.sku,
        imageUrl: row.image_url,
        unitPrice,
        compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
        quantity,
        lineTotal,
        available,
        maxQuantity: !row.sellable ? 0 : stock.unlimited ? null : stock.available,
      });
    }

    /* ── discount ── */
    let discountTotal = 0;
    let freeShipping = false;
    let discountInfo: { code: string; type: QuoteDiscount["type"] } | null = null;
    const code = input.discountCode?.trim().toUpperCase();
    if (code) {
      const discount = await this.loadDiscount(em, code, subtotal, input.email ?? null);
      const type = this.discountType(discount.type);
      discountInfo = { code: discount.code, type };
      if (type === "percent") discountTotal = Math.min(subtotal, divRoundHalfUp(subtotal * discount.value, 100));
      else if (type === "fixed") discountTotal = Math.min(subtotal, discount.value);
      else freeShipping = true;
    }
    const discountedSubtotal = subtotal - discountTotal;

    /* ── shipping ── */
    let shippingTotal = 0;
    let shippingRate: Quote["shippingRate"] = null;
    let waivedShipping = 0;
    if (input.shippingRateId) {
      const rows = await em.query<RateRow[]>(
        `SELECT r.id, r.name, r.price, r.free_over_subtotal, z.departments
         FROM shipping_rates r JOIN shipping_zones z ON z.id = r.zone_id
         WHERE r.id = $1 AND r.is_active = true AND z.is_active = true`,
        [input.shippingRateId],
      );
      const rate = rows[0];
      let applicable = !!rate && zoneCoversDepartment(rate.departments, input.department);
      if (rate && applicable) {
        // a more specific zone (e.g. Bogotá) takes precedence over the catch-all "*" zone
        const zones = await em.query<{ departments: string[] }[]>(
          `SELECT DISTINCT z.departments FROM shipping_rates r JOIN shipping_zones z ON z.id = r.zone_id
           WHERE r.is_active = true AND z.is_active = true`,
        );
        const allowed = applicableZoneDepartments(zones.map((z) => z.departments), input.department);
        applicable = allowed.some((z) => z.length === rate.departments.length && z.every((x, k) => x === rate.departments[k]));
      }
      if (!rate || !applicable) {
        throw new AppException(422, "SHIPPING_RATE_INVALID", "The shipping rate is not available for this destination");
      }
      shippingRate = { id: rate.id, name: rate.name };
      const base = Number(rate.price);
      const freeOver = rate.free_over_subtotal === null ? null : Number(rate.free_over_subtotal);
      const freeByThreshold = freeOver !== null && discountedSubtotal >= freeOver;
      shippingTotal = freeByThreshold || freeShipping ? 0 : base;
      // what the discount actually waived: nothing when the free-over threshold already made shipping free
      waivedShipping = freeShipping && !freeByThreshold ? base : 0;
    }

    /* ── tax ── */
    const taxRows = await em.query<TaxRow[]>(`SELECT prices_include_tax, rate_percent, label FROM tax_settings ORDER BY created_at ASC LIMIT 1`);
    const tax = taxRows[0]
      ? { pricesIncludeTax: taxRows[0].prices_include_tax, ratePercent: taxRows[0].rate_percent, label: taxRows[0].label ?? DEFAULT_TAX.label }
      : DEFAULT_TAX;
    const rateHundredths = Math.round(Number(tax.ratePercent) * 100); // 19.00% -> 1900
    const taxBase = discountedSubtotal + shippingTotal;
    const taxTotal = tax.pricesIncludeTax
      ? divRoundHalfUp(taxBase * rateHundredths, 10_000 + rateHundredths)
      : divRoundHalfUp(taxBase * rateHundredths, 10_000);
    const total = taxBase + (tax.pricesIncludeTax ? 0 : taxTotal);

    return {
      currency: "COP",
      lines,
      subtotal,
      discountTotal,
      discount: discountInfo
        ? { code: discountInfo.code, type: discountInfo.type, amount: discountInfo.type === "free_shipping" ? waivedShipping : discountTotal }
        : null,
      shippingTotal,
      shippingRate,
      taxTotal,
      taxIncluded: tax.pricesIncludeTax,
      taxRatePercent: Number(tax.ratePercent),
      taxBreakdown: {
        label: tax.label,
        ratePercent: Number(tax.ratePercent),
        netAmount: tax.pricesIncludeTax ? taxBase - taxTotal : taxBase,
        taxAmount: taxTotal,
      },
      total,
      warnings,
    };
  }

  private discountType(value: string): QuoteDiscount["type"] {
    if (value === "percent" || value === "fixed" || value === "free_shipping") return value;
    throw new Error(`Unknown discount type: ${value}`);
  }

  private invalid(reason: DiscountInvalidReason, extra?: Record<string, unknown>): AppException {
    if (reason === "inactive" || reason === "not_started" || reason === "expired" || reason === "usage_limit_reached") {
      // Public responses must not reveal that a code exists but is disabled, not live yet, expired or exhausted (code-guessing oracle):
      // all of them look like an unknown code. The real reason only goes to the log.
      this.logger.log(`Discount rejected (${reason})`);
      return new AppException(422, "DISCOUNT_INVALID", "The discount code cannot be applied", { reason: "not_found" });
    }
    return new AppException(422, "DISCOUNT_INVALID", "The discount code cannot be applied", { reason, ...extra });
  }

  private async loadDiscount(em: EntityManager, code: string, subtotal: number, email: string | null): Promise<DiscountRow> {
    const rows = await em.query<DiscountRow[]>(
      `SELECT id, code, type, value, min_subtotal, starts_at, ends_at, usage_limit, used_count, once_per_email, is_active
       FROM discounts WHERE code = $1`,
      [code],
    );
    const d = rows[0];
    if (!d) throw this.invalid("not_found");
    if (!d.is_active) throw this.invalid("inactive");
    const now = this.clock.now();
    if (new Date(d.starts_at) > now) throw this.invalid("not_started");
    if (d.ends_at && new Date(d.ends_at) <= now) throw this.invalid("expired");
    if (d.usage_limit !== null && d.used_count >= d.usage_limit) throw this.invalid("usage_limit_reached");
    if (d.min_subtotal !== null && subtotal < Number(d.min_subtotal)) {
      throw this.invalid("min_subtotal", { minSubtotal: Number(d.min_subtotal) });
    }
    if (d.once_per_email && email) {
      const used = await em.query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM discount_redemptions WHERE discount_id = $1 AND lower(email) = lower($2)`,
        [d.id, email],
      );
      if ((used[0]?.n ?? 0) > 0) throw this.invalid("already_used");
    }
    return d;
  }
}
