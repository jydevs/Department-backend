import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { collectionRulesSchema } from "./collection-rule.dto";

const collectionCreateSchema = z.object({
  handle: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  title: z.string().min(1).max(255),
  descriptionHtml: z.string().max(5000).default(""),
  type: z.enum(["manual", "smart"]),
  rules: collectionRulesSchema.nullable().optional(),
  sortOrder: z.enum(["manual", "title", "newest", "price_asc", "price_desc"]).default("manual"),
  seoTitle: z.string().max(255).nullable().optional(),
  seoDescription: z.string().max(500).nullable().optional(),
  imageMediaId: z.string().uuid().nullable().optional(),
  isPublished: z.boolean().default(false),
});

export type CollectionCreateInput = z.infer<typeof collectionCreateSchema>;
export class CreateCollectionDto extends createZodDto(collectionCreateSchema) {}
