import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { dateInput } from "../../../common/zod/date-input";
import { addressSchema, Address } from "../../common/address.schema";

/* ── requests ─────────────────────────────────────────────── */

const ORDER_STATUSES = ["pending", "open", "completed", "cancelled", "expired"] as const;
const PAYMENT_STATUSES = ["pending", "paid", "failed", "partially_refunded", "refunded"] as const;
const FULFILLMENT_STATUSES = ["unfulfilled", "partial", "fulfilled"] as const;

const optionalQuery = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

export const orderListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    status: optionalQuery(z.enum(ORDER_STATUSES)),
    paymentStatus: optionalQuery(z.enum(PAYMENT_STATUSES)),
    fulfillmentStatus: optionalQuery(z.enum(FULFILLMENT_STATUSES)),
    q: optionalQuery(z.string().trim().min(1).max(255)),
    from: optionalQuery(dateInput),
    to: optionalQuery(dateInput),
    tag: optionalQuery(z.string().trim().min(1).max(50)),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "from must be before to", path: ["from"] });
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export class OrderListQueryDto extends createZodDto(orderListQuerySchema) {}

export const orderUpdateSchema = z
  .object({
    version: z.number().int().min(0),
    internalNote: z.string().max(5000).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
    email: z.string().trim().toLowerCase().pipe(z.email().max(255)).optional(),
    phone: z.string().trim().regex(/^\+?[0-9]{7,20}$/, "Invalid phone").nullable().optional(),
    shippingAddress: addressSchema.optional(),
  })
  .strict();
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;
export class OrderUpdateDto extends createZodDto(orderUpdateSchema) {}

export const orderNoteSchema = z.object({ note: z.string().trim().min(1).max(2000) }).strict();
export class OrderNoteDto extends createZodDto(orderNoteSchema) {}

export const orderCancelSchema = z
  .object({ reason: z.string().trim().min(1).max(255), restock: z.boolean().default(false) })
  .strict();
export type OrderCancelInput = z.infer<typeof orderCancelSchema>;
export class OrderCancelDto extends createZodDto(orderCancelSchema) {}

export const orderMarkPaidSchema = z
  .object({ reference: z.string().trim().min(1).max(80).optional(), note: z.string().trim().min(1).max(500).optional() })
  .strict();
export type OrderMarkPaidInput = z.infer<typeof orderMarkPaidSchema>;
export class OrderMarkPaidDto extends createZodDto(orderMarkPaidSchema) {}

const lineQuantitySchema = z.object({ orderLineId: z.uuid(), quantity: z.number().int().min(1).max(100000) }).strict();
const uniqueLines = (lines: { orderLineId: string }[]) => new Set(lines.map((l) => l.orderLineId)).size === lines.length;

export const fulfillmentCreateSchema = z
  .object({
    lines: z.array(lineQuantitySchema).min(1).max(100).refine(uniqueLines, { message: "Duplicate orderLineId" }),
    carrier: z.string().trim().min(1).max(80).optional(),
    trackingNumber: z.string().trim().min(1).max(120).optional(),
    trackingUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => {
        try {
          return new URL(v).protocol === "https:";
        } catch {
          return false;
        }
      }, { message: "trackingUrl must be a valid https URL" })
      .optional(),
    notifyCustomer: z.boolean().default(false),
  })
  .strict();
export type FulfillmentCreateInput = z.infer<typeof fulfillmentCreateSchema>;
export class FulfillmentCreateDto extends createZodDto(fulfillmentCreateSchema) {}

export const refundCreateSchema = z
  .object({
    amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    reason: z.string().trim().min(1).max(255).optional(),
    lines: z.array(lineQuantitySchema).max(100).refine(uniqueLines, { message: "Duplicate orderLineId" }).optional(),
    restock: z.boolean().default(false),
  })
  .strict();
export type RefundCreateInput = z.infer<typeof refundCreateSchema>;
export class RefundCreateDto extends createZodDto(refundCreateSchema) {}

export const orderFulfillmentParamSchema = z.object({ id: z.uuid(), fid: z.uuid() });
export class OrderFulfillmentParamDto extends createZodDto(orderFulfillmentParamSchema) {}

/* ── responses ────────────────────────────────────────────── */

export interface OrderSummaryDto {
  id: string;
  orderNumber: number;
  createdAt: Date;
  email: string;
  customerName: string | null;
  total: number;
  currency: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  itemCount: number;
  tags: string[];
}

export interface OrderLineDto {
  id: string;
  variantId: string;
  productId: string;
  sku: string | null;
  title: string;
  variantTitle: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  fulfilledQuantity: number;
  refundedQuantity: number;
}

export interface PaymentDto {
  id: string;
  provider: string;
  providerTransactionId: string | null;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  rawStatus: string | null;
  method: string | null;
  createdAt: Date;
}

export interface FulfillmentLineDto {
  id: string;
  orderLineId: string;
  quantity: number;
}

export interface FulfillmentDto {
  id: string;
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: Date;
  createdAt: Date;
  lines: FulfillmentLineDto[];
}

export interface RefundLineDto {
  id: string;
  orderLineId: string;
  quantity: number;
}

export interface RefundDto {
  id: string;
  amount: number;
  reason: string | null;
  restocked: boolean;
  providerStatus: string;
  actorId: string | null;
  createdAt: Date;
  lines: RefundLineDto[];
}

export interface OrderEventDto {
  id: string;
  type: string;
  data: Record<string, unknown>;
  actorType: string;
  actorId: string | null;
  createdAt: Date;
}

export interface OrderDetailDto {
  id: string;
  orderNumber: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  email: string;
  phone: string | null;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  currency: string;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  total: number;
  totalRefunded: number;
  discountCode: string | null;
  shippingRateName: string | null;
  shippingAddress: Address;
  billingAddress: Address | null;
  customerNote: string | null;
  internalNote: string | null;
  tags: string[];
  reservedUntil: Date | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  paymentProvider: string;
  paymentReference: string;
  lines: OrderLineDto[];
  payments: PaymentDto[];
  fulfillments: FulfillmentDto[];
  refunds: RefundDto[];
  events: OrderEventDto[];
}

export interface FulfillmentResultDto {
  fulfillment: FulfillmentDto;
  order: { status: string; fulfillmentStatus: string };
}

export interface RefundResultDto {
  refund: RefundDto;
  order: { paymentStatus: string; totalRefunded: number };
}
