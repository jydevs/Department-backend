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
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type CollectionResponse = z.infer<typeof collectionResponseSchema>;
export class CollectionDto extends createZodDto(collectionResponseSchema) {}
