import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const collectionResponseSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  title: z.string(),
  descriptionHtml: z.string(),
  type: z.enum(["manual", "smart"]),
  rules: z.unknown().nullable(),
  sortOrder: z.enum(["manual", "title", "newest", "price_asc", "price_desc"]),
  isPublished: z.boolean(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  imageMediaId: z.string().uuid().nullable(),
  image: z.object({ url: z.string(), alt: z.string().nullable(), width: z.number().int().nullable(), height: z.number().int().nullable() }).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  version: z.number().int(),
});

export type CollectionResponse = z.infer<typeof collectionResponseSchema>;
export class CollectionDto extends createZodDto(collectionResponseSchema) {}

const collectionProductItemSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  title: z.string(),
  status: z.enum(["draft", "active", "archived"]),
  position: z.number().int(),
  image: z.object({ url: z.string(), alt: z.string().nullable(), width: z.number().int().nullable(), height: z.number().int().nullable() }).nullable(),
  minPrice: z.number().int().nullable(),
});

const collectionProductsResponseSchema = z.object({
  items: z.array(collectionProductItemSchema),
  total: z.number().int(),
});

export type CollectionProductsResponse = z.infer<typeof collectionProductsResponseSchema>;
export class CollectionProductsResponseDto extends createZodDto(collectionProductsResponseSchema) {}
