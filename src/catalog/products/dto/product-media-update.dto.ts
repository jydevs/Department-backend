import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const mediaInputSchema = z.object({
  url: z
    .string()
    .refine(
      (v) => v.startsWith("/") || v.startsWith("http://") || v.startsWith("https://"),
      "URL must be a valid HTTP/HTTPS URL or a path starting with /",
    ),
  alt: z.string().max(255).nullable().optional(),
  variantId: z.string().uuid().nullable().optional(),
});

export type MediaInput = z.infer<typeof mediaInputSchema>;
export class MediaInputDto extends createZodDto(mediaInputSchema) {}

const mediaUpdateSchema = z.object({
  media: z.array(mediaInputSchema).max(50),
});

export type MediaUpdateInput = z.infer<typeof mediaUpdateSchema>;
export class UpdateMediaDto extends createZodDto(mediaUpdateSchema) {}
