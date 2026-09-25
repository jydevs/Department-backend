import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const storefrontImageSchema = z.object({
  url: z.string(),
  alt: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});
export type StorefrontImage = z.infer<typeof storefrontImageSchema>;

const storefrontVariantOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  value: z.string(),
});

const storefrontVariantSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  sku: z.string().nullable(),
  price: z.number(),
  compareAtPrice: z.number().nullable(),
  available: z.boolean(),
  optionValues: z.array(storefrontVariantOptionSchema),
});

const storefrontMediaSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  alt: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});

const storefrontMetafieldSchema = z.object({
  key: z.string(),
  value: z.string(),
});

const storefrontProductOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  values: z.array(z.string()),
});

const storefrontSeoSchema = z.object({
  title: z.string().nullable(),
  description: z.string().nullable(),
});

const storefrontProductDetailsSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  title: z.string(),
  descriptionHtml: z.string(),
  vendor: z.string().nullable(),
  productType: z.string().nullable(),
  tags: z.array(z.string()),
  variants: z.array(storefrontVariantSchema),
  options: z.array(storefrontProductOptionSchema),
  media: z.array(storefrontMediaSchema),
  metafields: z.array(storefrontMetafieldSchema),
  seo: storefrontSeoSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type StorefrontProductDetails = z.infer<typeof storefrontProductDetailsSchema>;
export class StorefrontProductDetailsDto extends createZodDto(storefrontProductDetailsSchema) {}

const storefrontProductSummarySchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  title: z.string(),
  price: z.number(),
  image: storefrontImageSchema.nullable(),
  available: z.boolean(),
});

export type StorefrontProductSummary = z.infer<typeof storefrontProductSummarySchema>;
export class StorefrontProductSummaryDto extends createZodDto(storefrontProductSummarySchema) {}
