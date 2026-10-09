import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const productUpdateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  descriptionHtml: z.string().max(10000).optional(),
  handle: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120).optional(),
  vendor: z.string().max(255).nullable().optional(),
  productType: z.string().max(255).nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).max(50).optional(),
  seoTitle: z.string().max(255).nullable().optional(),
  seoDescription: z.string().max(1000).nullable().optional(),
  version: z.number().int().min(0),
});

export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export class UpdateProductDto extends createZodDto(productUpdateSchema) {}
