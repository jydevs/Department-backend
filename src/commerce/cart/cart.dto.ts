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

const setDiscountSchema = z.strictObject({
  code: z.union([z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/), z.null()]),
});
export type SetCartDiscountInput = z.infer<typeof setDiscountSchema>;
export class SetCartDiscountDto extends createZodDto(setDiscountSchema) {}

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
  quote: Quote;
}
