import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import type { Quote } from "../pricing";

export const CART_MAX_LINES = 50;
export const CART_MAX_QUANTITY = 20;

const quantity = z.number().int().min(1).max(CART_MAX_QUANTITY);

const addLineSchema = z.strictObject({ variantId: z.uuid(), quantity });
export type AddCartLineInput = z.infer<typeof addLineSchema>;
export class AddCartLineDto extends createZodDto(addLineSchema) {}

const updateLineSchema = z.strictObject({ quantity: z.number().int().min(0).max(CART_MAX_QUANTITY) });
export type UpdateCartLineInput = z.infer<typeof updateLineSchema>;
export class UpdateCartLineDto extends createZodDto(updateLineSchema) {}

const optionalEmail = z.string().trim().toLowerCase().pipe(z.email().max(255));

const setDiscountSchema = z.strictObject({
  code: z.union([z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/), z.null()]),
  /** Optional: lets the API reject a once-per-email code already used by this buyer (`already_used`) before paying. */
  email: optionalEmail.optional(),
});
export type SetCartDiscountInput = z.infer<typeof setDiscountSchema>;
export class SetCartDiscountDto extends createZodDto(setDiscountSchema) {}

/** Optional shipping quote: `shippingRateId` and `department` go together; `email` validates once-per-email codes. */
const getCartQuerySchema = z
  .object({
    shippingRateId: z.uuid().optional(),
    department: z.string().trim().min(1).max(60).optional(),
    email: optionalEmail.optional(),
  })
  .refine((q) => (q.shippingRateId === undefined) === (q.department === undefined), {
    message: "shippingRateId and department must be sent together",
    path: ["department"],
  });
export type GetCartQuery = z.infer<typeof getCartQuerySchema>;
export class GetCartQueryDto extends createZodDto(getCartQuerySchema) {}

const cartParamSchema = z.object({ id: z.uuid() });
export class CartParamDto extends createZodDto(cartParamSchema) {}

const cartLineParamSchema = z.object({ id: z.uuid(), variantId: z.uuid() });
export class CartLineParamDto extends createZodDto(cartLineParamSchema) {}

export interface CartCreatedResponse {
  id: string;
  token: string;
  expiresAt: Date;
}

export interface CartResponse {
  id: string;
  currency: "COP";
  discountCode: string | null;
  itemCount: number;
  expiresAt: Date;
  /** true once the cart was checked out; its mutations answer 409 CART_CONVERTED. */
  converted: boolean;
  convertedOrderNumber: number | null;
  quote: Quote;
}
