import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { collectionRulesSchema } from "./collection-rule.dto";

const collectionUpdateSchema = z.object({
  handle: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120).optional(),
  title: z.string().min(1).max(255).optional(),
  descriptionHtml: z.string().max(5000).optional(),
  type: z.enum(["manual", "smart"]).optional(),
  rules: collectionRulesSchema.nullable().optional(),
  sortOrder: z.enum(["manual", "title", "newest", "price_asc", "price_desc"]).optional(),
  isPublished: z.boolean().optional(),
  seoTitle: z.string().max(255).nullable().optional(),
  seoDescription: z.string().max(500).nullable().optional(),
  imageMediaId: z.string().uuid().nullable().optional(),
  /** Optional optimistic lock: when sent and different from the stored version -> 409 CONCURRENT_UPDATE. */
  version: z.number().int().min(1).optional(),
});

export type CollectionUpdateInput = z.infer<typeof collectionUpdateSchema>;
export class UpdateCollectionDto extends createZodDto(collectionUpdateSchema) {}
