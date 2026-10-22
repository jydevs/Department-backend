import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { productOptionResponseSchema } from "./product-option.dto";

export const mediaResponseSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  alt: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  mimeType: z.string().nullable(),
});

export type MediaResponse = z.infer<typeof mediaResponseSchema>;
export class MediaResponseDto extends createZodDto(mediaResponseSchema) {}

export { productOptionResponseSchema, ProductOptionResponse, ProductOptionResponseDto } from "./product-option.dto";

export const variantForResponseSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().nullable(),
  title: z.string(),
  price: z.number().int(),
  compareAtPrice: z.number().int().nullable(),
  weightGrams: z.number().int().nullable(),
  barcode: z.string().nullable(),
  position: z.number().int(),
  trackInventory: z.boolean(),
  allowBackorder: z.boolean(),
  optionValueIds: z.array(z.string().uuid()),
  isActive: z.boolean(),
  /** Optimistic-lock token required by PATCH /admin/products/:id/variants/:variantId. */
  version: z.number().int(),
});

export type VariantForResponse = z.infer<typeof variantForResponseSchema>;
export class VariantForResponseDto extends createZodDto(variantForResponseSchema) {}

export const productDetailResponseSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  title: z.string(),
  descriptionHtml: z.string(),
  status: z.enum(["draft", "active", "archived"]),
  vendor: z.string().nullable(),
  productType: z.string().nullable(),
  tags: z.array(z.string()),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  publishedAt: z.coerce.date().nullable(),
  options: z.array(productOptionResponseSchema),
  variants: z.array(variantForResponseSchema),
  media: z.array(mediaResponseSchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  version: z.number().int(),
});

export type ProductDetailResponse = z.infer<typeof productDetailResponseSchema>;
export class ProductDetailResponseDto extends createZodDto(productDetailResponseSchema) {}

export const productListItemResponseSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  title: z.string(),
  status: z.enum(["draft", "active", "archived"]),
  variantCount: z.number().int(),
  inventoryTotal: z.number().int().nullable(),
  minPrice: z.number().int().nullable(),
  maxPrice: z.number().int().nullable(),
  primaryImage: mediaResponseSchema.nullable(),
});

export type ProductListItemResponse = z.infer<typeof productListItemResponseSchema>;
export class ProductListItemResponseDto extends createZodDto(productListItemResponseSchema) {}
