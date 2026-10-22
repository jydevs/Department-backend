import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { cursorQuerySchema } from "../../../common/pagination/pagination";

const availableFilter = z.enum(["true", "false"]).transform((v) => v === "true");

const storefrontProductsQuerySchema = z.object({
  limit: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(100).default(24)),
  cursor: z.string().max(1024).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "title"]).default("newest"),
  collection: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  tag: z.string().min(1).max(255).optional(),
  q: z.string().min(2).max(80).optional(),
  available: availableFilter.optional(),
});

export type StorefrontProductsQuery = z.infer<typeof storefrontProductsQuerySchema>;
export class StorefrontProductsQueryDto extends createZodDto(storefrontProductsQuerySchema) {}

const storefrontSearchQuerySchema = z.object({
  q: z.string().min(2).max(80),
});

export type StorefrontSearchQuery = z.infer<typeof storefrontSearchQuerySchema>;
export class StorefrontSearchQueryDto extends createZodDto(storefrontSearchQuerySchema) {}

const storefrontCollectionQuerySchema = cursorQuerySchema.extend({ available: availableFilter.optional() });
export type StorefrontCollectionQuery = z.infer<typeof storefrontCollectionQuerySchema>;
export class StorefrontCollectionQueryDto extends createZodDto(storefrontCollectionQuerySchema) {}
