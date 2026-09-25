import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { collectionRulesSchema } from "./collection-rule.dto";

const previewRulesRequestSchema = z.object({
  rules: collectionRulesSchema,
});

export type PreviewRulesInput = z.infer<typeof previewRulesRequestSchema>;
export class PreviewRulesDto extends createZodDto(previewRulesRequestSchema) {}

const productPreviewSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  title: z.string(),
  price: z.number(),
  image: z.object({ url: z.string(), alt: z.string().nullable(), width: z.number().nullable(), height: z.number().nullable() }).nullable(),
});

const previewRulesResponseSchema = z.object({
  products: z.array(productPreviewSchema).max(24),
  total: z.number(),
});

export type PreviewRulesResponse = z.infer<typeof previewRulesResponseSchema>;
export class PreviewRulesResponseDto extends createZodDto(previewRulesResponseSchema) {}
