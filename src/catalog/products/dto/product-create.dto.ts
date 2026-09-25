import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { productOptionInputSchema } from "./product-option.dto";
import { variantInputSchema } from "./variant.dto";

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
  variants: z.array(variantInputSchema).max(100).optional(),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export class CreateProductDto extends createZodDto(productCreateSchema) {}
