export type QuoteWarningCode = "VARIANT_UNAVAILABLE" | "INSUFFICIENT_STOCK" | "DISCOUNT_INVALID";

export interface QuoteWarning {
  code: QuoteWarningCode;
  message: string;
  variantId?: string;
}

export interface QuoteInput {
  lines: { variantId: string; quantity: number }[];
  discountCode?: string | null;
  shippingRateId?: string | null;
  department?: string | null;
  email?: string | null;
}

export interface QuoteLine {
  variantId: string;
  productId: string;
  /** Storefront handle of the product (null only if the product row has no handle). */
  productHandle: string | null;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  imageUrl: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  lineTotal: number;
  available: boolean;
  maxQuantity: number | null;
}

export interface QuoteDiscount {
  code: string;
  type: "percent" | "fixed" | "free_shipping";
  amount: number;
}

export interface QuoteTaxBreakdown {
  label: string;
  ratePercent: number;
  /** Taxable amount WITHOUT tax (after discount, shipping included). */
  netAmount: number;
  taxAmount: number;
}

export interface Quote {
  currency: "COP";
  lines: QuoteLine[];
  subtotal: number;
  discountTotal: number;
  discount: QuoteDiscount | null;
  shippingTotal: number;
  shippingRate: { id: string; name: string } | null;
  taxTotal: number;
  /** true: prices already include the tax (it is informational); false: the tax is added on top of the total. */
  taxIncluded: boolean;
  taxRatePercent: number;
  taxBreakdown: QuoteTaxBreakdown;
  total: number;
  warnings: QuoteWarning[];
}

export type DiscountInvalidReason =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "usage_limit_reached"
  | "min_subtotal"
  | "already_used";
