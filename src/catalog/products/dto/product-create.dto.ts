import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { productOptionInputSchema } from "./product-option.dto";
import { variantInputSchema } from "./variant.dto";

/**
 * Variant of a product being created. `optionValues` are the VALUE NAMES (in the order of `options`) and are
 * linked to the option value ids created in the same transaction; `optionValueIds` cannot be known beforehand.
 */
export const productCreateVariantSchema = variantInputSchema.extend({
  optionValues: z.array(z.string().min(1).max(255)).max(3).optional(),
});

export const productCreateSchema = z.object({
  title: z.string().min(1).max(255),
  descriptionHtml: z.string().max(10000).default(""),
  handle: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120).optional(),
  vendor: z.string().max(255).nullable().optional(),
  productType: z.string().max(255).nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).max(50).default([]),
  seoTitle: z.string().max(255).nullable().optional(),
  seoDescription: z.string().max(1000).nullable().optional(),
  options: z.array(productOptionInputSchema).max(3).optional(),
  variants: z.array(productCreateVariantSchema).max(100).optional(),
  /** COP price applied to the variants generated automatically from `options` (default 0). */
  defaultVariantPrice: z.number().int().min(0).max(1e10).optional(),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export class CreateProductDto extends createZodDto(productCreateSchema) {}
