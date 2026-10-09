import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { storefrontImageSchema } from "./storefront-product.dto";

const storefrontCollectionSummarySchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  title: z.string(),
  image: storefrontImageSchema.nullable(),
});

export type StorefrontCollectionSummary = z.infer<typeof storefrontCollectionSummarySchema>;
export class StorefrontCollectionSummaryDto extends createZodDto(storefrontCollectionSummarySchema) {}

const storefrontCollectionDetailsSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  title: z.string(),
  descriptionHtml: z.string(),
  image: storefrontImageSchema.nullable(),
  seo: z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
  }),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type StorefrontCollectionDetails = z.infer<typeof storefrontCollectionDetailsSchema>;
export class StorefrontCollectionDetailsDto extends createZodDto(storefrontCollectionDetailsSchema) {}
