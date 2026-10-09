import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["draft", "active", "archived"]).optional(),
  q: z.string().max(255).optional(),
  tag: z.string().max(50).optional(),
  vendor: z.string().max(255).optional(),
});

export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export class ProductListQueryDto extends createZodDto(productListQuerySchema) {}
