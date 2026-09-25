import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { addressSchema } from "../common/address.schema";
import type { PaymentInstructions } from "../payments/payment-provider";

export const checkoutSchema = z.object({
  cartId: z.uuid(),
  email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,20}$/, "Invalid phone")
    .optional(),
  shippingAddress: addressSchema,
  billingAddress: addressSchema.optional(),
  shippingRateId: z.uuid(),
  discountCode: z.string().trim().min(1).max(40).optional(),
  // eslint-disable-next-line no-control-regex
  customerNote: z.string().trim().max(500).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, "Invalid characters").optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export class CheckoutDto extends createZodDto(checkoutSchema) {}

/** Header contract: 8..120 visible ASCII characters. */
export const idempotencyKeySchema = z.string().min(8).max(120).regex(/^[\x21-\x7e]+$/, "Invalid Idempotency-Key");
export const cartTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/);

export const orderNumberParamSchema = z.object({ orderNumber: z.coerce.number().int().min(1).max(2_147_483_647) });
export class OrderNumberParamDto extends createZodDto(orderNumberParamSchema) {}

export const orderTokenQuerySchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/) });
export class OrderTokenQueryDto extends createZodDto(orderTokenQuerySchema) {}

/* ── responses ── */

export interface CheckoutResponseDto {
  orderNumber: number;
  orderId: string;
  /** Shown to the buyer; a repeated request with the same Idempotency-Key rotates it (the previous one stops working). */
  accessToken: string;
  total: number;
  currency: string;
  payment: PaymentInstructions;
}

/** What is persisted for idempotent replays: the response WITHOUT the plaintext access token. */
export type StoredCheckoutResponse = Omit<CheckoutResponseDto, "accessToken">;

export interface PublicOrderLineDto {
  title: string;
  variantTitle: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  fulfilledQuantity: number;
}

export interface PublicFulfillmentDto {
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: Date;
}

export interface PublicOrderDto {
  orderNumber: number;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  currency: string;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  total: number;
  discountCode: string | null;
  shippingRateName: string | null;
  email: string;
  shippingAddress: unknown;
  lines: PublicOrderLineDto[];
  fulfillments: PublicFulfillmentDto[];
  payment: { provider: string; status: string; method: string | null } | null;
  createdAt: Date;
  paidAt: Date | null;
  reservedUntil: Date | null;
}
