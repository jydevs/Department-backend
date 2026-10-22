import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const metafieldOwnerTypeSchema = z.enum(["product", "collection"]);
export type MetafieldOwnerType = z.infer<typeof metafieldOwnerTypeSchema>;

const ownerParamSchema = z.object({ id: z.uuid() });
export class MetafieldOwnerParamDto extends createZodDto(ownerParamSchema) {}

const metafieldKeyParamSchema = z.object({
  id: z.uuid(),
  namespace: z.string().min(1).max(60).regex(/^[a-z0-9_-]+$/i),
  key: z.string().min(1).max(60).regex(/^[a-z0-9_-]+$/i),
});
export class MetafieldKeyParamDto extends createZodDto(metafieldKeyParamSchema) {}

const metafieldResponseSchema = z.object({
  id: z.string().uuid(),
  ownerType: metafieldOwnerTypeSchema,
  ownerId: z.string().uuid(),
  namespace: z.string(),
  key: z.string(),
  type: z.string(),
  value: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type MetafieldResponseDto = z.infer<typeof metafieldResponseSchema>;
export class MetafieldDto extends createZodDto(metafieldResponseSchema) {}

const metafieldSchema = z.object({
  namespace: z.string().min(1).max(60).regex(/^[a-z0-9_-]+$/i),
  key: z.string().min(1).max(60).regex(/^[a-z0-9_-]+$/i),
  type: z.enum(["single_line_text", "multi_line_text", "number_integer", "number_decimal", "boolean", "json", "url", "color"]),
  value: z.string().max(5000),
});

export type MetafieldInput = z.infer<typeof metafieldSchema>;
export class MetafieldInputDto extends createZodDto(metafieldSchema) {}

const upsertMetafieldsSchema = z.object({
  metafields: z.array(metafieldSchema).min(1).max(50),
});

export type UpsertMetafieldsInput = z.infer<typeof upsertMetafieldsSchema>;
export class UpsertMetafieldsDto extends createZodDto(upsertMetafieldsSchema) {}

const metafieldsListResponseSchema = z.object({
  metafields: z.array(metafieldResponseSchema),
});

export type MetafieldsListResponseDto = z.infer<typeof metafieldsListResponseSchema>;
export class MetafieldsListResponseDtoClass extends createZodDto(metafieldsListResponseSchema) {}
